/**
 * 主进程侧 luuk.* SDK 宿主
 *
 * 处理 Worker 经反向 RPC 发来的 SDK 调用：
 * - 权限校验（插件须 activated，且声明了对应 permission）
 * - 路由到具体服务（fs / edit / jobs / settings / library / 模型路径解析）
 * - Phase 8 占位 API（browser/fetch/mask）直接抛 NOT_IMPLEMENTED
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../../utils/logger'
import { getSetting, setSetting } from '../services/settings-service'
import type { JobRunner } from '../services/job-runner'
import type { EditsService } from '../services/edits-service'
import type { ModelManager } from '../services/model-manager'
import type { PluginLoader } from './plugin-loader'
import type { MasterDB } from '../services/database'
import type { PluginPermission, WorkerToMainRequest } from '../../types/plugin'

/** 权限错误（RPC code = PERMISSION_DENIED） */
export class PermissionError extends Error {
  code = 'PERMISSION_DENIED'
  constructor(message: string) {
    super(message)
    this.name = 'PERMISSION_DENIED'
  }
}

/** 未实现错误（RPC code = NOT_IMPLEMENTED） */
export class NotImplementedError extends Error {
  code = 'NOT_IMPLEMENTED'
  constructor(api: string) {
    super(`luuk.${api} 在当前 Phase 未实现`)
    this.name = 'NOT_IMPLEMENTED'
  }
}

/**
 * SDK 方法 → 所需权限映射（封闭枚举）。
 * null 表示无需声明权限；image.* 在 Worker 本地执行不经此路径。
 */
const API_PERMISSION_MAP: Record<string, PluginPermission | null> = {
  'sdk.library.query': 'library.read',
  'sdk.library.writeEmbedding': 'library.write',
  'sdk.fs.read': 'fs.read.library',
  'sdk.fs.write': 'fs.write.output',
  'sdk.inference.resolveModel': 'inference',
  'sdk.jobs.enqueue': 'jobs',
  'sdk.edit.write': 'edit.write',
  'sdk.progress.report': null,
  'sdk.log.info': null,
  'sdk.log.warn': null,
  'sdk.log.error': null,
  'sdk.settings.get': null,
  'sdk.settings.set': null,
}

/** 渲染进程/插件可读写的设置白名单 */
const ALLOWED_SETTING_KEYS = new Set([
  'plugins.enabled',
  'ai.enabled',
  'crawler.enabled',
  'models.directory',
])

export class PluginSdkHost {
  constructor(
    private loader: PluginLoader,
    private jobRunner: JobRunner,
    private editsService: EditsService,
    private modelManager: ModelManager,
    private db: MasterDB,
  ) {}

  /** 入口：处理 Worker 发来的 SDK 调用 */
  async handleCall(req: WorkerToMainRequest): Promise<unknown> {
    const plugin = this.loader.getPlugin(req.pluginId)
    if (!plugin || plugin.state !== 'activated') {
      throw new PermissionError(`插件未激活，拒绝调用: ${req.pluginId}`)
    }

    // browser/fetch/mask 占位：即使声明权限也拒绝
    if (req.method.startsWith('sdk.browser.') || req.method.startsWith('sdk.fetch.') || req.method.startsWith('sdk.mask.')) {
      const domain = req.method.split('.')[1]
      throw new NotImplementedError(domain)
    }

    const requiredPerm = API_PERMISSION_MAP[req.method]
    if (requiredPerm !== null && requiredPerm !== undefined) {
      const granted = plugin.manifest.permissions ?? []
      if (!granted.includes(requiredPerm)) {
        throw new PermissionError(`插件 ${req.pluginId} 缺少权限: ${requiredPerm}`)
      }
    } else if (requiredPerm === undefined && !req.method.startsWith('sdk.')) {
      throw new PermissionError(`未知 SDK 方法: ${req.method}`)
    }

    return this.dispatch(req)
  }

  private async dispatch(req: WorkerToMainRequest): Promise<unknown> {
    const p = req.params as Record<string, any>
    switch (req.method) {
      case 'sdk.fs.read':
        return this.fsRead(req.pluginId, String(p.path))
      case 'sdk.fs.write':
        return this.fsWrite(String(p.path), p.data)
      case 'sdk.edit.write':
        return this.editWrite(req.pluginId, p)
      case 'sdk.jobs.enqueue':
        return this.jobRunner.enqueue(p.kind, p.payload, p.opts)
      case 'sdk.settings.get':
        return this.settingsGet(String(p.key))
      case 'sdk.settings.set':
        return this.settingsSet(String(p.key), p.value)
      case 'sdk.inference.resolveModel':
        return this.resolveModel(String(p.modelId))
      case 'sdk.library.query':
        return this.libraryQuery(p)
      case 'sdk.progress.report':
        logger.info('PluginSdk', `进度 ${req.pluginId}: ${p.pct}% ${p.message ?? ''}`)
        return null
      case 'sdk.log.info':
        logger.info(`Plugin:${req.pluginId}`, String(p.msg))
        return null
      case 'sdk.log.warn':
        logger.warn(`Plugin:${req.pluginId}`, String(p.msg))
        return null
      case 'sdk.log.error':
        logger.error(`Plugin:${req.pluginId}`, String(p.msg))
        return null
      case 'sdk.library.writeEmbedding':
        throw new NotImplementedError('library.writeEmbedding')
      default:
        throw new PermissionError(`未支持的 SDK 方法: ${req.method}`)
    }
  }

  /** 读取库内文件（限制在某个库根目录内，Windows 大小写不敏感） */
  private async fsRead(_pluginId: string, filePath: string): Promise<Uint8Array> {
    this.assertWithinLibrary(filePath)
    const buf = await fs.promises.readFile(filePath)
    return new Uint8Array(buf)
  }

  private async fsWrite(filePath: string, data: Uint8Array | ArrayBuffer): Promise<void> {
    this.assertWithinLibrary(filePath)
    const buf = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, buf)
  }

  private async editWrite(
    pluginId: string,
    p: Record<string, any>,
  ): Promise<number> {
    const out = p.outputBuffer
    const buf =
      out instanceof ArrayBuffer
        ? Buffer.from(out)
        : Buffer.from(out.buffer ?? out, out.byteOffset ?? 0, out.byteLength)
    return this.editsService.createEdit(
      Number(p.libraryId ?? 0),
      Number(p.imageId ?? 0),
      String(p.sourcePath),
      pluginId,
      String(p.op),
      buf,
      {
        params: p.params,
        modelId: p.modelId,
        parentEditId: p.parentEditId,
        format: p.format,
      },
    )
  }

  private async resolveModel(modelId: string): Promise<string> {
    const info = this.modelManager.getModelInfo(modelId)
    if (!info) throw new Error(`模型未注册: ${modelId}`)
    const localPath = this.modelManager.getModelPath(modelId)
    if (!localPath) throw new Error(`模型路径无法解析: ${modelId}`)
    if (info.state !== 'downloaded') {
      const ok = await this.modelManager.verifyModel(modelId)
      if (!ok) {
        throw new Error(`模型尚未下载或校验失败，请先下载: ${modelId}`)
      }
    }
    return localPath
  }

  private libraryQuery(_p: Record<string, any>): unknown {
    // Phase 8 内置插件均不依赖 luuk.library.query；保留权限位但暂不实现，
    // 待后续接入分库 ImageDB 查询时补全。
    throw new NotImplementedError('library.query')
  }

  private settingsGet(key: string): unknown {
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      throw new PermissionError(`设置项不可读: ${key}`)
    }
    return getSetting(key as any)
  }

  private settingsSet(key: string, value: unknown): void {
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      throw new PermissionError(`设置项不可写: ${key}`)
    }
    setSetting(key as any, value as any)
  }

  /** 校验绝对路径落在某个已注册库的根目录内 */
  private assertWithinLibrary(filePath: string): void {
    const resolved = path.resolve(filePath).toLowerCase()
    const libraries = this.db.getLibraries()
    const allowed = libraries.some((lib) => {
      const root = path.resolve(lib.rootPath).toLowerCase()
      return resolved === root || resolved.startsWith(root + path.sep.toLowerCase())
    })
    if (!allowed) {
      throw new PermissionError(`路径越权：不在任何库目录内 ${filePath}`)
    }
  }
}
