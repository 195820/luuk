import * as fs from 'fs/promises'
import * as nodeFs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ModelInfo } from '../../types/plugin'
import { logger } from '../../utils/logger'

/**
 * 模型管理器
 * 负责模型注册、路径解析、SHA256 完整性校验及下载状态追踪。
 * 模型文件存储于 %APPDATA%\luuk\models\ 目录。
 */
export class ModelManager {
  /**
   * [P2-18] 模型目录解析器：支持传入固定字符串或运行期函数。
   * 传函数时每次使用都重新读取（用户改 `models.directory` 设置后无需重启即生效）。
   */
  private readonly modelsDirResolver: () => string
  private readonly models = new Map<string, ModelInfo>()

  constructor(modelsDir: string | (() => string)) {
    this.modelsDirResolver = typeof modelsDir === 'string' ? () => modelsDir : modelsDir
  }

  /** 当前模型目录（运行期解析） */
  private get modelsDir(): string {
    return this.modelsDirResolver()
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
   * SHA256 完整性校验（流式，避免大文件整读 OOM）。
   * 文件不存在 → 返回 false（不抛错、不删文件）。
   * sha256 缺失/空 → 仅校验存在性 + 告警，不删文件，成功回写 downloaded（P1-8 防误删）。
   * 校验成功 → markDownloaded；失败 → 删除损坏文件并返回 false。
   */
  async verifyModel(id: string): Promise<boolean> {
    const info = this.models.get(id)
    if (!info) return false

    const filePath = this.getModelPath(id)
    if (!filePath) return false

    if (!nodeFs.existsSync(filePath)) return false

    // sha256 缺失/空：无法做完整性比对，降级为"仅确认文件存在"，不删文件
    if (!info.sha256 || !String(info.sha256).trim()) {
      logger.warn(
        'ModelManager',
        `模型 ${id} 未登记 sha256，跳过完整性校验（仅确认文件存在）: ${filePath}`
      )
      this.markDownloaded(id, filePath)
      return true
    }

    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filePath)
    for await (const chunk of stream) {
      hash.update(chunk as Buffer)
    }
    const actualHash = hash.digest('hex')

    if (actualHash === String(info.sha256).toLowerCase()) {
      this.markDownloaded(id, filePath)
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

  /**
   * 真实 HTTP 下载（.part 断点续传 + 流式写入 + SHA256 校验）。
   * @param onProgress 进度回调（0-100）
   */
  async downloadModel(id: string, onProgress?: (pct: number) => void): Promise<void> {
    const info = this.models.get(id)
    if (!info) throw new Error(`模型未注册: ${id}`)
    if (!info.url) throw new Error(`模型 ${id} 无下载 URL`)

    await fs.mkdir(this.modelsDir, { recursive: true })
    const finalPath = path.join(this.modelsDir, id)
    const partPath = `${finalPath}.part`

    // 已完成且校验通过 → 直接返回
    if (nodeFs.existsSync(finalPath) && (await this.verifyModel(id))) {
      this.markDownloaded(id, finalPath)
      onProgress?.(100)
      return
    }

    const existingSize = nodeFs.existsSync(partPath) ? nodeFs.statSync(partPath).size : 0
    const total = info.size || 0

    const headers: Record<string, string> = {}
    if (existingSize > 0) headers.Range = `bytes=${existingSize}-`

    info.state = 'downloading'
    // 候选源：主 URL + 镜像列表（主源被墙/失败时逐个回退）
    const candidates = [info.url, ...(info.mirrorUrls ?? [])].filter((u): u is string => Boolean(u))
    let response: Response | null = null
    let lastErr = ''
    for (const candidate of candidates) {
      try {
        const r = await fetch(candidate, { headers })
        if (r.ok || r.status === 206) { response = r; break }
        lastErr = `HTTP ${r.status}`
        r.body?.cancel?.()
      } catch (err) {
        lastErr = (err as Error).message
      }
    }
    if (!response) {
      this.markFailed(id)
      throw new Error(`模型下载失败（已尝试 ${candidates.length} 个源）: ${lastErr}`)
    }
    if (!response.body) {
      this.markFailed(id)
      throw new Error('模型下载失败: 响应体为空')
    }

    // 206 → 追加；200 → 从头覆盖
    const append = response.status === 206 && existingSize > 0
    const startOffset = append ? existingSize : 0
    if (!append && existingSize > 0) {
      // 服务器不支持 Range → 清空重下
      await fs.unlink(partPath).catch(() => {})
    }

    const nodeStream = Readable.fromWeb(response.body as any)
    let received = startOffset
    let lastPct = -1
    const out = nodeFs.createWriteStream(partPath, { flags: append ? 'a' : 'w' })
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total > 0) {
        const pct = Math.min(99, Math.round((received / total) * 100))
        if (pct !== lastPct) {
          lastPct = pct
          info.progress = pct
          onProgress?.(pct)
        }
      }
    })

    try {
      await pipeline(nodeStream, out)
    } catch (err) {
      this.markFailed(id)
      throw new Error(`模型下载中断: ${(err as Error).message}`)
    }

    // 原子重命名 + 校验
    await fs.rename(partPath, finalPath)
    info.localPath = finalPath
    const ok = await this.verifyModel(id)
    if (!ok) {
      this.markFailed(id)
      throw new Error(`模型校验失败(SHA256 不匹配): ${id}`)
    }
    this.markDownloaded(id, finalPath)
    onProgress?.(100)
    logger.info('ModelManager', `模型下载完成: ${id}`)
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
