import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { logger } from '../../utils/logger'
import { getSetting } from './settings-service'
import { getMasterDB } from './database'
import { getJobRunner } from './job-runner'
import { getImageService } from './image-service'
import { PluginLoader } from '../plugins/plugin-loader'
import { PluginHostProcess } from '../plugins/plugin-host-process'
import { PluginSdkHost } from '../plugins/plugin-sdk-host'
import { MemoryMonitor } from './memory-monitor'
import { ModelManager } from './model-manager'
import { EditsService } from './edits-service'
import type {
  PluginInfo,
  MenuItemDefinition,
  MemoryStatus,
} from '../../types/plugin'

/** 内存水位线默认阈值（MB）——聚合口径（P0-3 重标定：Electron 多进程工作集聚合的合理区间）*/
const DEFAULT_YELLOW_MB = 1500
const DEFAULT_RED_MB = 2500
/** 插件 Worker 进程单独红色硬上限默认值（R7 实测峰值上限）*/
const DEFAULT_WORKER_RED_MB = 500

/** 内存监控刷新间隔（毫秒） */
const MEMORY_MONITOR_INTERVAL_MS = 5000

// 工程为 ESM（package.json type: module），主进程 bundle 里没有全局 __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 内置插件目录候选：优先编译产物 dist-electron/plugins/builtins（含 index.js），开发回退源码目录 */
function resolveBuiltinDir(): string {
  const candidates = [
    path.join(__dirname, 'plugins', 'builtins'),
    path.resolve(process.cwd(), 'dist-electron', 'plugins', 'builtins'),
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
  private sdkHost: PluginSdkHost
  private memoryMonitor: MemoryMonitor
  private modelManager: ModelManager
  private editsService: EditsService
  private enabledPlugins = new Set<string>()
  private loadedInWorker = new Set<string>()
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
    // 统一下发内存水位线阈值（Worker 与主进程一致），从设置读取，未配置时回退默认值
    const yellowMB = getSetting('memory.yellowMB') ?? DEFAULT_YELLOW_MB
    const redMB = getSetting('memory.redMB') ?? DEFAULT_RED_MB
    const workerRedMB = getSetting('memory.workerRedMB') ?? DEFAULT_WORKER_RED_MB
    this.hostProcess.setMemoryThresholds(yellowMB, redMB)
    this.memoryMonitor = new MemoryMonitor({
      yellowMB,
      redMB,
      workerRedMB,
    })
    this.editsService = new EditsService(getMasterDB())

    // 主进程侧 SDK 宿主 + 反向 RPC 装配
    this.sdkHost = new PluginSdkHost(
      this.loader,
      getJobRunner(),
      this.editsService,
      this.modelManager,
      getMasterDB(),
    )
    this.hostProcess.onSdkCall((req) => this.sdkHost.handleCall(req))

    // 崩溃熔断：停用全部插件
    this.hostProcess.onCircuitBreak = () => {
      for (const id of this.enabledPlugins) {
        try {
          this.loader.setState(id, 'crashed', 'Worker 连续崩溃，已自动停用')
        } catch {
          /* 忽略 */
        }
      }
      this.enabledPlugins.clear()
      this.loadedInWorker.clear()
      logger.warn('PluginManager', '插件系统已熔断停用')
    }
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

    // 模型清单桥接：把各插件 requires.models 注册到 ModelManager
    for (const plugin of this.loader.getPlugins()) {
      for (const model of plugin.manifest.requires?.models ?? []) {
        this.modelManager.registerModel({
          id: model.id,
          name: model.id,
          size: model.size,
          sha256: model.sha256,
          state: 'not-downloaded',
          url: model.url,
          mirrorUrls: model.mirrorUrls,
        })
      }
    }

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

  /**
   * 启用 / 停用插件
   * - 启用时懒启动 Worker 进程
   * - 停用时从启用集合中移除（Worker 不立即关闭，等待全部停用）
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
      this.enabledPlugins.add(pluginId)
      this.loader.setState(pluginId, 'activated')
      // 懒启动 Worker（首次启用时）
      await this.hostProcess.ensureStarted()
      // 将插件加载进 Worker（幂等）
      if (!this.loadedInWorker.has(pluginId)) {
        const entryPath = path.join(plugin.path, plugin.manifest.entry)
        await this.hostProcess.rpc('plugin.load', { pluginId, entryPath })
        this.loadedInWorker.add(pluginId)
      }
      // 为插件的每个 op 注册 JobRunner handler（批处理链闭合）
      this.registerOpHandlers(pluginId)
      logger.info('PluginManager', `插件已启用: ${pluginId}`)
    } else {
      this.enabledPlugins.delete(pluginId)
      this.loader.setState(pluginId, 'idle')
      // 从 Worker 卸载
      if (this.loadedInWorker.has(pluginId) && this.hostProcess.isReady()) {
        try {
          await this.hostProcess.rpc('plugin.unload', { pluginId })
        } catch (err) {
          logger.warn('PluginManager', `插件卸载失败: ${pluginId}`, err)
        }
        this.loadedInWorker.delete(pluginId)
      }
      logger.info('PluginManager', `插件已停用: ${pluginId}`)

      // 全部停用后关闭 Worker 释放资源
      if (this.enabledPlugins.size === 0) {
        await this.hostProcess.shutdown()
        this.loadedInWorker.clear()
      }
    }
  }

  /** 为插件声明的每个 op 注册 ai.{op} 作业处理器（P0-1 批处理链闭合） */
  private registerOpHandlers(pluginId: string): void {
    const plugin = this.loader.getPlugin(pluginId)
    const ops = plugin?.manifest.contributes?.ops ?? []
    const runner = getJobRunner()
    for (const op of ops) {
      const jobKind = `ai.${op.id}`
      runner.registerHandler(jobKind, async (item) => {
        // 解析绝对路径，与交互式 pluginsExecute 的输入形态统一（P0-1）
        // imageId 为 null（库级 op）时保留 { libraryId, item }，由插件侧显式支持
        const input =
          item.imageId != null
            ? {
                paths: [getImageService().getImagePath(item.libraryId, item.imageId)],
                libraryId: item.libraryId,
                imageId: item.imageId,
              }
            : { libraryId: item.libraryId, item }

        const res = (await this.hostProcess.rpc('plugin.execute', {
          pluginId,
          opId: op.id,
          input,
        })) as { skipped?: boolean } | undefined

        // skipped 语义：插件未真正处理任何文件 → 抛错使 job_item 落 failed，杜绝"零工作却 done"
        if (res && res.skipped) {
          throw new Error(`插件 ${pluginId} 未处理任何文件（skipped），作业项判定为失败`)
        }
      })
    }
  }

  /**
   * 执行插件 op
   * - 前置校验：插件已启用 + 内存非红色水位
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

    // 内存水位线闸门（P0-3）：聚合口径 red 或 Worker 口径 red 任一命中即拒绝，避免 OOM
    if (this.memoryMonitor.isRed() || this.memoryMonitor.isWorkerRed()) {
      const status = this.memoryMonitor.getStatus()
      const workerRss = this.memoryMonitor.getWorkerRssMB()
      throw new Error(
        `内存水位线过高（聚合 ${status.rssMB}MB ≥ ${status.threshold.red}MB 或 Worker ${workerRss}MB 超上限），拒绝执行`
      )
    }

    return this.hostProcess.rpc('plugin.execute', { pluginId, opId, input })
  }

  /** 获取所有已启用插件贡献的菜单项（注入来源 pluginId） */
  getAvailableMenuItems(): MenuItemDefinition[] {
    const items: MenuItemDefinition[] = []

    for (const pluginId of this.enabledPlugins) {
      const info = this.loader.getPlugin(pluginId)
      const menuItems = info?.manifest.contributes?.menuItems
      if (!menuItems) continue
      // 注入 pluginId，供渲染层执行时路由到正确的插件
      items.push(...menuItems.map((m) => ({ ...m, pluginId })))
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
