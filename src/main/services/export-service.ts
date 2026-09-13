import sharp from 'sharp'
import * as archiverModule from 'archiver'
import type { Archiver } from 'archiver'
import { createWriteStream, promises as fsp } from 'fs'
import { join, basename, extname, parse } from 'path'
import { pipeline } from 'stream/promises'
import { logger } from '../../utils/logger'
import type { ExportOptions } from '../../types'

/**
 * archiver@7 运行时导出可调用工厂（`archiver('zip', opts)`）与 `create()`；
 * 但当前 @types/archiver 声明的是 v8 风格的类导出（ZipArchive/TarArchive），既无
 * default 也无可调用签名：`import archiver from 'archiver'` 报 TS1192，
 * `new archiverModule.ZipArchive()` 运行时 not a constructor。两者无法同时成立。
 * 此处用命名空间导入 + 运行时形态探测，兼容不同打包器（esbuild/rollup）对 CJS 的
 * interop：依次尝试命名空间本身 / .default / .create，取到真正可调用的工厂。
 */
type ArchiverFactory = (
  format: 'zip' | 'tar' | 'json',
  options?: Record<string, unknown>
) => Archiver

function resolveArchiverFactory(): ArchiverFactory {
  const m = archiverModule as unknown as {
    default?: unknown
    create?: unknown
  }
  if (typeof m === 'function') return m as unknown as ArchiverFactory
  if (typeof m.default === 'function') return m.default as ArchiverFactory
  if (typeof m.create === 'function') return (m.create as ArchiverFactory).bind(m)
  throw new Error('archiver 运行时工厂不可用（interop 形态未命中）')
}

const createArchive = resolveArchiverFactory()

/**
 * 导出服务 — 支持单图导出 + 批量 ZIP 导出
 * 特性：
 * - 格式转换（JPG/PNG/WEBP/原始）
 * - 尺寸调整（可选）
 * - 质量调节（可选）
 * - 批量导出为 ZIP（流式写入，避免内存溢出）
 * - 单文件失败不中断批量
 * - 支持取消（AbortController）
 * - 进度反馈（IPC 事件）
 */
export class ExportService {
  private abortControllers = new Map<string, AbortController>()

  /**
   * 导出单张图片
   * @param imagePath 源图片绝对路径
   * @param opts 导出选项
   * @param taskId 任务 ID（用于取消）
   * @returns 输出文件绝对路径
   */
  async exportSingle(
    imagePath: string,
    opts: ExportOptions,
    taskId: string
  ): Promise<string> {
    const ac = new AbortController()
    this.abortControllers.set(taskId, ac)

    try {
      let pipe = sharp(imagePath, { failOn: 'none' })

      // 尺寸调整
      if (opts.maxWidth) {
        pipe = pipe.resize({
          width: opts.maxWidth,
          withoutEnlargement: true,
        })
      }

      // 输出路径
      const outPath = this.resolveOutPath(imagePath, opts)

      if (opts.format === 'original') {
        // 原始格式：直接复制
        await fsp.copyFile(imagePath, outPath)
      } else {
        // 格式转换
        await pipe
          .toFormat(opts.format, { quality: opts.quality ?? 90 })
          .toFile(outPath)
      }

      logger.info('ExportService', `单图导出成功: ${outPath}`)
      return outPath
    } catch (err) {
      logger.error('ExportService', '单图导出失败', err)
      throw err
    } finally {
      this.abortControllers.delete(taskId)
    }
  }

  /**
   * 批量导出为 ZIP
   * @param files 待导出文件（绝对路径 + ZIP 条目名，条目名需携带相对目录避免同名冲突）
   * @param opts 导出选项
   * @param taskId 任务 ID（用于取消）
   * @param onProgress 进度回调（done, total）
   */
  async exportBatch(
    files: Array<{ absPath: string; name: string }>,
    opts: ExportOptions,
    taskId: string,
    onProgress: (done: number, total: number) => void
  ): Promise<void> {
    const ac = new AbortController()
    this.abortControllers.set(taskId, ac)

    const output = createWriteStream(opts.outputPath)
    const archive = createArchive('zip', { zlib: { level: 6 } })
    let archiveError: Error | null = null

    archive.on('warning', (err: Error) => {
      logger.warn('ExportService', 'ZIP 警告:', err.message)
    })

    // 不在 EventEmitter 回调中同步 throw（会变成主进程未捕获异常），改为捕获后统一抛出
    archive.on('error', (err: Error) => {
      archiveError = err
      logger.error('ExportService', 'ZIP 错误:', err.message)
    })

    // 流式管道：吞掉 rejection，一律由 archiveError 向上传播
    const pipelinePromise = pipeline(archive, output).catch((err: unknown) => {
      archiveError ??= err instanceof Error ? err : new Error(String(err))
    })

    const total = files.length
    const errorLog: Array<{ name: string; error: string }> = []
    const usedNames = new Set<string>()

    try {
      for (let i = 0; i < total; i++) {
        // 检查取消信号
        if (ac.signal.aborted) {
          logger.info('ExportService', '批量导出已取消')
          archive.abort()
          // 等待输出流 close（释放文件句柄），确保 Windows 下 unlink 不因占用失败
          await new Promise<void>((resolve) => {
            output.once('close', () => resolve())
            output.destroy()
          })
          await pipelinePromise
          await fsp.unlink(opts.outputPath).catch(() => {})
          return
        }

        const file = files[i]

        try {
          const buf = await this.transformBuffer(file.absPath, opts)
          const entryName = this.dedupeName(this.zipEntryName(file.name, opts), usedNames)
          archive.append(buf, { name: entryName })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error('ExportService', `跳过失败文件: ${file.absPath}`, err)
          errorLog.push({ name: file.name, error: errorMsg })
          // 单文件失败不中断批量
        }

        onProgress(i + 1, total)
      }

      // 启动收尾（不 await：archive 出错时 finalize 可能挂起，由 pipeline/archiveError 兜底）
      archive.finalize().catch(() => {})
      await pipelinePromise

      if (archiveError) {
        // 清理半成品 ZIP，避免残留
        await fsp.unlink(opts.outputPath).catch(() => {})
        throw archiveError
      }

      if (errorLog.length > 0) {
        logger.warn(
          'ExportService',
          `批量导出完成，${errorLog.length}/${total} 个文件失败`
        )
      } else {
        logger.info('ExportService', `批量导出成功: ${opts.outputPath}`)
      }
    } finally {
      this.abortControllers.delete(taskId)
    }
  }

  /**
   * 取消导出任务
   * @param taskId 任务 ID
   */
  cancel(taskId: string): void {
    const ac = this.abortControllers.get(taskId)
    if (ac) {
      ac.abort()
      this.abortControllers.delete(taskId)
      logger.info('ExportService', `任务已取消: ${taskId}`)
    }
  }

  /**
   * 将图片转换为 Buffer
   * @param imagePath 源图片路径
   * @param opts 导出选项
   * @returns 转换后的 Buffer
   */
  private async transformBuffer(
    imagePath: string,
    opts: ExportOptions
  ): Promise<Buffer> {
    let pipe = sharp(imagePath, { failOn: 'none' })

    if (opts.maxWidth) {
      pipe = pipe.resize({
        width: opts.maxWidth,
        withoutEnlargement: true,
      })
    }

    if (opts.format === 'original') {
      // 原始格式：直接读取原始字节，避免 sharp 重编码（与 exportSingle 的 copyFile 语义一致）
      return fsp.readFile(imagePath)
    }

    return pipe.toFormat(opts.format, { quality: opts.quality ?? 90 }).toBuffer()
  }

  /**
   * 解析输出文件路径
   * @param imagePath 源图片路径
   * @param opts 导出选项
   * @returns 输出文件绝对路径
   */
  private resolveOutPath(imagePath: string, opts: ExportOptions): string {
    const dir = opts.outputPath
    const baseName = opts.format === 'original'
      ? basename(imagePath)  // 保留原扩展名
      : basename(imagePath, extname(imagePath)) + this.getExtForFormat(opts.format)
    return join(dir, baseName)
  }

  /**
   * 解析 ZIP 内文件名（基于调用方传入的库内相对路径，保留目录层级避免同名冲突）
   * @param name 库内相对路径（/ 或 \ 分隔）
   * @param opts 导出选项
   * @returns ZIP 条目名
   */
  private zipEntryName(name: string, opts: ExportOptions): string {
    const normalized = name.replace(/\\/g, '/')
    if (opts.format === 'original') {
      return normalized // 保留原扩展名
    }
    return normalized.replace(/\.[^/.]+$/, '') + this.getExtForFormat(opts.format)
  }

  /**
   * 条目名去重兜底：相同条目名追加序号，避免 ZIP 内重名覆盖
   */
  private dedupeName(name: string, used: Set<string>): string {
    if (!used.has(name)) {
      used.add(name)
      return name
    }
    const parsed = parse(name)
    let i = 2
    let candidate = `${parsed.name} (${i})${parsed.ext}`
    while (used.has(candidate)) {
      i++
      candidate = `${parsed.name} (${i})${parsed.ext}`
    }
    used.add(candidate)
    return candidate
  }

  /**
   * 根据格式获取扩展名
   * @param format 导出格式
   * @returns 扩展名（含点）
   */
  private getExtForFormat(format: ExportOptions['format']): string {
    switch (format) {
      case 'jpg':
        return '.jpg'
      case 'png':
        return '.png'
      case 'webp':
        return '.webp'
      case 'original':
        return '' // 保持原扩展名
      default:
        return '.jpg'
    }
  }
}
