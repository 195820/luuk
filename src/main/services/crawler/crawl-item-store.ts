/**
 * T15 — CrawlItemStore（crawl_items 读写 + 三级去重查询）
 * 仿 source-store.ts：构造校验 MasterDB、每次取裸连接（S11 不缓存句柄）。
 * 三级去重落点：
 *   第一级 url_hash（唯一索引 idx_crawl_items_url_hash）—— 下载前查，命中即不重复抓
 *   第二级 file_hash（SHA256）—— 下载后查，改 URL 同字节命中
 *   第三级 phash（感知哈希）—— 入库前查，同图不同压缩按汉明距命中（阈值沿用相似图默认 10）
 * 查询能力经 CrawlItemRepository 接口暴露给 intake，便于单测注入替身。
 */
import type { Database as DatabaseType } from 'better-sqlite3'
import { createHash } from 'crypto'
import type { MasterDB } from '../database'
import { hammingDistance } from '../../utils/phash'

/** URL → 全量 sha256（crawl_items.url_hash 去重键；downloader 的短 hash 只用于文件名） */
export function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

export interface InsertItemInput {
  sourceId: number
  sourceUrl: string
  pageTitle?: string | null
  author?: string | null
  urlHash: string
  fileHash?: string | null
  phash?: string | null
  imagePath?: string | null
  error?: string | null
}

export interface CrawlItemRepository {
  /** 第一级：URL 是否已采过（下载前置查，命中即跳过，避免重复抓） */
  urlSeen(hash: string): boolean
  /** 第二级：内容 SHA256 是否已存在（下载后查，命中即丢弃不入库） */
  fileSeen(hash: string): boolean
  /** 第三级：感知哈希近重（返回命中的既有 phash，null=无重复）；限窗见 PHASH_COMPARE_WINDOW */
  findPhashDuplicate(phash: string, threshold: number): string | null
  /** 写入一条采集留档，返回行 id */
  insert(input: InsertItemInput): number
}

function mapRow(row: any) {
  return {
    id: row.id as number,
    sourceId: row.source_id as number,
    sourceUrl: row.source_url as string,
    pageTitle: row.page_title ?? null,
    author: row.author ?? null,
    urlHash: row.url_hash as string,
    fileHash: row.file_hash ?? null,
    phash: row.phash ?? null,
    imagePath: row.image_path ?? null,
    error: row.error ?? null,
    crawledAt: row.crawled_at as string,
  }
}
export type CrawlItemRow = ReturnType<typeof mapRow>

/**
 * 第三级近重比对窗口（M3 审查登记技术债的限窗缓解）：
 * crawl_items 无 phash 索引，全表拉取扫描不可扩展到十万级；
 * 超窗时只比最近 N 条——远古重复由第一/二级（url_hash 精确 / file_hash 精确）兜底，
 * 窗口外漏报可接受。BK-tree/分段索引待大库真实需求时再立项。
 */
export const PHASH_COMPARE_WINDOW = 10_000

export class CrawlItemStore implements CrawlItemRepository {
  constructor(readonly masterDb: MasterDB) {
    if (!masterDb.getRawDb()) throw new Error('CrawlItemStore: MasterDB 未初始化')
  }

  private get db(): DatabaseType {
    const raw = this.masterDb.getRawDb()
    if (!raw) throw new Error('CrawlItemStore: MasterDB 连接已关闭')
    return raw
  }

  urlSeen(hash: string): boolean {
    return this.db.prepare('SELECT 1 FROM crawl_items WHERE url_hash = ? LIMIT 1').get(hash) !== undefined
  }

  fileSeen(hash: string): boolean {
    if (!hash) return false
    return this.db.prepare('SELECT 1 FROM crawl_items WHERE file_hash = ? LIMIT 1').get(hash) !== undefined
  }

  findPhashDuplicate(phash: string, threshold: number, window = PHASH_COMPARE_WINDOW): string | null {
    if (!phash) return null
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM crawl_items WHERE phash IS NOT NULL').get() as { n: number }).n
    // 限窗：超窗只取最近 window 条（id 降序）；未超窗保持全量精确语义
    const rows = total <= window
      ? this.db.prepare('SELECT phash FROM crawl_items WHERE phash IS NOT NULL').all() as Array<{ phash: string }>
      : this.db.prepare('SELECT phash FROM crawl_items WHERE phash IS NOT NULL ORDER BY id DESC LIMIT ?').all(window) as Array<{ phash: string }>
    for (const r of rows) {
      try {
        if (hammingDistance(phash, r.phash) <= threshold) return r.phash
      } catch {
        /* 历史脏 phash（长度异常）跳过，不影响新数据判定 */
      }
    }
    return null
  }

  insert(input: InsertItemInput): number {
    const result = this.db.prepare(`
      INSERT INTO crawl_items
        (source_id, source_url, page_title, author, url_hash, file_hash, phash, image_path, error, crawled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.sourceId,
      input.sourceUrl,
      input.pageTitle ?? null,
      input.author ?? null,
      input.urlHash,
      input.fileHash ?? null,
      input.phash ?? null,
      input.imagePath ?? null,
      input.error ?? null,
      new Date().toISOString(),
    )
    return Number(result.lastInsertRowid)
  }

  /**
   * §12.10 退让诊断行：只记 error，url_hash 用 nonce——
   * 既不与真实媒体 URL 的去重键冲突（error 行不该让后续正常采被判重），
   * 也避免同 URL 反复退让撞 url_hash 唯一索引。
   */
  insertProvenanceError(sourceId: number, sourceUrl: string, detail: string): number {
    const nonce = urlHash(`${sourceUrl}\u0000${Date.now()}\u0000${Math.random()}`)
    return this.insert({ sourceId, sourceUrl, urlHash: nonce, error: detail })
  }

  get(id: number): CrawlItemRow | null {
    const row = this.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(id)
    return row ? mapRow(row) : null
  }

  /**
   * M4 accept 落地入库：取某来源某页面已采留档的媒体行（image_path 非空）。
   * 提案 payload=CandidateItem（页面级），其下载产物按 (source_id, source_url) 存于 crawl_items，
   * accept 时据此把 `_downloads` 内的文件迁入主库。
   */
  listMediaBySourceUrl(sourceId: number, sourceUrl: string): CrawlItemRow[] {
    const rows = this.db.prepare(`
      SELECT * FROM crawl_items
      WHERE source_id = ? AND source_url = ? AND image_path IS NOT NULL
      ORDER BY id
    `).all(sourceId, sourceUrl) as any[]
    return rows.map(mapRow)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM crawl_items').get() as { n: number }
    return row.n
  }

  /** M4 accept 落地后回写媒体真实路径（`_downloads` → 主库 Imported/） */
  updateImagePath(id: number, newPath: string): void {
    this.db.prepare('UPDATE crawl_items SET image_path = ? WHERE id = ?').run(newPath, id)
  }
}

// ── 单例管理（沿 CrawlSourceStore 模式：db 实例变更自动重建） ──

let instance: CrawlItemStore | null = null
let instanceDb: MasterDB | null = null

export function getCrawlItemStore(masterDb: MasterDB): CrawlItemStore {
  if (!instance || instanceDb !== masterDb) {
    instance = new CrawlItemStore(masterDb)
    instanceDb = masterDb
  }
  return instance
}

export function resetCrawlItemStore(): void {
  instance = null
  instanceDb = null
}
