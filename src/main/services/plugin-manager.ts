import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { logger } from '../../utils/logger'
import { getSetting } from './settings-service'
import { getMasterDB } from './database'
import { PluginLoader } from '../plugins/plugin-loader'
import { PluginHostProcess } from '../plugins/plugin-host-process'
import { MemoryMonitor } from './memory-monitor'
import { ModelManager } from './model-manager'
import { EditsService } from './edits-service'
import type {
  PluginInfo,
  MenuItemDefinition,
  MemoryStatus,
} from '../../types/plugin'

/** 内存水位线默认阈值（MB） */
const DEFAULT_YELLOW_MB = 300
const DEFAULT_RED_MB = 400

/** 内存监控刷新间隔（毫秒） */
const MEMORY_MONITOR_INTERVAL_MS = 5000

// 工程为 ESM（package.json type: module），主进程 bundle 里没有全局 __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 内置插件目录候选：开发时在源码目录，打包后在不同构建布局下位置不一，取最先存在的 */
function resolveBuiltinDir(): string {
  const candidates = [
    path.join(__dirname, 'plugins', 'builtins'),
    path.join(__dirname, '..', 'plugins', 'builtins'),
    path.join(__dirname, 'main', 'plugins', 'builtins'),
    path.resolve(process.cwd(), 'src/main/plugins/builtins'),
  ]
  return candidates.find(dir => fs.existsSync(dir)) ?? candidates[0]
}

/**
 * 插件系统统一入口
 * 协调 PluginLoader / PluginHostProcess / MemoryMonitor / ModelManager / EditsService
 */
export class PluginManager {
  private loader: PluginLoader
  private hostProcess: PluginHostProcess
  private memoryMonitor: MemoryMonitor
  private modelManager: ModelManager
  private editsService: EditsService
  private enabledPlugins = new Set<string>()
  private initialized = false

  constructor() {
    const userDataPath = app.getPath('userData')

    // 内置插件目录（开发为源码目录，打包后为构建产物中的 plugins/builtins）
    const builtinDir = resolveBuiltinDir()
    // 第三方插件目录：%APPDATA%/luuk/plugins
    const thirdPartyDir = path.join(userDataPath, 'plugins')

    this.loader = new PluginLoader(builtinDir, thirdPartyDir)

    // 模型目录：优先用户配置，回退到 userData/models
    const modelsDir =
      getSetting('models.directory') || path.join(userDataPath, 'models')
    this.modelManager = new ModelManager(modelsDir)

    this.hostProcess = new PluginHostProcess()
    this.memoryMonitor = new MemoryMonitor({
      yellowMB: DEFAULT_YELLOW_MB,
      redMB: DEFAULT_RED_MB,
    })
    this.editsService = new EditsService(getMasterDB())
  }

  /**
   * 初始化插件系统
   * - 检查 feature flag `plugins.enabled`
   * - 发现插件 + 启动内存监控
   * - 幂等：重复调用无副作用
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (!getSetting('plugins.enabled')) {
      logger.info('PluginManager', '插件系统未启用（feature flag 关闭）')
      return
    }

    // 发现插件（内置 + 第三方）
    await this.loader.discover()

    // 启动内存水位线监控
    this.memoryMonitor.start(MEMORY_MONITOR_INTERVAL_MS)

    this.initialized = true
    logger.info(
      'PluginManager',
      `插件系统已初始化，发现 ${this.loader.getPlugins().length} 个插件`
    )
  }

  /** 获取所有已发现的插件 */
  getPluginInfos(): PluginInfo[] {
    return this.loader.getPlugins()
  }

  /** 获取单个插件详情 */
  getPluginInfo(pluginId: string): PluginInfo | undefined {
    return this.loader.getPlugin(pluginId)
  }

  /** 插件是否处于启用状态 */
  isPluginEnabled(pluginId: string): boolean {
    return this.enabledPlugins.has(pluginId)
  }

  /**
   * 把插件清单 entry 解析为 Worker 可加载的绝对路径
   * 内置插件随宿主打包，Worker 侧按静态注册表命中，此路径仅作为装载幂等键
   */
  private resolveEntryPath(pluginId: string): string {
    const info = this.loader.getPlugin(pluginId)
    if (!info) {
      throw new Error(`插件不存在: ${pluginId}`)
    }
    return path.join(info.path, info.manifest.entry)
  }

  /** 向 Worker 装载插件（幂等；入口未导出 activate() 时在此抛错） */
  async loadPlugin(pluginId: string): Promise<void> {
    await this.hostProcess.rpc('plugin.load', {
      pluginId,
      entryPath: this.resolveEntryPath(pluginId),
    })
  }

  /**
   * 启用 / 停用插件
   * - 启用时懒启动 Worker 进程并向其装载插件 op 注册表（失败即抛错，不置为 activated）
   * - 停用时从启用集合中移除并卸载 Worker 侧注册表（Worker 不立即关闭，等待全部停用）
   */
  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const plugin = this.loader.getPlugin(pluginId)
    if (!plugin) {
      throw new Error(`插件不存在: ${pluginId}`)
    }
    if (plugin.state === 'invalid') {
      throw new Error(`插件无效，无法启用: ${pluginId} (${plugin.error})`)
    }

    if (enabled) {
      // T12：pc-app 自跑协议栈（如 Telegram MTProto）需 UI 二次确认（M4 落地）；
      // M3 先在启用路径留痕，便于审计高风险权限的开启
      if (plugin.manifest.permissions?.includes('crawler.protocol')) {
        logger.warn('PluginManager', `⚠ 启用带 crawler.protocol 的插件（插件内自跑网络协议栈，绕过宿主退让闸门）: ${pluginId}`)
      }
      // 先启动 Worker 并装载，成功后才改状态：装载失败不留下"已启用但不可调用"的中间态
      await this.hostProcess.ensureStarted()
      await this.loadPlugin(pluginId)
      this.enabledPlugins.add(pluginId)
      this.loader.setState(pluginId, 'activated')
      logger.info('PluginManager', `插件已启用: ${pluginId}`)
    } else {
      this.enabledPlugins.delete(pluginId)
      this.loader.setState(pluginId, 'idle')
      logger.info('PluginManager', `插件已停用: ${pluginId}`)

      // 全部停用后关闭 Worker 释放资源
      if (this.enabledPlugins.size === 0) {
        await this.hostProcess.shutdown()
      } else {
        await this.hostProcess.rpc('plugin.unload', { pluginId }).catch(() => {})
      }
    }
  }

  /**
   * 执行插件 op
   * - 前置校验：插件已启用 + 内存非红色水位
   * - 调用前重复 loadPlugin（Worker 侧幂等）：Worker 崩溃重启后注册表丢失，可自愈
   * - 通过 Worker RPC 调用
   */
  async executeOp(
    pluginId: string,
    opId: string,
    input: unknown
  ): Promise<unknown> {
    if (!this.enabledPlugins.has(pluginId)) {
      throw new Error(`插件未启用: ${pluginId}`)
    }

    // 内存红色水位线 → 拒绝执行，避免 OOM
    if (this.memoryMonitor.isRed()) {
      const status = this.memoryMonitor.getStatus()
      throw new Error(
        `内存水位线过高（${status.rssMB}MB ≥ ${status.threshold.red}MB），拒绝执行`
      )
    }

    await this.loadPlugin(pluginId)
    return this.hostProcess.rpc('plugin.execute', { pluginId, opId, input })
  }

  /** 获取所有已启用插件贡献的菜单项 */
  getAvailableMenuItems(): MenuItemDefinition[] {
    const items: MenuItemDefinition[] = []

    for (const pluginId of this.enabledPlugins) {
      const info = this.loader.getPlugin(pluginId)
      const menuItems = info?.manifest.contributes?.menuItems
      if (!menuItems) continue
      items.push(...menuItems)
    }

    return items
  }

  /** 获取当前内存状态 */
  getMemoryStatus(): MemoryStatus {
    return this.memoryMonitor.getStatus()
  }

  /** 获取模型管理器（供外部注册 / 查询模型） */
  getModelManager(): ModelManager {
    return this.modelManager
  }

  /** 获取编辑服务（供外部写入编辑记录） */
  getEditsService(): EditsService {
    return this.editsService
  }

  /** 优雅关闭插件系统：停止监控 + 关闭 Worker */
  async shutdown(): Promise<void> {
    if (!this.initialized) return

    this.memoryMonitor.stop()
    await this.hostProcess.shutdown()
    this.enabledPlugins.clear()
    this.initialized = false

    logger.info('PluginManager', '插件系统已关闭')
  }
}

// ── 单例 ──

let instance: PluginManager | null = null

/** 获取 PluginManager 单例 */
export function getPluginManager(): PluginManager {
  if (!instance) {
    instance = new PluginManager()
  }
  return instance
}

/** 重置单例（仅用于测试） */
export function resetPluginManager(): void {
  instance = null
}
