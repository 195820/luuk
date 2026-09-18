import { ipcMain, BrowserWindow } from 'electron'
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

  // ── 模型管理 ──

  ipcMain.handle('models:list', async () => {
    try {
      const pm = getPluginManager()
      await pm.initialize()
      return { success: true, data: pm.getModelManager().listModels() }
    } catch (err) {
      logger.error('PluginHandlers', 'models:list 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('models:download', async (_event, modelId: string) => {
    try {
      const pm = getPluginManager()
      await pm.initialize()
      const mm = pm.getModelManager()
      // 异步下载，进度通过 webContents 推送
      void mm
        .downloadModel(modelId, (pct) => {
          for (const w of BrowserWindow.getAllWindows()) {
            w.webContents.send('model-download-progress', { modelId, progress: pct })
          }
        })
        .catch((err) => {
          logger.error('PluginHandlers', `模型下载失败: ${modelId}`, err)
          for (const w of BrowserWindow.getAllWindows()) {
            w.webContents.send('model-download-progress', {
              modelId,
              progress: -1,
              error: (err as Error).message,
            })
          }
        })
      return { success: true }
    } catch (err) {
      logger.error('PluginHandlers', 'models:download 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('models:verify', async (_event, modelId: string) => {
    try {
      const pm = getPluginManager()
      const ok = await pm.getModelManager().verifyModel(modelId)
      return { success: true, data: ok }
    } catch (err) {
      logger.error('PluginHandlers', 'models:verify 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info('PluginHandlers', '插件 IPC 处理器已注册')
}

/** 注销插件 IPC 处理器 */
export function unregisterPluginHandlers(): void {
  const channels = [
    'plugins:list', 'plugins:get', 'plugins:setEnabled', 'plugins:execute', 'plugins:getMenuItems',
    'models:list', 'models:download', 'models:verify',
  ]
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }
}
