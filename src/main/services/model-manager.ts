import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import type { ModelInfo } from '../../types/plugin'
import { logger } from '../../utils/logger'

/**
 * 模型管理器
 * 负责模型注册、路径解析、SHA256 完整性校验及下载状态追踪。
 * 模型文件存储于 %APPDATA%\luuk\models\ 目录。
 */
export class ModelManager {
  private readonly modelsDir: string
  private readonly models = new Map<string, ModelInfo>()

  constructor(modelsDir: string) {
    this.modelsDir = modelsDir
  }

  /** 注册模型到清单（幂等：同 id 会覆盖） */
  registerModel(model: ModelInfo): void {
    this.models.set(model.id, { ...model })
  }

  /** 获取模型信息（不存在返回 undefined） */
  getModelInfo(id: string): ModelInfo | undefined {
    const info = this.models.get(id)
    return info ? { ...info } : undefined
  }

  /** 返回所有已注册模型的副本列表 */
  listModels(): ModelInfo[] {
    return Array.from(this.models.values()).map(m => ({ ...m }))
  }

  /**
   * 获取模型本地路径。
   * 返回模型预期存储路径（不保证文件已存在），调用方需自行检查文件可用性。
   * 未注册的模型返回 null。
   */
  getModelPath(id: string): string | null {
    const info = this.models.get(id)
    if (!info) return null
    // 优先使用已记录的 localPath
    if (info.localPath) return info.localPath
    // 回退到约定路径：modelsDir/id
    const expected = path.join(this.modelsDir, id)
    return expected
  }

  /**
   * SHA256 完整性校验。
   * 文件不存在 → 返回 false（不抛错）。
   * 校验失败 → 删除文件并返回 false，触发调用方重新下载。
   */
  async verifyModel(id: string): Promise<boolean> {
    const info = this.models.get(id)
    if (!info) return false

    const filePath = this.getModelPath(id)
    if (!filePath) return false

    let fileBuffer: Buffer
    try {
      fileBuffer = await fs.readFile(filePath)
    } catch {
      // 文件不存在或读取失败
      return false
    }

    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    if (actualHash === info.sha256) {
      return true
    }

    // 校验失败：删除损坏文件
    try {
      await fs.unlink(filePath)
    } catch (err) {
      logger.warn('ModelManager', `删除损坏模型文件失败: ${filePath}`, err)
    }
    return false
  }

  /** 更新下载进度（0-100） */
  updateProgress(id: string, progress: number): void {
    const info = this.models.get(id)
    if (!info) return
    info.progress = Math.max(0, Math.min(100, progress))
    info.state = 'downloading'
  }

  /** 标记模型下载完成，记录本地路径 */
  markDownloaded(id: string, filePath: string): void {
    const info = this.models.get(id)
    if (!info) return
    info.state = 'downloaded'
    info.localPath = filePath
    info.progress = 100
  }

  /** 标记模型下载失败 */
  markFailed(id: string): void {
    const info = this.models.get(id)
    if (!info) return
    info.state = 'failed'
  }
}
