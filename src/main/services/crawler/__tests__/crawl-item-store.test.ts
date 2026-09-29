/**
 * T15 — CrawlItemStore 单测（真库：MasterDB + better-sqlite3 临时目录，沿 source-store 模式）
 * 覆盖 urlHash 稳定、三级去重查询语义（url/file/phash 汉明距）、insert 往返、url_hash 唯一索引。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { MasterDB } from '../../database'
import {
  CrawlItemStore,
  urlHash,
  getCrawlItemStore,
  resetCrawlItemStore,
  PHASH_COMPARE_WINDOW,
} from '../crawl-item-store'

describe('urlHash', () => {
  it('全量 sha256 稳定，64 位 hex', () => {
    const h = urlHash('https://cdn/a.jpg')
    expect(h).toHaveLength(64)
    expect(urlHash('https://cdn/a.jpg')).toBe(h)
    expect(urlHash('https://cdn/b.jpg')).not.toBe(h)
  })
})

describe('CrawlItemStore', () => {
  let db: MasterDB
  let tempDir: string
  let store: CrawlItemStore

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivitem-'))
    db = new MasterDB()
    db.initialize(tempDir)
    resetCrawlItemStore()
    store = getCrawlItemStore(db)
  })
  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('insert → get 往返，字段对齐', () => {
    const id = store.insert({
      sourceId: 7, sourceUrl: 'https://site/post/1', pageTitle: '落日',
      author: '某UP', urlHash: urlHash('https://cdn/a.jpg'),
      fileHash: 'fh-1', phash: '0000000000000000', imagePath: '/tmp/a.jpg',
    })
    const row = store.get(id)!
    expect(row.sourceId).toBe(7)
    expect(row.pageTitle).toBe('落日')
    expect(row.fileHash).toBe('fh-1')
    expect(row.error).toBeNull()
    expect(row.crawledAt).toBeTruthy()
  })

  it('第一级：urlSeen 命中；url_hash 唯一索引拒重复', () => {
    const h = urlHash('https://cdn/dup.jpg')
    expect(store.urlSeen(h)).toBe(false)
    store.insert({ sourceId: 1, sourceUrl: 'u', urlHash: h })
    expect(store.urlSeen(h)).toBe(true)
    expect(() => store.insert({ sourceId: 1, sourceUrl: 'u2', urlHash: h })).toThrow()
  })

  it('第二级：fileSeen 命中；空 hash 恒 false', () => {
    store.insert({ sourceId: 1, sourceUrl: 'u', urlHash: 'uh', fileHash: 'same' })
    expect(store.fileSeen('same')).toBe(true)
    expect(store.fileSeen('other')).toBe(false)
    expect(store.fileSeen('')).toBe(false)
  })

  it('第三级：findPhashDuplicate 按汉明距阈值近重', () => {
    // 存一条全 0；查询 1 位差异 → 距离 1 ≤ 10 命中；64 位差异 → 距离 64 > 10 不命中
    store.insert({ sourceId: 1, sourceUrl: 'u', urlHash: 'uh', phash: '0000000000000000' })
    expect(store.findPhashDuplicate('0000000000000001', 10)).toBe('0000000000000000')
    expect(store.findPhashDuplicate('ffffffffffffffff', 10)).toBeNull()
    expect(store.findPhashDuplicate('', 10)).toBeNull()
  })

  it('脏 phash（长度异常）不炸近重扫描', () => {
    db.getRawDb()!.prepare(`
      INSERT INTO crawl_items (source_id, source_url, url_hash, phash, crawled_at)
      VALUES (1, 'u', 'bad-hash-row', 'tooshort', datetime('now'))
    `).run()
    expect(store.findPhashDuplicate('0000000000000001', 10)).toBeNull()
  })

  it('第三级限窗：窗口外的远古近重不命中，窗内命中（全表扫描技术债缓解）', () => {
    expect(PHASH_COMPARE_WINDOW).toBe(10_000)
    // 最老一条与查询距离 1（近重）；后接两条与查询距离 63 的 filler 把它顶出 window=2 的比对窗
    store.insert({ sourceId: 1, sourceUrl: 'u', urlHash: 'uh-old', phash: '0000000000000000' })
    store.insert({ sourceId: 1, sourceUrl: 'u', urlHash: 'uh-1', phash: 'ffffffffffffffff' })
    store.insert({ sourceId: 1, sourceUrl: 'u', urlHash: 'uh-2', phash: 'fffffffffffffffe' })
    // 限窗 window=2 → 仅比最近两条（均与查询距离 63）→ 远古近重漏报 null
    expect(store.findPhashDuplicate('0000000000000001', 10, 2)).toBeNull()
    // 未超窗（默认 1 万窗口 vs 3 条）保持全量精确语义→ 命中最老条
    expect(store.findPhashDuplicate('0000000000000001', 10)).toBe('0000000000000000')
  })

  it('count 统计行数', () => {
    expect(store.count()).toBe(0)
    store.insert({ sourceId: 1, sourceUrl: 'u', urlHash: 'a' })
    store.insert({ sourceId: 1, sourceUrl: 'u', urlHash: 'b' })
    expect(store.count()).toBe(2)
  })
})
