import * as fs from 'fs/promises'
import * as path from 'path'
import type { PluginManifest, PluginInfo, PluginState, PluginKind } from '../../types/plugin'

/** 合法的插件种类枚举 */
const VALID_PLUGIN_KINDS: PluginKind[] = [
  'ai-index',
  'ai-transform',
  'diffusion-provider',
  'crawler-adapter',
  'ui-panel'
]

/** 清单必需的字段 */
const REQUIRED_MANIFEST_FIELDS = [
  'id',
  'name',
  'version',
  'apiVersion',
  'kind',
  'entry',
  'capabilities'
] as const

/**
 * 插件加载器
 * 职责：扫描目录、校验清单、管理插件生命周期状态
 */
export class PluginLoader {
  private plugins: Map<string, PluginInfo> = new Map()
  private builtinDir: string
  private thirdPartyDir?: string

  constructor(builtinDir: string, thirdPartyDir?: string) {
    this.builtinDir = builtinDir
    this.thirdPartyDir = thirdPartyDir
  }

  /**
   * 发现所有插件（内置 + 第三方）
   * 扫描目录 → 读取 plugin.json → 校验 → 存入 plugins Map
   */
  async discover(): Promise<PluginInfo[]> {
    this.plugins.clear()

    // 扫描内置插件目录
    await this.scanDirectory(this.builtinDir, true)

    // 扫描第三方插件目录（如果提供）
    if (this.thirdPartyDir) {
      await this.scanDirectory(this.thirdPartyDir, false)
    }

    return Array.from(this.plugins.values())
  }

  /**
   * 获取指定 ID 的插件
   */
  getPlugin(id: string): PluginInfo | undefined {
    return this.plugins.get(id)
  }

  /**
   * 获取所有已发现的插件
   */
  getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values())
  }

  /**
   * 设置插件状态
   */
  setState(id: string, state: PluginState, error?: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) {
      throw new Error(`插件不存在: ${id}`)
    }

    plugin.state = state
    if (error) {
      plugin.error = error
    }
  }

  /**
   * 扫描指定目录下的所有插件
   */
  private async scanDirectory(dir: string, isBuiltin: boolean): Promise<void> {
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) {
        return
      }

      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const pluginDir = path.join(dir, entry.name)
        await this.loadPlugin(pluginDir, isBuiltin)
      }
    } catch (error) {
      // 目录不存在或读取失败，静默忽略（不阻塞启动）
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[PluginLoader] 扫描目录失败: ${dir}`, error)
      }
    }
  }

  /**
   * 加载单个插件（读取并校验 plugin.json）
   */
  private async loadPlugin(pluginDir: string, isBuiltin: boolean): Promise<void> {
    const manifestPath = path.join(pluginDir, 'plugin.json')

    try {
      // 读取 plugin.json
      const manifestContent = await fs.readFile(manifestPath, 'utf-8')
      const manifest: PluginManifest = JSON.parse(manifestContent)

      // 校验清单
      const validationResult = await this.validateManifest(manifest, pluginDir)

      const pluginInfo: PluginInfo = {
        manifest,
        state: validationResult.valid ? 'valid' : 'invalid',
        path: pluginDir,
        isBuiltin,
        error: validationResult.error
      }

      // 存入 Map（以 manifest.id 为键，缺失时用目录名兜底）
      const pluginId = manifest.id || path.basename(pluginDir)
      this.plugins.set(pluginId, pluginInfo)
    } catch (error) {
      // 读取或解析失败 → 标记为 invalid
      const errorMessage = error instanceof Error ? error.message : String(error)
      const pluginId = path.basename(pluginDir)

      // 创建一个最小的 invalid 插件记录
      const invalidPlugin: PluginInfo = {
        manifest: {
          id: pluginId,
          name: pluginId,
          version: '0.0.0',
          apiVersion: '0.0.0',
          kind: 'ai-index', // 默认值，实际会被标记为 invalid
          entry: '',
          capabilities: []
        },
        state: 'invalid',
        path: pluginDir,
        isBuiltin,
        error: `读取清单失败: ${errorMessage}`
      }

      this.plugins.set(pluginId, invalidPlugin)
    }
  }

  /**
   * 校验插件清单
   * 规则：
   * 1. 必需字段完整
   * 2. kind 是合法枚举值
   * 3. entry 文件存在
   */
  private async validateManifest(
    manifest: PluginManifest,
    pluginDir: string
  ): Promise<{ valid: boolean; error?: string }> {
    // 检查必需字段
    for (const field of REQUIRED_MANIFEST_FIELDS) {
      if (!(field in manifest)) {
        return {
          valid: false,
          error: `缺少必需字段: ${field}`
        }
      }
    }

    // 检查 kind 是否为合法枚举值
    if (!VALID_PLUGIN_KINDS.includes(manifest.kind)) {
      return {
        valid: false,
        error: `无效的插件种类: ${manifest.kind}，期望值: ${VALID_PLUGIN_KINDS.join(', ')}`
      }
    }

    // 检查 entry 文件是否存在
    const entryPath = path.join(pluginDir, manifest.entry)
    const entryExists = await this.fileExists(entryPath)

    if (!entryExists) {
      return {
        valid: false,
        error: `入口文件不存在: ${manifest.entry}`
      }
    }

    return { valid: true }
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
