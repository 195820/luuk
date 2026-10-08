// @vitest-environment node
/**
 * Phase 9 M5 · T22 — 语义搜索真实端到端冒烟（真 CLIP 文本塔 + 真分词器 + 真 onnxruntime + 真 usearch HNSW）。
 *
 * 与 T21 端到端互补：T21 证明「图像塔 → int8 库存 → HNSW 自检索」；本测证明**跨模态查询链**在生产混合配对下真实跑通：
 *   真实图像索引（int8 库存，同 T21）  →  真实 ClipTokenizer（读 cache tokenizer.json，纯 JS）
 *   →  真实 OnnxClipTextEncoder（文本塔 int8 / fp32 两权重变体）  →  quantizeEmbedToInt8
 *   →  真实 VectorIndexService.search（Cos，查询 int8 × 库存 int8）  →  semanticSearch 编排组装。
 * 断言（无需人工字幕，杜绝随机内容带来的 flaky，且覆盖生产混合配对的核心不变量）：
 *   1) 查询命中均落在已索引集合内、top-1 存在；
 *   2) similarity 为 [0,100] 整数且按命中序单调不增（距离升序 = 相似度降序）；
 *   3) 同一查询两次执行结果完全一致（分词 + 推理 + ANN 全链确定性）；
 *   4) **生产混合配对**：文本塔 int8（默认）与 fp32（兜底）两变体 × 同一 int8 库存，各自独立产出良构 top-1（near-tie 合成图允许二者 top-1 不同，但均须为合法库存命中）。
 *
 * 默认关闭（快门禁保持零模型）：仅当 `IV_AI_E2E=1` 且 cache 图像塔/文本塔(int8+fp32)/tokenizer 及 test-library 图片齐备才实跑。
 * 运行（conda Node25，原生模块真实加载）：
 *   $env:IV_AI_E2E="1"; & <conda>\node.exe node_modules\vitest\vitest.mjs run src/main/services/ai/__tests__/clip-semantic-e2e-integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { getThumbnailsDB, getVectorsDB, closeVectorsDB, closeThumbnailsDB } from '../../database'
import { OnnxClipEngine } from '../onnx-clip-engine'
import { getVectorIndexService, closeVectorIndexService } from '../../vectors/vector-index-service'
import { runAiIndexSession } from '../index-session'
import { toAbsolutePath } from '../index-planner'
import { ClipTokenizer } from '../clip-tokenizer'
import { OnnxClipTextEncoder } from '../text-encoder'
import { semanticSearch, type SemanticQueryDeps } from '../semantic-search'

const CLIP_MODEL_ID = 'clip-vit-b32-int8'
const DIM = 512
const N_IMG = 6

const cacheDir = path.resolve(process.cwd(), 'cache', 'poc-r2')
const imgModel = path.join(cacheDir, 'clip-vit-b32-int8.onnx')
const textInt8 = path.join(cacheDir, 'clip-text-b32-int8.onnx')
const textFp32 = path.join(cacheDir, 'clip-text-b32-fp32.onnx')
const tokenizerFile = path.join(cacheDir, 'clip-token', 'tokenizer.json')
const srcImgs = path.resolve(process.cwd(), 'test-library', 'set01')

const assetsReady =
  fs.existsSync(imgModel) && fs.existsSync(textInt8) && fs.existsSync(textFp32) &&
  fs.existsSync(tokenizerFile) && fs.existsSync(srcImgs)
const RUN = process.env.IV_AI_E2E === '1' && assetsReady

const QUERIES = ['a photo of a cat', 'a landscape with mountains', 'a portrait of a person']

describe.skipIf(!RUN)('T22 语义搜索真实端到端（真文本塔 + 真分词 + 真 ort + 真 usearch · 生产混合配对）', () => {
  let libRoot = ''
  let modelCopy = ''
  let imgEngine: OnnxClipEngine | null = null
  let tokInt8: OnnxClipTextEncoder | null = null
  let tokFp32: OnnxClipTextEncoder | null = null
  let tokenizer: ClipTokenizer | null = null
  let indexedIds: number[] = []

  beforeAll(() => {
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-sem-e2e-'))
    fs.mkdirSync(path.join(libRoot, '.ivlib'), { recursive: true })
    modelCopy = path.join(libRoot, 'clip-vit-b32-int8.onnx')
    fs.copyFileSync(imgModel, modelCopy)

    const names = fs.readdirSync(srcImgs)
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .slice(0, N_IMG)
    const rows = names.map((n, i) => {
      const dest = path.join(libRoot, n)
      fs.copyFileSync(path.join(srcImgs, n), dest)
      const st = fs.statSync(dest)
      return {
        relative_path: n,
        file_hash: `sem-${i}-${n}`,
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

    const vectors = getVectorsDB(libRoot)
    for (const { id } of thumbs.listIndexableImages()) vectors.markPending(id, CLIP_MODEL_ID, DIM)
  })

  afterAll(async () => {
    try { if (imgEngine?.isLoaded()) await imgEngine.unload() } catch { /* ignore */ }
    try { if (tokInt8?.isLoaded()) await tokInt8.unload() } catch { /* ignore */ }
    try { if (tokFp32?.isLoaded()) await tokFp32.unload() } catch { /* ignore */ }
    closeVectorIndexService(libRoot)
    closeVectorsDB(libRoot)
    closeThumbnailsDB(libRoot)
    if (libRoot) fs.rmSync(libRoot, { recursive: true, force: true })
  })

  it('真图像索引 → 真分词 + 真文本塔(int8/fp32) → int8 查询 × int8 库存 → 生产混合配对 top-1 全链真实跑通', async () => {
    // 1) 真图像引擎把图片嵌成 int8 库存（同 T21 链路）
    imgEngine = new OnnxClipEngine({ modelPath: modelCopy, modelId: CLIP_MODEL_ID, dim: DIM })
    const vectors = getVectorsDB(libRoot)
    const thumbs = getThumbnailsDB(libRoot)
    const ann = getVectorIndexService(libRoot, DIM)
    const deps = {
      vectorsDB: vectors,
      engine: imgEngine,
      ann,
      resolvePath: (id: number): string | null => {
        const rel = thumbs.getImageRelativePath(id)
        return rel ? toAbsolutePath(libRoot, rel) : null
      },
      batchSize: 50,
    }
    const res = await runAiIndexSession(deps)
    expect(res.failed).toBe(0)
    expect(res.processed).toBeGreaterThan(0)
    indexedIds = vectors.listIndexedImageIds(CLIP_MODEL_ID)
    expect(indexedIds.length).toBe(res.processed)
    const indexedSet = new Set(indexedIds)

    // 2) 真分词器（读 cache tokenizer.json，纯 JS）
    tokenizer = ClipTokenizer.fromTokenizerJson(JSON.parse(fs.readFileSync(tokenizerFile, 'utf8')))

    // 3) 真文本塔两变体：int8（生产默认）与 fp32（兜底），均查询同一 int8 库存
    tokInt8 = new OnnxClipTextEncoder({ modelPath: textInt8, tokenizer, modelId: 'clip-text-b32-int8', dim: DIM })
    tokFp32 = new OnnxClipTextEncoder({ modelPath: textFp32, tokenizer, modelId: 'clip-text-b32-fp32', dim: DIM })
    await tokInt8.load()
    await tokFp32.load()
    if (!ann.isOpen()) ann.load(vectors)
    expect(ann.size()).toBe(indexedIds.length)

    const mkDeps = (enc: OnnxClipTextEncoder): SemanticQueryDeps => ({
      encode: (t) => enc.encode(t),
      search: (v, k) => ann.search(v, k),
      getImage: (imageId) => {
        const rel = thumbs.getImageRelativePath(imageId)
        return rel ? { id: imageId, relative_path: rel } : null
      },
    })

    const validate = (label: string, hits: Awaited<ReturnType<typeof semanticSearch>>, lim: number) => {
      // (1) 命中落在已索引集合内、top-1 存在
      expect(hits.length, label).toBeGreaterThan(0)
      expect(hits.length, label).toBeLessThanOrEqual(lim)
      for (const h of hits) expect(indexedSet.has(h.id as number), label).toBe(true)
      // (2) similarity ∈ [0,100] 整数且单调不增（距离升序 = 相似度降序）
      let prev = 101
      for (const h of hits) {
        const s = h.similarity
        expect(Number.isInteger(s), label).toBe(true)
        expect(s, label).toBeGreaterThanOrEqual(0)
        expect(s, label).toBeLessThanOrEqual(100)
        expect(s, label).toBeLessThanOrEqual(prev)
        prev = s
      }
    }

    for (const q of QUERIES) {
      const lim = indexedIds.length
      const hitsInt8 = await semanticSearch(mkDeps(tokInt8), q, lim)
      const hitsFp32 = await semanticSearch(mkDeps(tokFp32), q, lim)

      // 生产混合配对：文本塔 int8（默认）与 fp32（兜底）两变体 × 同一 int8 库存，各自独立产出良构 top-1
      validate(`int8·${q}`, hitsInt8, lim)
      validate(`fp32·${q}`, hitsFp32, lim)

      // (3) 全链确定性：同一编码器同查询两次执行完全一致（分词 + 推理 + ANN 全链无随机）
      const again = await semanticSearch(mkDeps(tokInt8), q, lim)
      expect(again.map((h) => [h.id, h.similarity])).toEqual(hitsInt8.map((h) => [h.id, h.similarity]))
    }

    // 空/全空白查询：不建会话，返回 []（生产不变量）
    expect(await semanticSearch(mkDeps(tokInt8), '   ', 5)).toEqual([])
  }, 300_000)
})
