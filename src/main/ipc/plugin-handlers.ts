import { ipcMain } from 'electron'
import { logger } from '../../utils/logger'
import type { PluginInfo } from '../../types'

/**
 * PluginManager 占位接口
 * Task 12 实现后替换为真实导入
 */
interface PluginManagerStub {
  getAllPlugins(): PluginInfo[]
  getPlugin(pluginId: string): PluginInfo | undefined
  setEnabled(pluginId: string, enabled: boolean): Promise<void>
  executeOp(pluginId: string, opId: string, input: unknown): Promise<unknown>
  getMenuItems(context?: string): Array<{ pluginId: string; op: string; label: string; context: string[] }>
}

/** 延迟获取 PluginManager（Task 12 完成后自动接入） */
function getPluginManager(): PluginManagerStub {
  // TODO: Task 12 完成后替换为真实导入
  // return (await import('../services/plugin-manager')).getPluginManager()
  return {
    getAllPlugins: () => [],
    getPlugin: () => undefined,
    setEnabled: async () => { throw new Error('PluginManager 未就绪（Task 12 待实现）') },
    executeOp: async () => { throw new Error('PluginManager 未就绪（Task 12 待实现）') },
    getMenuItems: () => [],
  }
}

/** 注册插件相关 IPC 处理器 */
export function registerPluginHandlers(): void {
  // 获取所有插件列表
  ipcMain.handle('plugins:list', async () => {
    try {
      const pm = getPluginManager()
      return { success: true, data: pm.getAllPlugins() }
    } catch (err) {
      logger.error('PluginHandlers', 'plugins:list 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取单个插件详情
  ipcMain.handle('plugins:get', async (_event, pluginId: string) => {
    try {
      const pm = getPluginManager()
      const plugin = pm.getPlugin(pluginId)
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
      const result = await pm.executeOp(pluginId, opId, input)
      return { success: true, data: result }
    } catch (err) {
      logger.error('PluginHandlers', 'plugins:execute 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取菜单项（可按上下文过滤）
  ipcMain.handle('plugins:getMenuItems', async (_event, context?: string) => {
    try {
      const pm = getPluginManager()
      return { success: true, data: pm.getMenuItems(context) }
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
