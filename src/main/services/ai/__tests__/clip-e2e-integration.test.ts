// @vitest-environment node
/**
 * Phase 9 M5 · T21 — 真实运行时端到端冒烟（真 CLIP 模型 + 真 onnxruntime + 真 better-sqlite3 + 真 usearch HNSW）。
 *
 * 与「零模型」单测互补：本测用**真实生产模块**跑通整条索引链路 ——
 *   ModelManager.registerModel + verifyModel(SHA256)  →  OnnxClipEngine（sharp 预处理 + ort 图像编码器 + int8 量化）
 *   →  VectorsDB.markPending/upsertEmbedding（真 vectors.db）  →  VectorIndexService（真 usearch HNSW sidecar）
 *   →  runAiIndexSession（R2 会话分时编排）。
 * 断言：真实图片推理出的 int8 向量确被持久化（512 字节 / dirty 归零），HNSW sidecar 落盘并可 KNN 自检。
 *
 * 默认关闭（快门禁保持零模型）：仅当 `IV_AI_E2E=1` 且 cache 模型 / test-library 图片齐备时才实跑，否则整体 skip。
 * 运行（conda Node25，原生模块真实加载）：
 *   $env:IV_AI_E2E="1"; & <conda>\node.exe node_modules\vitest\vitest.mjs run src/main/services/ai/__tests__/clip-e2e-integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { getThumbnailsDB, getVectorsDB, closeVectorsDB, closeThumbnailsDB } from '../../database'
import { ModelManager } from '../../model-manager'
import { OnnxClipEngine } from '../onnx-clip-engine'
import { getVectorIndexService, closeVectorIndexService } from '../../vectors/vector-index-service'
import { runAiIndexSession } from '../index-session'
import { toAbsolutePath } from '../index-planner'
import type { ModelInfo } from '../../../../types/plugin'

const CLIP_MODEL_ID = 'clip-vit-b32-int8'
const DIM = 512
// 与 ai-wiring 生产常量一致：cache/poc-r2/clip-vit-b32-int8.onnx 实测指纹（校验门走真 ModelManager.verifyModel）
const CLIP_SHA256 = '0ab0c1b3ace708e539633af1744d5a95247fe4e14d3e08ff197ef82a6cb9bd93'
const CLIP_SIZE = 88648877
const N_IMG = 5

const cacheModel = path.resolve(process.cwd(), 'cache', 'poc-r2', 'clip-vit-b32-int8.onnx')
const srcImgs = path.resolve(process.cwd(), 'test-library', 'set01')
const hasModel = fs.existsSync(cacheModel)
const hasImgs = fs.existsSync(srcImgs)
const RUN = process.env.IV_AI_E2E === '1' && hasModel && hasImgs

describe.skipIf(!RUN)('T21 真实端到端冒烟（真模型 + 真 ort + 真 sqlite + 真 usearch）', () => {
  let libRoot = ''
  let modelCopy = ''
  let engine: OnnxClipEngine | null = null

  beforeAll(() => {
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-e2e-'))
    fs.mkdirSync(path.join(libRoot, '.ivlib'), { recursive: true })
    // 拷贝模型到临时库：verifyModel 校验失败会删文件，用副本以免误删 cache 原件
    modelCopy = path.join(libRoot, 'clip-vit-b32-int8.onnx')
    fs.copyFileSync(cacheModel, modelCopy)

    // 取前 N 张真实图片，平铺进临时库并登记缩略图库行（media_type=image）
    const names = fs.readdirSync(srcImgs)
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .slice(0, N_IMG)
    const rows = names.map((n, i) => {
      const dest = path.join(libRoot, n)
      fs.copyFileSync(path.join(srcImgs, n), dest)
      const st = fs.statSync(dest)
      return {
        relative_path: n,
        file_hash: `e2e-${i}-${n}`,
        width: 1,
        height: 1,
        file_size: st.size,
        format: 'jpg',
        modified_time: new Date().toISOString(),
        media_type: 'image',
      }
    })
    const thumbs = getThumbnailsDB(libRoot)
    thumbs.addImages(rows)

    // 待嵌队列：逐条 markPending 占位脏行（解「新图无行无法入队」缺口）
    const vectors = getVectorsDB(libRoot)
    for (const { id } of thumbs.listIndexableImages()) vectors.markPending(id, CLIP_MODEL_ID, DIM)
  })

  afterAll(async () => {
    try { if (engine?.isLoaded()) await engine.unload() } catch { /* ignore */ }
    closeVectorIndexService(libRoot)
    closeVectorsDB(libRoot)
    closeThumbnailsDB(libRoot)
    if (libRoot) fs.rmSync(libRoot, { recursive: true, force: true })
  })

  it('真模型 SHA256 门 → 推理 → 持久化 → HNSW 自检索，全链路真实跑通', async () => {
    // 1) 真实 ModelManager SHA256 校验门
    const manager = new ModelManager(path.join(libRoot, 'models'))
    const info: ModelInfo = {
      id: CLIP_MODEL_ID, name: 'CLIP ViT-B/32 (int8)',
      size: CLIP_SIZE, sha256: CLIP_SHA256, state: 'downloaded', localPath: modelCopy,
    }
    manager.registerModel(info)
    expect(await manager.verifyModel(CLIP_MODEL_ID)).toBe(true)
    expect(fs.existsSync(modelCopy)).toBe(true) // 校验通过不应删除文件

    const modelPath = manager.getModelPath(CLIP_MODEL_ID)
    expect(modelPath).toBe(modelCopy)

    // 2) 真实引擎 + 真实会话依赖，跑 runAiIndexSession
    engine = new OnnxClipEngine({ modelPath: modelPath!, modelId: CLIP_MODEL_ID, dim: DIM })
    const vectors = getVectorsDB(libRoot)
    const thumbs = getThumbnailsDB(libRoot)
    const ann = getVectorIndexService(libRoot, DIM)
    const deps = {
      vectorsDB: vectors,
      engine,
      ann,
      resolvePath: (id: number): string | null => {
        const rel = thumbs.getImageRelativePath(id)
        return rel ? toAbsolutePath(libRoot, rel) : null
      },
      batchSize: 50,
    }
    const res = await runAiIndexSession(deps)

    // 3) 断言：全部成功、脏归零、5 条干净索引
    expect(res.failed).toBe(0)
    expect(res.skipped).toBe(0)
    expect(res.processed).toBe(N_IMG)
    expect(vectors.countDirty()).toBe(0)
    const indexed = vectors.listIndexedImageIds(CLIP_MODEL_ID)
    expect(indexed.length).toBe(N_IMG)

    // 4) int8 向量持久化正确（512 字节 / quant=int8 / 非全零）
    const sampleId = indexed[0]
    const emb = vectors.getEmbedding(sampleId)
    expect(emb?.model_id).toBe(CLIP_MODEL_ID)
    expect(emb?.quant).toBe('int8')
    expect(emb?.vector.length).toBe(DIM)
    expect(emb!.vector.some((b) => b !== 0)).toBe(true)

    // 5) HNSW sidecar 落盘（会话结束 unload 持久化）
    expect(fs.existsSync(path.join(libRoot, '.ivlib', 'vectors.usearch'))).toBe(true)

    // 6) 真实 KNN 自检：重新载入 sidecar，以存储向量查询，自身应在命中集中
    ann.load(vectors)
    expect(ann.size()).toBe(N_IMG)
    const hits = ann.search(emb!.vector, 3)
    expect(hits.some((h) => h.id === sampleId)).toBe(true)
  }, 180_000)
})
