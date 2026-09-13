import { ipcMain } from 'electron'
import { logger } from '../../utils/logger'
import { getPluginManager } from '../services/plugin-manager'

/** 注册插件相关 IPC 处理器 */
export function registerPluginHandlers(): void {
  // 获取所有插件列表
  ipcMain.handle('plugins:list', async () => {
    try {
      const pm = getPluginManager()
      await pm.initialize()
      return { success: true, data: pm.getPluginInfos() }
    } catch (err) {
      logger.error('PluginHandlers', 'plugins:list 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取单个插件详情
  ipcMain.handle('plugins:get', async (_event, pluginId: string) => {
    try {
      const pm = getPluginManager()
      await pm.initialize()
      const plugin = pm.getPluginInfo(pluginId)
      if (!plugin) {
        return { success: false, error: `插件不存在: ${pluginId}` }
      }
      return { success: true, data: plugin }
    } catch (err) {
      logger.error('PluginHandlers', 'plugins:get 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 启用/停用插件
  ipcMain.handle('plugins:setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      const pm = getPluginManager()
      await pm.initialize()
      await pm.setEnabled(pluginId, enabled)
      return { success: true }
    } catch (err) {
      logger.error('PluginHandlers', 'plugins:setEnabled 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 执行插件 op
  ipcMain.handle('plugins:execute', async (_event, pluginId: string, opId: string, input: unknown) => {
    try {
      const pm = getPluginManager()
      await pm.initialize()
      const result = await pm.executeOp(pluginId, opId, input)
      return { success: true, data: result }
    } catch (err) {
      logger.error('PluginHandlers', 'plugins:execute 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取菜单项（来自已启用插件）
  ipcMain.handle('plugins:getMenuItems', async () => {
    try {
      const pm = getPluginManager()
      await pm.initialize()
      return { success: true, data: pm.getAvailableMenuItems() }
    } catch (err) {
      logger.error('PluginHandlers', 'plugins:getMenuItems 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info('PluginHandlers', '插件 IPC 处理器已注册')
}

/** 注销插件 IPC 处理器 */
export function unregisterPluginHandlers(): void {
  const channels = ['plugins:list', 'plugins:get', 'plugins:setEnabled', 'plugins:execute', 'plugins:getMenuItems']
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }
}
