/**
 * Phase 9 M5 · T21 — AI 层 IPC 与主进程装配入口（薄胶水，真逻辑在 ai-wiring.ts）。
 *
 * 负责：开发期解析 cache 内 CLIP 模型路径、启动装配 AI 层、getAiStatus/setAiEnabled IPC、退出清理。
 *
 * C1 关键约束：本文件被主进程 electron/main.ts 每次启动静态引入，故绝不在此静态 import
 * ai-wiring / vector-index-service（其顶层链入 usearch 原生插件）。改为仅在 ai.enabled 为真、
 * 或用户显式点开关时，动态 import 拉起原生链；关闭态启动零 usearch 加载。
 */
import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { logger } from '../../utils/logger'
import { getSetting, setSetting } from '../services/settings-service'
import { getJobRunner } from '../services/job-runner'
import { getImageService } from '../services/image-service'
import { getMasterDB, getVectorsDB } from '../services/database'

const LOG = 'AiHandlers'
// 与 ai-wiring 保持一致的模型标识（只读状态查询用，避免为此静态引入 usearch 链）
const CLIP_MODEL_ID = 'clip-vit-b32-int8'
// #6：查询文本长度上限（防止粘贴长文触发主进程完整 BPE 阻塞）；CLIP 上下文仅 77 token，超长无意义
const SEMANTIC_QUERY_MAX_LEN = 512

type AiWiring = typeof import('../services/ai/ai-wiring')
type VectorIndexModule = typeof import('../services/vectors/vector-index-service')

// 一旦真正启用（或用户显式开关）即缓存已加载模块，使退出清理可同步执行（不再引入新动态加载竞态）
let cachedWiring: AiWiring | null = null
let cachedVectorIndex: VectorIndexModule | null = null

/** 惰性拉起 ai-wiring + vector-index-service（仅启用路径调用；关闭态启动永不调用） */
async function loadAiModules(): Promise<AiWiring> {
  if (!cachedWiring) {
    // ai-wiring 顶层静态引入 vector-index-service（→ usearch），故一并缓存以便退出清理
    cachedWiring = await import('../services/ai/ai-wiring')
    cachedVectorIndex = await import('../services/vectors/vector-index-service')
  }
  return cachedWiring
}

/** 开发期：在若干基准目录（cwd / appPath）按相对路径找文件；找不到返回 null */
function findCacheFile(relPath: string): string | null {
  const bases: Array<string | null> = []
  try { bases.push(process.cwd()) } catch { /* ignore */ }
  try { bases.push(app.getAppPath()) } catch { /* ignore */ }
  for (const b of bases) {
    if (!b) continue
    const f = path.join(b, relPath)
    if (fs.existsSync(f)) return f
  }
  return null
}

/** 开发期：在若干基准目录找 cache/poc-r2 的 int8 图像模型；找不到返回 null（AI 层退回零引擎） */
export function resolveClipModelFile(): string | null {
  return findCacheFile(path.join('cache', 'poc-r2', 'clip-vit-b32-int8.onnx'))
}

/** T22：文本塔 int8 模型绝对路径（缺 → 语义搜索退回空结果） */
export function resolveClipTextModelFile(): string | null {
  return findCacheFile(path.join('cache', 'poc-r2', 'clip-text-b32-int8.onnx'))
}

/** T22：分词器数据 tokenizer.json 绝对路径 */
export function resolveTokenizerFile(): string | null {
  return findCacheFile(path.join('cache', 'poc-r2', 'clip-token', 'tokenizer.json'))
}

function bootOpts() {
  return {
    modelsDir: path.join(app.getPath('userData'), 'models'),
    modelFile: resolveClipModelFile(),
    textModelFile: resolveClipTextModelFile(),
    tokenizerFile: resolveTokenizerFile(),
    // 语义结果 imageId→Image 映射能力（注入 wiring，不把 monolith 静态链入动态导入边界）
    mapImage: (libraryId: number, imageId: number) => getImageService().getMappedImageById(libraryId, imageId),
    runner: getJobRunner(),
    imageService: getImageService(),
  }
}

/**
 * 启动装配 AI 层。C1：关闭态直接返回（不 import ai-wiring → 零 usearch 加载）；
 * 启用态才动态拉起 ai-wiring 装配。运行中从开→关的拆除走 setAiEnabled 显式路径（届时模块已缓存）。
 */
export async function ensureAiLayerOnBoot(): Promise<void> {
  if (!getSetting('ai.enabled')) return
  const wiring = await loadAiModules()
  await wiring.ensureAiLayerOnBoot(bootOpts())
}

/**
 * 退出清理：卸载引擎会话 + 关闭本进程内所有库的 ANN sidecar（落盘）。
 * 同步执行——仅当本会话确实加载过 AI 模块（即曾启用）才需清理；关闭态从未加载则零对象可释放。
 */
export function disposeAiOnQuit(): void {
  if (cachedWiring) {
    try { cachedWiring.disposeAiLayer(getImageService()) } catch (err) { logger.warn(LOG, 'AI 层拆除异常（忽略）', err) }
  }
  if (cachedVectorIndex) {
    try { cachedVectorIndex.closeAllVectorIndexServices() } catch (err) { logger.warn(LOG, '关闭向量索引服务异常（忽略）', err) }
  }
}

export function registerAiHandlers(): void {
  // W10：关闭态短路——不 getVectorsDB（避免仅为查状态就在库目录创建 vectors.db 文件）
  ipcMain.handle('getAiStatus', async () => {
    try {
      const enabled = getSetting('ai.enabled')
      if (!enabled) return { success: true, data: { enabled: false, indexed: 0, pending: 0 } }
      const lib = getMasterDB().getLibraries().find((l) => l.status === 'online') ?? null
      let indexed = 0
      let pending = 0
      if (lib) {
        try {
          const v = getVectorsDB(lib.rootPath)
          indexed = v.listIndexedImageIds(CLIP_MODEL_ID).length
          pending = v.countDirty()
        } catch { /* 库未就绪时按 0 */ }
      }
      return { success: true, data: { enabled, indexed, pending } }
    } catch (err) {
      logger.error(LOG, 'getAiStatus 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 显式开关（用户交互）：无论开/关都动态拉起 ai-wiring，据 ai.enabled 装配或拆除
  ipcMain.handle('setAiEnabled', async (_e, enabled: boolean) => {
    try {
      setSetting('ai.enabled', Boolean(enabled))
      const wiring = await loadAiModules()
      await wiring.ensureAiLayerOnBoot(bootOpts())
      return { success: true, data: { enabled: getSetting('ai.enabled') } }
    } catch (err) {
      logger.error(LOG, 'setAiEnabled 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // T22 语义搜索：关闭态短路（零 usearch）；启用态动态拉起 ai-wiring 跑查询会话
  ipcMain.handle('semanticSearchImages', async (_e, libraryId: number, query: string, limit: number) => {
    try {
      // #6 入参收紧：非法 libraryId / 过长查询直接拒绝，limit 夹 [1,500]
      const libId = Number(libraryId)
      if (!Number.isInteger(libId) || libId <= 0) return { success: false, error: '无效库 ID', images: [] }
      const q = String(query ?? '')
      if (q.length > SEMANTIC_QUERY_MAX_LEN) return { success: false, error: `查询过长（>${SEMANTIC_QUERY_MAX_LEN} 字符）`, images: [] }
      const k = Math.min(500, Math.max(1, Number(limit) || 200))
      // #2 关闭态：返回 success:false + error（区分「未就绪」与「真 0 命中」；UI 侧另按 getAiStatus 隐语义入口）
      if (!getSetting('ai.enabled')) return { success: false, error: 'AI 未启用', images: [] }
      const wiring = await loadAiModules()
      const hits = await wiring.runSemanticQuery(libId, q, k)
      return { success: true, images: hits }
    } catch (err) {
      logger.error(LOG, 'semanticSearchImages 失败', err)
      return { success: false, error: (err as Error).message, images: [] }
    }
  })

  logger.info(LOG, 'AI IPC 处理器已注册')
}

export function unregisterAiHandlers(): void {
  for (const channel of ['getAiStatus', 'setAiEnabled', 'semanticSearchImages']) {
    ipcMain.removeHandler(channel)
  }
}
