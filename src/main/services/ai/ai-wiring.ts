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
import fs from 'fs'
import { logger } from '../../../utils/logger'
import { getSetting } from '../settings-service'
import { ModelManager } from '../model-manager'
import { getVectorsDB, getThumbnailsDB, getMasterDB } from '../database'
import { getVectorIndexService } from '../vectors/vector-index-service'
import { OnnxClipEngine } from './onnx-clip-engine'
import type { EmbeddingEngine } from './embedding-engine'
import { OnnxClipTextEncoder, type TextEncoder } from './text-encoder'
import { ClipTokenizer } from './clip-tokenizer'
import { assembleSemanticResults, type SemanticImage } from './semantic-search'
import { ensureAiLayer, getAiLayer, type AiLayerDeps } from './ai-bootstrap'
import { AI_INDEX_JOB_KIND, embedAndPersistOne } from './index-session'
import { planPendingImages, toAbsolutePath } from './index-planner'
import type { JobRunner } from '../job-runner'
import type { ModelInfo } from '../../../types/plugin'

const LOG_KEY = 'AiWiring'

export const CLIP_MODEL_ID = 'clip-vit-b32-int8'
export const CLIP_TEXT_MODEL_ID = 'clip-text-b32-int8'
export const CLIP_DIM = 512
const CLIP_NAME = 'CLIP ViT-B/32 (int8)'
const CLIP_TEXT_NAME = 'CLIP ViT-B/32 Text Tower (int8)'
// cache/poc-r2/clip-vit-b32-int8.onnx 实测指纹（开发期直连注册，SHA256 由 ModelManager.verifyModel 把关）
const CLIP_SHA256 = '0ab0c1b3ace708e539633af1744d5a95247fe4e14d3e08ff197ef82a6cb9bd93'
const CLIP_SIZE = 88648877
// cache/poc-r2/clip-text-b32-int8.onnx 实测指纹（T22 文本塔 · D-4 资产表）
const CLIP_TEXT_SHA256 = '18845f2ccc35223bb7fec403383a131154b11ac0918df25cf51986df5efd3a21'
const CLIP_TEXT_SIZE = 64070791
/** 查询文本编码器空闲多久后卸载（R2 会话分时 · D-2） */
const TEXT_IDLE_TTL_MS = 60_000

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

/** 校验通过才建引擎；缺失/损坏 → null（上层拒绝启用真推理，退回零引擎）。
 * 开发期直连 cache 原件：verifyModel 用只读模式（deleteOnMismatch=false），
 * 避免常量与本地文件漂移时误删唯一不可再生的本地副本。*/
export async function createClipEngine(manager: ModelManager): Promise<EmbeddingEngine | null> {
  const p = manager.getModelPath(CLIP_MODEL_ID)
  if (!p) return null
  const ok = await manager.verifyModel(CLIP_MODEL_ID, { deleteOnMismatch: false })
  if (!ok) {
    logger.warn(LOG_KEY, 'CLIP 模型 SHA256 校验未通过（缺失或损坏），AI 引擎不启用')
    return null
  }
  return new OnnxClipEngine({ modelPath: p, modelId: CLIP_MODEL_ID, dim: CLIP_DIM })
}

/** 开发期：把 cache 里的文本塔按绝对路径登记为已下载 */
export function registerClipTextModel(manager: ModelManager, modelFile: string): void {
  const info: ModelInfo = {
    id: CLIP_TEXT_MODEL_ID,
    name: CLIP_TEXT_NAME,
    size: CLIP_TEXT_SIZE,
    sha256: CLIP_TEXT_SHA256,
    state: 'downloaded',
    localPath: modelFile,
  }
  manager.registerModel(info)
}

/** 读 tokenizer.json 构造纯 JS 分词器；缺失/解析失败 → null（语义搜索退回空结果） */
export function loadTokenizerFromFile(tokenizerJsonPath: string): ClipTokenizer | null {
  try {
    const json = JSON.parse(fs.readFileSync(tokenizerJsonPath, 'utf8'))
    return ClipTokenizer.fromTokenizerJson(json)
  } catch (err) {
    logger.error(LOG_KEY, 'CLIP 分词器载入失败', err)
    return null
  }
}

/** 文本塔 SHA256 校验通过才建查询编码器（只读模式，同图像塔）；否则 null */
export async function createClipTextEncoder(
  manager: ModelManager,
  tokenizer: ClipTokenizer,
): Promise<TextEncoder | null> {
  const p = manager.getModelPath(CLIP_TEXT_MODEL_ID)
  if (!p) return null
  const ok = await manager.verifyModel(CLIP_TEXT_MODEL_ID, { deleteOnMismatch: false })
  if (!ok) {
    logger.warn(LOG_KEY, 'CLIP 文本塔 SHA256 校验未通过（缺失或损坏），语义搜索不启用')
    return null
  }
  return new OnnxClipTextEncoder({ modelPath: p, tokenizer, modelId: CLIP_TEXT_MODEL_ID, dim: CLIP_DIM })
}

function buildAiLayerDeps(engine: EmbeddingEngine | null): AiLayerDeps {
  return {
    isEnabled: () => getSetting('ai.enabled'),
    engineFactory: engine ? () => engine : undefined,
    getVectorsDB: (libraryPath) => getVectorsDB(libraryPath),
    getAnn: (libraryPath, dim) => getVectorIndexService(libraryPath, dim, CLIP_MODEL_ID),
    resolvePath: (libraryPath, imageId) => {
      const rel = getThumbnailsDB(libraryPath).getImageRelativePath(imageId)
      return rel ? toAbsolutePath(libraryPath, rel) : null
    },
    modelId: CLIP_MODEL_ID,
    dim: CLIP_DIM,
  }
}

/** 引擎会话全局引用计数（多库并发共享单引擎，归零才 unload） */
let engineSessions = 0
/** 每库活跃索引作业守卫（libraryId → jobId）：同库串行，避免共享 ANN 单例被先结束会话 unload 挤出写入 */
const librarySessions = new Map<number, string>()
/** 活跃会话收尾闭包：pause 弃用/退出等不会自然 done 的路径靠 dispose 强制释放 */
const activeFinishes = new Set<() => void>()

type AnnService = ReturnType<typeof getVectorIndexService>

function acquireEngine(): void { engineSessions++ }
function releaseEngine(engine: EmbeddingEngine): void {
  engineSessions = Math.max(0, engineSessions - 1)
  if (engineSessions === 0) void engine.unload().catch(() => { /* 释放失败不致命 */ })
}

// —— T22 查询链模块态：文本编码器 + 分词器（由 ensureAiLayerOnBoot 装配，dispose 拆）——
let queryTextEncoder: TextEncoder | null = null
/** imageId → 映射 Image 记录解析器（ai-handlers 注入 image-service 能力，保持依赖倒置，不把 monolith 静态链入本模块） */
let imageResolver: ((libraryId: number, imageId: number) => Record<string, unknown> | null) | null = null
/** 并发在飞查询计数：归零才安排文本编码器 idle 卸载 */
let textInflight = 0
/** 查询链拆除代际：teardown 自增，使在飞查询的 finally 跳过对已复位全局计数的二次收尾（#3 防变负/串扰新会话） */
let queryEpoch = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
/** 每库并发查询引用计数：仅「自加载 + 最后离开 + 索引未接管」才卸载该库 ANN */
const queryRefCounts = new Map<number, number>()

/**
 * 供 boot/测试注入查询文本编码器（null → 语义搜索退回空结果）。
 * 换链时（#4）：撤销空闲计时并卸载旧编码器已建的 ort 会话，避免 Enabled→Enabled 重装配泄漏会话。
 */
export function setQueryTextEncoder(e: TextEncoder | null): void {
  if (e === queryTextEncoder) return
  cancelIdleTimer()
  const old = queryTextEncoder
  queryTextEncoder = e
  if (old?.isLoaded()) void old.unload().catch(() => { /* 不致命 */ })
}
/** 供 boot/测试注入 imageId→Image 解析器 */
export function setQueryImageResolver(fn: ((libraryId: number, imageId: number) => Record<string, unknown> | null) | null): void { imageResolver = fn }

function cancelIdleTimer(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

/** 末次查询结束后：延迟 TEXT_IDLE_TTL_MS 卸载文本编码器（期间无新查询且未 in-flight） */
function scheduleIdleUnload(): void {
  cancelIdleTimer()
  if (textInflight > 0 || !queryTextEncoder) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (textInflight === 0 && queryTextEncoder?.isLoaded()) void queryTextEncoder.unload().catch(() => { /* 不致命 */ })
  }, TEXT_IDLE_TTL_MS)
  try { idleTimer.unref?.() } catch { /* 环境无 unref 忽略 */ }
}

/** 拆查询链：撤计时/计数/映射器并尽力卸载文本编码器会话（幂等，不抛） */
function teardownQuerySession(): void {
  cancelIdleTimer()
  queryEpoch++            // 作废在飞查询的 finally 收尾（其计数/ANN 归属已随拆链复位）
  textInflight = 0
  queryRefCounts.clear()
  const enc = queryTextEncoder
  queryTextEncoder = null
  imageResolver = null
  if (enc?.isLoaded()) void enc.unload().catch(() => { /* 不致命 */ })
}

/**
 * T22 语义搜索查询会话：先 load 文本编码器（C2 去重）+ encode 查询，再同步为本库 load ANN（复用索引会话或自加载）
 * → search → 组装，随后按「自加载 + 最后离开 + 索引未接管」释放本查询的 ANN；文本编码器空闲 TTL 后卸载。
 * 与索引会话互斥：查询期间若索引会话接管该库（librarySessions 命中），本查询绝不卸载其 ANN（不夺卸载所有权）。
 */
export async function runSemanticQuery(libraryId: number, query: string, limit: number): Promise<SemanticImage[]> {
  const layer = getAiLayer()
  const enc = queryTextEncoder
  const resolver = imageResolver
  if (!layer || !enc || !resolver) return []        // 未启用/未装配文本链 → 空（零会话）
  if (!query || query.trim() === '') return []      // 空查询：不建会话
  const lib = getMasterDB().getLibrary(libraryId)
  if (!lib) return []

  // §9.7 跨模型拒绝比较（#8）：本库 ANN 绑定的图像模型必须与查询文本塔投影空间一致；不一致直接空返回
  const ann = getVectorIndexService(lib.rootPath, layer.dim, layer.modelId)
  if (ann.getModelId() !== layer.modelId) {
    logger.error(LOG_KEY, `语义查询模型绑定不一致 库=${libraryId}（ANN=${ann.getModelId()} ≠ 查询=${layer.modelId}）`)
    return []
  }
  // 只读守卫（#7）：本库无该模型的干净索引向量 → 直接空返回，不 load ANN（避免在未索引库新建/落盘 vectors.usearch sidecar）
  const vectorsDB = getVectorsDB(lib.rootPath)
  if (vectorsDB.countIndexed(layer.modelId) === 0) return []

  const epoch = queryEpoch
  queryRefCounts.set(libraryId, (queryRefCounts.get(libraryId) ?? 0) + 1)
  textInflight++
  cancelIdleTimer()

  let selfLoaded = false
  try {
    await enc.load()
    // 收敛临界区（#5）：所有 await（load + encode）置于触碰 ANN 之前；此后同步完成 load→search→组装，
    // 不再让出事件循环，杜绝索引会话在查询 await 期收尾并 unload 掉共享 ANN（致查询静默返回空）
    const vec = await enc.encode(query)
    if (!ann.isOpen()) {
      ann.load(vectorsDB)
      selfLoaded = true
    }
    const hits = ann.search(vec, Math.max(1, limit))
    return assembleSemanticResults(hits, (imageId) => resolver(libraryId, imageId))
  } catch (err) {
    logger.error(LOG_KEY, `语义查询失败 库=${libraryId}`, err)
    return []
  } finally {
    if (epoch === queryEpoch) {
      // 未拆链：正常收尾（#3 计数防负，与 releaseEngine 的 Math.max 口径统一）
      textInflight = Math.max(0, textInflight - 1)
      const left = (queryRefCounts.get(libraryId) ?? 1) - 1
      if (left <= 0) queryRefCounts.delete(libraryId)
      else queryRefCounts.set(libraryId, left)
      if (selfLoaded && left <= 0 && !librarySessions.has(libraryId)) {
        try { ann.unload() } catch (err) { logger.warn(LOG_KEY, '查询 ANN 卸载异常', err) }
      }
      scheduleIdleUnload()
    } else if (selfLoaded) {
      // 拆链发生在在飞期间：全局计数已由 teardown 复位，仅回收本查询自加载的 ANN，不触碰新会话计数
      try { ann.unload() } catch (err) { logger.warn(LOG_KEY, '查询 ANN 卸载异常（拆链后）', err) }
    }
  }
}

/** 库感知处理器（幂等覆盖注册）：单条按 libraryId 解析会话依赖后 embed+persist。
 * 无法处理（层/引擎缺失、库离线、依赖不全）→ 抛错记 failed（不假成功，可 resume 重跑）。 */
function registerLibraryAwareIndexHandler(runner: JobRunner): void {
  runner.registerHandler(AI_INDEX_JOB_KIND, async (item) => {
    if (item.imageId == null) return
    const layer = getAiLayer()
    if (!layer?.engine) throw new Error('ai-index: AI 层/引擎不可用')
    const lib = getMasterDB().getLibrary(item.libraryId)
    if (!lib) throw new Error(`ai-index: 库不存在 ${item.libraryId}`)
    const deps = layer.buildSessionDeps(lib.rootPath)
    if (!deps) throw new Error(`ai-index: 会话依赖未就绪 库=${item.libraryId}`)
    const status = await embedAndPersistOne(deps, item.imageId)
    if (status === 'failed') throw new Error(`ai-index 失败 image=${item.imageId}`)
  })
}

/**
 * 扫描完成后为本库入队一次增量索引；无待嵌图片/未启用 → 返回 null（零推理会话）。
 * R2 会话分时 + 引擎引用计数；load→enqueue→start 全程 try，任一步异常统一 finish 释放（不外泄会话/计数/订阅）。
 */
export async function enqueueIndexForLibrary(libraryId: number, runner: JobRunner): Promise<string | null> {
  const layer = getAiLayer()
  const engine = layer?.engine
  if (!engine) return null
  if (librarySessions.has(libraryId)) return null // 同库已有活跃索引作业：跳过，避免共享单例交错
  const lib = getMasterDB().getLibrary(libraryId)
  if (!lib) return null

  const vectorsDB = getVectorsDB(lib.rootPath)
  const images = getThumbnailsDB(lib.rootPath).listIndexableImages()
  const indexed = new Set(vectorsDB.listIndexedImageIds(layer.modelId))
  const pending = planPendingImages(images, indexed)
  if (pending.length === 0) return null

  // 占位脏行（dirty=1）：被 W6 的 listAllEmbeddings/countIndexed dirty=0 过滤排除，仅作“待索引”展示与失败重试位
  for (const id of pending) vectorsDB.markPending(id, layer.modelId, layer.dim)

  registerLibraryAwareIndexHandler(runner)
  librarySessions.set(libraryId, '')

  // R2：会话开始加载引擎 + 本库内存 ANN
  await engine.load()
  acquireEngine()

  let ann: AnnService
  try {
    ann = getVectorIndexService(lib.rootPath, layer.dim, layer.modelId)
    ann.load(vectorsDB)
  } catch (err) {
    releaseEngine(engine)
    librarySessions.delete(libraryId)
    logger.error(LOG_KEY, `本库 ANN 载入失败，放弃索引 库=${libraryId}`, err)
    return null
  }

  let jobId = ''
  let unsub: (() => void) | null = null
  let settled = false
  const finish = (): void => {
    if (settled) return
    settled = true
    activeFinishes.delete(finish)
    if (unsub) { try { unsub() } catch { /* ignore */ } }
    try { ann.unload() } catch (err) { logger.warn(LOG_KEY, 'ANN 卸载异常', err) } // 落盘 sidecar
    if (librarySessions.get(libraryId) === jobId) librarySessions.delete(libraryId)
    releaseEngine(engine)
  }
  activeFinishes.add(finish)

  try {
    jobId = await runner.enqueue(
      AI_INDEX_JOB_KIND,
      { libraryId },
      { items: pending.map((id) => ({ libraryId, imageId: id })) },
    )
    librarySessions.set(libraryId, jobId)
    unsub = runner.subscribeProgress((p) => {
      if (p.jobId === jobId && (p.state === 'done' || p.state === 'cancelled')) finish()
    })
    await runner.start(jobId)
  } catch (err) {
    finish() // 入队/启动异常：统一释放（引擎引用计数/ANN/订阅）
    logger.error(LOG_KEY, `索引入队/启动失败 库=${libraryId}`, err)
    return null
  }
  logger.info(LOG_KEY, `扫描后增量索引入队：库 ${libraryId}，${pending.length} 项（job ${jobId}）`)
  return jobId
}

/**
 * 启动/开关变更后装配 AI 层：ai.enabled=false → 拆监听卸层；true → 注册模型、校验建引擎、装层、接扫描监听。
 * @param modelsDir 模型目录（ModelManager 约定根，localPath 已覆盖，仅兜底）
 * @param modelFile cache 内图像塔绝对路径（开发期直连）
 * @param textModelFile cache 内文本塔绝对路径（T22；缺 → 语义搜索退回空结果）
 * @param tokenizerFile cache 内 tokenizer.json 绝对路径（T22）
 * @param mapImage (libraryId,imageId) → 已映射 Image 记录（由 ai-handlers 注入 image-service 能力）
 */
export async function ensureAiLayerOnBoot(opts: {
  modelsDir: string
  modelFile: string | null
  textModelFile?: string | null
  tokenizerFile?: string | null
  mapImage?: (libraryId: number, imageId: number) => Record<string, unknown> | null
  runner: JobRunner
  imageService: ScanNotifiable
}): Promise<void> {
  if (!getSetting('ai.enabled')) {
    opts.imageService.setScanCompleteListener(null)
    ensureAiLayer({ isEnabled: () => false }) // 触发既有层 disable 拆除
    teardownQuerySession()
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

  // T22 查询链装配（独立于图像引擎）：文本塔 + 分词器 + image 映射器齐备才启用语义搜索，否则退回空结果
  setQueryImageResolver(opts.mapImage ?? null)
  const tokenizer = opts.tokenizerFile ? loadTokenizerFromFile(opts.tokenizerFile) : null
  if (opts.textModelFile && tokenizer) {
    registerClipTextModel(manager, opts.textModelFile)
    setQueryTextEncoder(await createClipTextEncoder(manager, tokenizer))
  } else {
    setQueryTextEncoder(null)
  }
  logger.info(LOG_KEY, engine ? 'AI 层已启用（真 CLIP 引擎）' : 'AI 层已启用但无可用引擎（模型缺失/校验失败）')
}

/**
 * 退出清理：强制收尾存活会话（pause 弃用/退出等不会自然 done 的路径靠此补 finish：
 * 落盘 ANN sidecar + 释放引擎引用计数），再复位监听、拆层、归零计数（不抛）。
 */
export function disposeAiLayer(imageService?: ScanNotifiable): void {
  imageService?.setScanCompleteListener(null)
  // W5：存活会话统一补 finish（finish 内部已幂等，settled 后重复调用无害）
  for (const finish of [...activeFinishes]) {
    try { finish() } catch (err) { logger.warn(LOG_KEY, '会话收尾异常（忽略）', err) }
  }
  activeFinishes.clear()
  librarySessions.clear()
  engineSessions = 0
  teardownQuerySession()
  try {
    getAiLayer()?.disable()
  } catch (err) {
    logger.warn(LOG_KEY, 'AI 层卸载异常（忽略）', err)
  }
}
