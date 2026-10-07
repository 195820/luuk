/**
 * Phase 9 M5 · T21 — AI 层生产接线（真 OnnxClipEngine + ModelManager 校验 + 扫描后增量索引）。
 *
 * 触发口径（用户拍板）：扫描完成后自动增量。ImageService.scanLibrary 成功 → 回调本模块
 * enqueueIndexForLibrary → 计划「本库缺该模型向量的图片」→ markPending → 入队 ai.clip-index（复用 JobRunner）。
 * R2 会话分时：入队前 engine.load + 该库 ann.load；作业 done/cancelled 后 ann.unload（落盘 sidecar）+
 * 引用计数归零才 engine.unload（多库并发共享同一引擎会话）。
 *
 * 本模块顶层 import getVectorIndexService（→ usearch 原生），仅由主进程 ai-handlers 引入，不进 vitest。
 */
import { logger } from '../../../utils/logger'
import { getSetting } from '../settings-service'
import { ModelManager } from '../model-manager'
import { getVectorsDB, getThumbnailsDB, getMasterDB } from '../database'
import { getVectorIndexService } from '../vectors/vector-index-service'
import { OnnxClipEngine } from './onnx-clip-engine'
import type { EmbeddingEngine } from './embedding-engine'
import { ensureAiLayer, getAiLayer, type AiLayerDeps } from './ai-bootstrap'
import { AI_INDEX_JOB_KIND, embedAndPersistOne } from './index-session'
import { planPendingImages, toAbsolutePath } from './index-planner'
import type { JobRunner } from '../job-runner'
import type { ModelInfo } from '../../../types/plugin'

const LOG_KEY = 'AiWiring'

export const CLIP_MODEL_ID = 'clip-vit-b32-int8'
export const CLIP_DIM = 512
const CLIP_NAME = 'CLIP ViT-B/32 (int8)'
// cache/poc-r2/clip-vit-b32-int8.onnx 实测指纹（开发期直连注册，SHA256 由 ModelManager.verifyModel 把关）
const CLIP_SHA256 = '0ab0c1b3ace708e539633af1744d5a95247fe4e14d3e08ff197ef82a6cb9bd93'
const CLIP_SIZE = 88648877

/** 解耦的最小扫描事件面（避免 ImageService 具体类型依赖，便于替身） */
export interface ScanNotifiable {
  setScanCompleteListener: (fn: ((libraryId: number) => void) | null) => void
}

/** 开发期：把 cache 里的模型按绝对路径登记为已下载（localPath 直指该文件） */
export function registerClipModel(manager: ModelManager, modelFile: string): void {
  const info: ModelInfo = {
    id: CLIP_MODEL_ID,
    name: CLIP_NAME,
    size: CLIP_SIZE,
    sha256: CLIP_SHA256,
    state: 'downloaded',
    localPath: modelFile,
  }
  manager.registerModel(info)
}

/** 校验通过才建引擎；缺失/损坏 → null（上层拒绝启用真推理，退回零引擎） */
export async function createClipEngine(manager: ModelManager): Promise<EmbeddingEngine | null> {
  const p = manager.getModelPath(CLIP_MODEL_ID)
  if (!p) return null
  const ok = await manager.verifyModel(CLIP_MODEL_ID)
  if (!ok) {
    logger.warn(LOG_KEY, 'CLIP 模型 SHA256 校验未通过（缺失或损坏），AI 引擎不启用')
    return null
  }
  return new OnnxClipEngine({ modelPath: p, modelId: CLIP_MODEL_ID, dim: CLIP_DIM })
}

function buildAiLayerDeps(engine: EmbeddingEngine | null): AiLayerDeps {
  return {
    isEnabled: () => getSetting('ai.enabled'),
    engineFactory: engine ? () => engine : undefined,
    getVectorsDB: (libraryPath) => getVectorsDB(libraryPath),
    getAnn: (libraryPath, dim) => getVectorIndexService(libraryPath, dim),
    resolvePath: (libraryPath, imageId) => {
      const rel = getThumbnailsDB(libraryPath).getImageRelativePath(imageId)
      return rel ? toAbsolutePath(libraryPath, rel) : null
    },
    modelId: CLIP_MODEL_ID,
    dim: CLIP_DIM,
  }
}

/** 引擎会话引用计数（多库并发共享单引擎，归零才 unload） */
let activeIndexSessions = 0

/** 库感知处理器：单条 item 按 libraryId 解析该库会话依赖后 embed+persist（幂等覆盖注册） */
function registerLibraryAwareIndexHandler(runner: JobRunner): void {
  runner.registerHandler(AI_INDEX_JOB_KIND, async (item) => {
    if (item.imageId == null) return
    const layer = getAiLayer()
    if (!layer?.engine) return
    const lib = getMasterDB().getLibrary(item.libraryId)
    if (!lib) return
    const deps = layer.buildSessionDeps(lib.rootPath)
    if (!deps) return
    const status = await embedAndPersistOne(deps, item.imageId)
    if (status === 'failed') throw new Error(`ai-index 失败 image=${item.imageId}`)
  })
}

/**
 * 扫描完成后为本库入队一次增量索引；无待嵌图片或未启用 → 返回 null（零推理会话）。
 */
export async function enqueueIndexForLibrary(libraryId: number, runner: JobRunner): Promise<string | null> {
  const layer = getAiLayer()
  const engine = layer?.engine
  if (!engine) return null
  const lib = getMasterDB().getLibrary(libraryId)
  if (!lib) return null

  const vectorsDB = getVectorsDB(lib.rootPath)
  const images = getThumbnailsDB(lib.rootPath).listIndexableImages()
  const indexed = new Set(vectorsDB.listIndexedImageIds(layer.modelId))
  const pending = planPendingImages(images, indexed)
  if (pending.length === 0) return null

  for (const id of pending) vectorsDB.markPending(id, layer.modelId, layer.dim)

  registerLibraryAwareIndexHandler(runner)

  // R2：会话开始加载引擎 + 本库内存 ANN
  await engine.load()
  activeIndexSessions++
  const ann = getVectorIndexService(lib.rootPath, layer.dim)
  ann.load(vectorsDB)

  let settled = false
  const finish = (): void => {
    if (settled) return
    settled = true
    try { ann.unload() } catch (err) { logger.warn(LOG_KEY, 'ANN 卸载异常', err) }
    activeIndexSessions = Math.max(0, activeIndexSessions - 1)
    if (activeIndexSessions === 0) void engine.unload()
  }

  const jobId = await runner.enqueue(
    AI_INDEX_JOB_KIND,
    { libraryId },
    { items: pending.map((id) => ({ libraryId, imageId: id })) },
  )
  const unsub = runner.subscribeProgress((p) => {
    if (p.jobId === jobId && (p.state === 'done' || p.state === 'cancelled')) {
      finish()
      unsub()
    }
  })
  await runner.start(jobId)
  logger.info(LOG_KEY, `扫描后增量索引入队：库 ${libraryId}，${pending.length} 项（job ${jobId}）`)
  return jobId
}

/**
 * 启动/开关变更后装配 AI 层：ai.enabled=false → 拆监听卸层；true → 注册模型、校验建引擎、装层、接扫描监听。
 * @param modelsDir 模型目录（ModelManager 约定根，localPath 已覆盖，仅兜底）
 * @param modelFile cache 内模型绝对路径（开发期直连）
 */
export async function ensureAiLayerOnBoot(opts: {
  modelsDir: string
  modelFile: string | null
  runner: JobRunner
  imageService: ScanNotifiable
}): Promise<void> {
  if (!getSetting('ai.enabled')) {
    opts.imageService.setScanCompleteListener(null)
    ensureAiLayer({ isEnabled: () => false }) // 触发既有层 disable 拆除
    return
  }
  const manager = new ModelManager(opts.modelsDir)
  if (opts.modelFile) registerClipModel(manager, opts.modelFile)
  const engine = opts.modelFile ? await createClipEngine(manager) : null
  const layer = ensureAiLayer(buildAiLayerDeps(engine))
  if (!layer) return

  opts.imageService.setScanCompleteListener((libraryId) => {
    void enqueueIndexForLibrary(libraryId, opts.runner).catch((err) => logger.error(LOG_KEY, '扫描后索引失败', err))
  })
  logger.info(LOG_KEY, engine ? 'AI 层已启用（真 CLIP 引擎）' : 'AI 层已启用但无可用引擎（模型缺失/校验失败）')
}

/** 退出清理：尽力卸载引擎会话并复位监听（不抛） */
export function disposeAiLayer(imageService?: ScanNotifiable): void {
  imageService?.setScanCompleteListener(null)
  try {
    getAiLayer()?.disable()
  } catch (err) {
    logger.warn(LOG_KEY, 'AI 层卸载异常（忽略）', err)
  }
  activeIndexSessions = 0
}
