/**
 * T14 — 下载子系统（宿主侧）
 * 复用 export-service 的流式落盘经验：`.part` + 完成 rename 原子落盘；HTTP Range 断点续传；
 * 防盗链 Referer 注入；AbortController Map 取消；落盘完成后全量读算 SHA256（交 T15 第二级去重）；
 * 文件名清洗（非法字符剔除 + url_hash 短后缀防碰撞）。
 *
 * 落盘约定（§12.7 落地即入库的前半段）：{库根}/_downloads/{site}/{album}/xxx
 * —— scanner 对下划线前缀目录天然跳过（T15 核实），入库由 intake 归档完成。
 * 图片/图集为主，视频不在本期口径（无 Range 支持的流式转码）。
 */
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { logger } from '../../../utils/logger'
import { CRAWLER_UA } from './request-executor'
import type { CandidateDraft } from '../../../types/agent'

const LOG_KEY = 'CrawlerDownload'

/** 下载体最小面（ExecutorFetch 响应的超集需 arrayBuffer 之外的流式读法：这里用 Node fetch 的 ReadableStream） */
export interface DownloadFetchResponse {
  status: number
  headers: { get(name: string): string | null }
  body: AsyncIterable<Uint8Array> | null
}
export type DownloadFetch = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}) => Promise<DownloadFetchResponse>

export interface DownloaderDeps {
  fetchImpl: DownloadFetch
  /** 并发上限（库级） */
  maxConcurrent?: number
  /** 单任务字节上限（默认 64MB：图片/图集口径，防误抓大文件撑盘） */
  maxBytesPerItem?: number
}

export interface DownloadTarget {
  url: string
  /** 相对 _downloads 的目录（已经宿主清洗，如 bili-web/落日图集）；空则 _misc */
  dir: string
  /** 建议文件名（不含扩展）；缺省用 url 尾段 */
  nameHint?: string
  referer?: string
}

export interface DownloadResult {
  url: string
  ok: boolean
  /** 落地绝对路径（成功时） */
  filePath?: string
  /** 整文件 SHA256（落盘完成后全量读算：续传场景必须重算完整文件，口径与 scanner 一致） */
  sha256?: string
  bytes?: number
  error?: string
  /** 目标已存在（file_hash 前置去重命中，intake 决定复用） */
  alreadyPresent?: boolean
}

/** URL → 12 位短 hash（文件名后缀防碰撞 + intake url_hash 前缀检索） */
export function shortUrlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 12)
}

const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

/** 文件名/目录段清洗：去非法字符与首尾点，截断 80 字符，空则占位 */
export function sanitizePathSegment(raw: string, fallback = '_unnamed'): string {
  const cleaned = raw.replace(ILLEGAL_CHARS, '').replace(/^[.\s]+|[.\s]+$/g, '').trim()
  return (cleaned || fallback).slice(0, 80)
}

/** 从 url 提取扩展名（白名单收口，异常按 jpg 处理——图片口径） */
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff'])
export function extFromUrl(url: string): string {
  try {
    const m = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/)
    const ext = m?.[1]?.toLowerCase()
    return ext && ALLOWED_EXT.has(ext) ? ext : 'jpg'
  } catch {
    return 'jpg'
  }
}

/** 候选 → 下载目标列表（site/album 目录组织：site=插件 id 尾段，album=标题清洗） */
export function targetsFromDraft(site: string, draft: CandidateDraft): DownloadTarget[] {
  const album = sanitizePathSegment(
    draft.pageTitle?.trim() || draft.description?.trim().slice(0, 30) || path.basename(new URL(draft.sourceUrl).pathname) || '_misc',
  )
  return draft.mediaUrls.map(url => ({
    url,
    dir: `${sanitizePathSegment(site)}/${album}`,
    nameHint: undefined,
    referer: draft.sourceUrl,
  }))
}

interface InFlight { controller: AbortController }

export class MediaDownloader {
  private deps: Required<Pick<DownloaderDeps, 'maxConcurrent' | 'maxBytesPerItem'>> & DownloaderDeps
  /** 库根 → 在途任务（取消用） */
  private inFlight = new Map<string, Set<InFlight>>()
  private active = 0

  constructor(deps: DownloaderDeps) {
    this.deps = {
      maxConcurrent: deps.maxConcurrent ?? 2,
      maxBytesPerItem: deps.maxBytesPerItem ?? 64 * 1024 * 1024,
      fetchImpl: deps.fetchImpl,
    }
  }

  /**
   * 批量下载：单项失败不中断整批；同 URL 已落地即跳过。
   *
   * 并发闸用「本次调用局部在途计数」作完成判据，而非实例级 this.active——
   * 多个 downloadAll 可能并发（JobRunner 批内并发 + 全层共用同一 MediaDownloader），
   * 若以共享 active 判定完成，后到的调用会因 active 被前者占满而永久挂起（死锁）。
   * this.active 仅作全局在途观测，仍参与上限钳制。
   */
  async downloadAll(baseDir: string, targets: DownloadTarget[]): Promise<DownloadResult[]> {
    const results = new Array<DownloadResult>(targets.length)
    const queue = [...targets.entries()]
    let localActive = 0
    await new Promise<void>(resolve => {
      const pump = () => {
        while (localActive < this.deps.maxConcurrent && queue.length > 0) {
          const [i, t] = queue.shift()!
          localActive++
          this.active++
          void this.download(baseDir, t).then(r => {
            results[i] = r
          }).finally(() => {
            localActive--
            this.active--
            pump()
          })
        }
        if (localActive === 0 && queue.length === 0) resolve()
      }
      pump()
    })
    return results
  }

  async download(baseDir: string, target: DownloadTarget): Promise<DownloadResult> {
    const url = target.url
    const hash = shortUrlHash(url)
    // 文件名：{清洗后提示名或 _media}_{url 短 hash}.{扩展}——短后缀防同名碰撞
    const baseName = sanitizePathSegment(target.nameHint ?? '', '_media')
    const finalPath = path.join(baseDir, target.dir, `${baseName}_${hash}.${extFromUrl(url)}`)
    if (fs.existsSync(finalPath)) {
      return { url, ok: true, filePath: finalPath, alreadyPresent: true }
    }
    const partPath = `${finalPath}.${hash}.part`
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })

    const controller = new AbortController()
    let inflights = this.inFlight.get(baseDir)
    if (!inflights) { inflights = new Set(); this.inFlight.set(baseDir, inflights) }
    const entry: InFlight = { controller }
    inflights.add(entry)

    try {
      return await this.streamTo(url, target, partPath, finalPath, controller.signal)
    } catch (err) {
      return { url, ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      inflights.delete(entry)
    }
  }

  private async streamTo(
    url: string, target: DownloadTarget,
    partPath: string, finalPath: string, signal: AbortSignal,
  ): Promise<DownloadResult> {
    // Range 续传：.part 已有进度则从断点请求
    let existing = 0
    try { existing = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0 } catch { existing = 0 }
    const headers: Record<string, string> = {
      'User-Agent': CRAWLER_UA,
      ...(target.referer ? { Referer: target.referer } : {}),
      ...(existing > 0 ? { Range: `bytes=${existing}-` } : {}),
    }
    const res = await this.deps.fetchImpl(url, { method: 'GET', headers, signal })
    if (res.status === 416 && existing > 0) {
      // .part 已完整（服务端说范围越界）：按已完成处理
      return this.finalize(partPath, finalPath, url)
    }
    if (res.status >= 400 || !res.body) {
      await fs.promises.rm(partPath, { force: true }).catch(() => {})
      return { url, ok: false, error: `HTTP ${res.status}` }
    }
    // 206 = 续传成功追加；200 = 服务端忽略 Range 从 0 重发，截断重来
    const resumed = res.status === 206
    const out = fs.createWriteStream(partPath, resumed ? { flags: 'a' } : { flags: 'w' })
    // 守卫：取消/超限 destroy 后，异步冒泡的写流错误（如临时目录被清导致的 ENOENT）不逃逸为 unhandled error；
    // 真实落盘错误仍由下方 end 回调 + on('error', reject) 反映
    out.on('error', () => {})
    let bytes = resumed ? existing : 0
    try {
      for await (const chunk of res.body) {
        if (signal.aborted) throw new Error('下载取消')
        bytes += chunk.byteLength
        if (bytes > this.deps.maxBytesPerItem) {
          // 视频/大包误入图片通道：丢弃并留日志（本期不收视频）
          logger.warn(LOG_KEY, `超单项上限丢弃：${url}（${bytes}B）`)
          throw new Error(`超过单项字节上限 ${this.deps.maxBytesPerItem}（疑似大文件/视频）`)
        }
        const canContinue = out.write(Buffer.from(chunk))
        if (!canContinue) {
          await new Promise<void>((r, rej) => {
            out.once('drain', r)
            out.once('error', rej)
          })
        }
        if (signal.aborted) throw new Error('下载取消')
      }
    } catch (err) {
      out.destroy()
      throw err
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.on('error', reject)
    })
    return this.finalize(partPath, finalPath, url)
  }

  /** .part → 正式名原子 rename + 全量 SHA256（口径与 scanner 全量重算一致，非 64KB 窗口） */
  private finalize(partPath: string, finalPath: string, url: string): DownloadResult {
    try {
      const buf = fs.readFileSync(partPath)
      const sha256 = createHash('sha256').update(buf).digest('hex')
      fs.renameSync(partPath, finalPath)
      return { url, ok: true, filePath: finalPath, sha256, bytes: buf.length }
    } catch (err) {
      return { url, ok: false, error: `落盘失败: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /** 取消某库根下全部在途下载（作业 cancel 时由调用方触发） */
  abortAll(baseDir: string): number {
    const inflights = this.inFlight.get(baseDir)
    if (!inflights) return 0
    let n = 0
    for (const entry of inflights) {
      entry.controller.abort()
      n++
    }
    return n
  }
}
