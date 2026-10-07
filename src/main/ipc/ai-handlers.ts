/**
 * Phase 9 M5 · T21 — AI 层 IPC 与主进程装配入口（薄胶水，真逻辑在 ai-wiring.ts）。
 *
 * 负责：开发期解析 cache 内 CLIP 模型路径、启动装配 AI 层、getAiStatus/setAiEnabled IPC、退出清理。
 */
import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { logger } from '../../utils/logger'
import { getSetting, setSetting } from '../services/settings-service'
import { getJobRunner } from '../services/job-runner'
import { getImageService } from '../services/image-service'
import { getMasterDB, getVectorsDB } from '../services/database'
import { closeAllVectorIndexServices } from '../services/vectors/vector-index-service'
import {
  ensureAiLayerOnBoot as wireAiLayer,
  disposeAiLayer,
  CLIP_MODEL_ID,
} from '../services/ai/ai-wiring'

const LOG = 'AiHandlers'

/** 开发期：在若干基准目录找 cache/poc-r2 的 int8 模型；找不到返回 null（AI 层退回零引擎） */
export function resolveClipModelFile(): string | null {
  const file = path.join('cache', 'poc-r2', 'clip-vit-b32-int8.onnx')
  const bases: Array<string | null> = []
  try { bases.push(process.cwd()) } catch { /* ignore */ }
  try { bases.push(app.getAppPath()) } catch { /* ignore */ }
  for (const b of bases) {
    if (!b) continue
    const f = path.join(b, file)
    if (fs.existsSync(f)) return f
  }
  return null
}

/** 启动/开关变更后装配 AI 层（ai.enabled=false 内部会拆监听卸层，零推理） */
export async function ensureAiLayerOnBoot(): Promise<void> {
  await wireAiLayer({
    modelsDir: path.join(app.getPath('userData'), 'models'),
    modelFile: resolveClipModelFile(),
    runner: getJobRunner(),
    imageService: getImageService(),
  })
}

/** 退出清理：卸载引擎会话 + 关闭本进程内所有库的 ANN sidecar（落盘） */
export function disposeAiOnQuit(): void {
  disposeAiLayer(getImageService())
  try {
    closeAllVectorIndexServices()
  } catch (err) {
    logger.warn(LOG, '关闭向量索引服务异常（忽略）', err)
  }
}

export function registerAiHandlers(): void {
  ipcMain.handle('getAiStatus', async () => {
    try {
      const enabled = getSetting('ai.enabled')
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

  ipcMain.handle('setAiEnabled', async (_e, enabled: boolean) => {
    try {
      setSetting('ai.enabled', Boolean(enabled))
      await ensureAiLayerOnBoot()
      return { success: true, data: { enabled: getSetting('ai.enabled') } }
    } catch (err) {
      logger.error(LOG, 'setAiEnabled 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info(LOG, 'AI IPC 处理器已注册')
}

export function unregisterAiHandlers(): void {
  for (const channel of ['getAiStatus', 'setAiEnabled']) {
    ipcMain.removeHandler(channel)
  }
}
