/**
 * T15 — CrawlerIntake（候选下游：下载 → 三级去重 → 落地入库 → sidecar）
 * 实现 CrawlerService 的 CandidateSink：把 parseResponse 出的 CandidateDraft 推进到
 * 「已采留档」——本阶段只写 crawl_items + 磁盘 sidecar，不直连主库 images 表
 * （提案/入主库经 T16 打分与 M4 用户确认，落地目录被 scanner 排除，见 §8.3）。
 *
 * 三级去重（§12.5/12.6，命中即不算新增，返回值=新写入 crawl_items 行数）：
 *   ① url_hash 下载前置查   ② file_hash 下载后查   ③ phash 入库前汉明距近重查
 * 出流/下载经注入的 MediaDownloader；pHash 计算注入（单测用替身，零 sharp/零真实网络）。
 */
import fs from 'fs'
import { createHash } from 'crypto'
import { logger } from '../../../utils/logger'
import type { CandidateDraft, CrawlSourceRecord, CrawlProvenance } from '../../../types/agent'
import { targetsFromDraft, type DownloadTarget, type DownloadResult } from './downloader'
import { urlHash, type CrawlItemRepository, type InsertItemInput } from './crawl-item-store'
import type { CandidateSink } from './crawler-service'

const LOG_KEY = 'CrawlerIntake'

/** 相似图判定默认阈值沿用 image-service（汉明距 ≤10 视为近重） */
export const PHASH_DUP_THRESHOLD = 10
/** 媒体文件旁的溯源 sidecar 后缀（DB 损坏时凭此恢复链路，验收「sidecar 随文件迁移仍存在」） */
export const SIDECAR_SUFFIX = '.luuk-provenance.json'

export function sidecarPath(filePath: string): string {
  return `${filePath}${SIDECAR_SUFFIX}`
}

/** 出流失败的兜底哈希：alreadyPresent（未回传 sha256）时按已落地文件补算 */
function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

/** pc-app 形态（Telegram 两条通道）产物为本地文件，以 file:// 承载，intake 免下载直接入库 */
export function isLocalMediaUrl(url: string): boolean {
  return url.startsWith('file://')
}
export function localPathFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  } catch {
    return url.replace(/^file:\/\//, '')
  }
}

export type ComputePhash = (filePath: string) => Promise<string | null>

/** 下载执行面（MediaDownloader 结构性满足；单测注 fake） */
export interface DownloadRunner {
  downloadAll(baseDir: string, targets: DownloadTarget[]): Promise<DownloadResult[]>
  abortAll(baseDir: string): number
}

export interface CrawlerIntakeDeps {
  items: CrawlItemRepository
  downloader: DownloadRunner
  /** 解析下载根目录（库根）；返回 null=无可用库 → 本批安全丢弃（零副作用） */
  getDownloadRoot: (source: CrawlSourceRecord) => string | null
  computePhash: ComputePhash
  phashThreshold?: number
  /** 作业/提案上下文（写进 sidecar，可追溯链路） */
  getProvenance?: (source: CrawlSourceRecord) => Pick<CrawlProvenance, 'jobId' | 'proposalId'>
}

export interface IntakeResult {
  /** 新写入 crawl_items 的行数（=通过三级去重的净新增） */
  ingested: number
  skippedUrl: number
  skippedFile: number
  skippedPhash: number
  failed: number
}

const EMPTY: IntakeResult = { ingested: 0, skippedUrl: 0, skippedFile: 0, skippedPhash: 0, failed: 0 }

export class CrawlerIntake implements CandidateSink {
  constructor(private deps: CrawlerIntakeDeps) {}

  /** CandidateSink 契约：只回传净新增数（详细分桶见 process） */
  async ingest(source: CrawlSourceRecord, drafts: CandidateDraft[]): Promise<number> {
    return (await this.process(source, drafts)).ingested
  }

  async process(source: CrawlSourceRecord, drafts: CandidateDraft[]): Promise<IntakeResult> {
    const result: IntakeResult = { ...EMPTY }
    if (drafts.length === 0) return result
    const root = this.deps.getDownloadRoot(source)
    const site = source.pluginId.split('.').pop() || source.pluginId
    const threshold = this.deps.phashThreshold ?? PHASH_DUP_THRESHOLD

    // 第一级：url_hash 前置去重 + 本地/远端分流（本地=pc-app 已落盘/导入，免下载）
    interface Acquired { url: string; draft: CandidateDraft; filePath: string; sha256?: string }
    const acquired: Acquired[] = []
    const remote: { url: string; draft: CandidateDraft }[] = []
    for (const draft of drafts) {
      for (const url of draft.mediaUrls) {
        if (this.deps.items.urlSeen(urlHash(url))) {
          result.skippedUrl++
          continue
        }
        if (isLocalMediaUrl(url)) {
          const p = localPathFromUrl(url)
          if (!fs.existsSync(p)) {
            result.failed++
            logger.warn(LOG_KEY, `本地媒体文件缺失，跳过：${p}`)
            continue
          }
          acquired.push({ url, draft, filePath: p })
        } else {
          remote.push({ url, draft })
        }
      }
    }

    // 远端集中出流下载（复用 downloader 并发闸门/续传/清洗），顺序与 remote 对齐
    if (remote.length > 0) {
      if (!root) {
        result.failed += remote.length
        logger.warn(LOG_KEY, `无下载根目录，${remote.length} 个远端媒体跳过`)
      } else {
        const downloadResults = await this.deps.downloader.downloadAll(
          root,
          remote.map(({ url, draft }) => targetsFromDraft(site, draft).find(t => t.url === url)!),
        )
        for (let i = 0; i < remote.length; i++) {
          const dl = downloadResults[i]
          if (!dl || !dl.ok || !dl.filePath) {
            result.failed++
            continue
          }
          acquired.push({ url: remote[i].url, draft: remote[i].draft, filePath: dl.filePath, sha256: dl.sha256 })
        }
      }
    }

    // 统一收尾：第二级 file_hash → 第三级 phash → 入库 + sidecar
    for (const a of acquired) {
      const { url, draft, filePath } = a
      const fileHash = a.sha256 ?? hashFile(filePath)
      if (this.deps.items.fileSeen(fileHash)) {
        result.skippedFile++
        continue
      }
      let phash: string | null = null
      try {
        phash = await this.deps.computePhash(filePath)
      } catch (err) {
        logger.warn(LOG_KEY, `pHash 计算失败（保留落地，跳过去重第三级）: ${filePath}: ${err}`)
      }
      if (phash && this.deps.items.findPhashDuplicate(phash, threshold)) {
        result.skippedPhash++
        continue
      }
      const input: InsertItemInput = {
        sourceId: source.id,
        sourceUrl: draft.sourceUrl,
        pageTitle: draft.pageTitle ?? null,
        author: draft.author ?? null,
        urlHash: urlHash(url),
        fileHash,
        phash,
        imagePath: filePath,
      }
      try {
        const id = this.deps.items.insert(input)
        this.writeSidecar(filePath, source, id, url, draft.sourceUrl)
        result.ingested++
      } catch (err) {
        result.failed++
        logger.warn(LOG_KEY, `crawl_items 写入失败: ${url}: ${err}`)
      }
    }

    logger.info(
      LOG_KEY,
      `来源 ${source.id} 入库：新增 ${result.ingested} / URL 重 ${result.skippedUrl}` +
      ` / 内容重 ${result.skippedFile} / 相似重 ${result.skippedPhash} / 失败 ${result.failed}`,
    )
    return result
  }

  /** sidecar：媒体旁写同名 .luuk-provenance.json（DB 外的独立溯源副本，随文件迁移仍存在） */
  private writeSidecar(
    filePath: string, source: CrawlSourceRecord, itemId: number,
    mediaUrl: string, pageUrl: string,
  ): void {
    const extra = this.deps.getProvenance?.(source) ?? {}
    const prov: CrawlProvenance & { itemId: number; mediaUrl: string; pageUrl: string } = {
      ...extra,
      itemId,
      crawledAt: new Date().toISOString(),
      sourceId: source.id,
      mediaUrl,
      pageUrl,
    }
    try {
      const target = sidecarPath(filePath)
      // 原子写：先写 .tmp 再同卷 rename（硬约束 #5）——sidecar 是 DB 损坏时的溯源兵底副本，
      // 直写目标名若中途崩溃会留半截 JSON 失去价值
      const tmp = `${target}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(prov, null, 2), 'utf-8')
      fs.renameSync(tmp, target)
    } catch (err) {
      // sidecar 失败不回滚入库：DB 仍是权威，溯源副本属尽力而为
      logger.warn(LOG_KEY, `sidecar 写入失败: ${filePath}: ${err}`)
    }
  }

  /** 取消某库根下全部在途下载（作业 cancel 时由下游接线调用，透传 downloader） */
  abortDownloads(baseDir: string): number {
    return this.deps.downloader.abortAll(baseDir)
  }
}
