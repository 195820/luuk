import { ipcMain } from 'electron'
import { logger } from '../../utils/logger'
import { getSetting, setSetting } from '../services/settings-service'

/** 渲染进程可读写的设置白名单（仅暴露插件系统需要的 key） */
const ALLOWED_KEYS = [
  'plugins.enabled',
  'ai.enabled',
  'crawler.enabled',
  'models.directory',
] as const

type AllowedKey = (typeof ALLOWED_KEYS)[number]

function isAllowed(key: string): key is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key)
}

/** 注册 Settings IPC 处理器（feature flag 等最小集） */
export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', async (_e, key: string) => {
    try {
      if (!isAllowed(key)) {
        return { success: false, error: `设置项不可读: ${key}` }
      }
      return { success: true, data: getSetting(key) }
    } catch (err) {
      logger.error('SettingsHandlers', 'settings:get 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
    try {
      if (!isAllowed(key)) {
        return { success: false, error: `设置项不可写: ${key}` }
      }
      setSetting(key, value as never)
      return { success: true }
    } catch (err) {
      logger.error('SettingsHandlers', 'settings:set 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info('SettingsHandlers', 'Settings IPC 处理器已注册')
}

/** 注销 Settings IPC 处理器 */
export function unregisterSettingsHandlers(): void {
  ipcMain.removeHandler('settings:get')
  ipcMain.removeHandler('settings:set')
}
