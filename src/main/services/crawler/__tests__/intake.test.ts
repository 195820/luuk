/**
 * T15 — CrawlerIntake 单测：三级去重矩阵（url/file/phash 各自命中 + 组合）、
 * sidecar 邻接写入、下载失败不入库、无库根零副作用。
 * repo/downloader/computePhash 全注入替身，零真实网络零 sharp；文件只碰临时目录。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createHash } from 'crypto'
import { CrawlerIntake, sidecarPath, type DownloadRunner } from '../intake'
import { urlHash, type CrawlItemRepository, type InsertItemInput } from '../crawl-item-store'
import { hammingDistance } from '../../../utils/phash'
import type { DownloadResult, DownloadTarget } from '../downloader'
import type { CandidateDraft, CrawlSourceRecord, CrawlSourceConfig } from '../../../../types/agent'

// ── 替身：内存版 crawl_items（只实现 intake 用到的读写面） ──
function fakeRepo() {
  const urls = new Set<string>()
  const files = new Set<string>()
  const stored: string[] = []
  const inserts: InsertItemInput[] = []
  let seq = 0
  const repo: CrawlItemRepository = {
    urlSeen: h => urls.has(h),
    fileSeen: h => (h ? files.has(h) : false),
    findPhashDuplicate: (ph, th) => stored.find(s => { try { return hammingDistance(ph, s) <= th } catch { return false } }) ?? null,
    insert: input => {
      urls.add(input.urlHash)
      if (input.fileHash) files.add(input.fileHash)
      if (input.phash) stored.push(input.phash)
      inserts.push(input)
      return ++seq
    },
  }
  return { repo, urls, files, inserts }
}

// ── 替身下载器：按 url 返回预置结果，记录被请求的 url（用于断言 url 去重跳过下载） ──
function fakeDownloader(map: Record<string, DownloadResult | Error>) {
  const requested: string[] = []
  const runner: DownloadRunner = {
    downloadAll: async (_base: string, targets: DownloadTarget[]) => {
      requested.push(...targets.map(t => t.url))
      return targets.map(t => {
        const r = map[t.url]
        if (r instanceof Error) throw r
        if (!r) throw new Error(`未预置：${t.url}`)
        return r
      })
    },
    abortAll: () => 0,
  }
  return { runner, requested }
}

const draft = (sourceUrl: string, mediaUrls: string[]): CandidateDraft => ({
  sourceUrl, pageTitle: '落日图集', tags: [], mediaUrls,
})

const source: CrawlSourceRecord = {
  id: 42, pluginId: 'builtin.bili-web', name: 'b站来源',
  config: { connectorType: 'web-http', params: {}, ops: { buildRequests: 'b', parseResponse: 'p' } } as CrawlSourceConfig,
  enabled: true, health: 'ok', successRate: null, lastCrawlAt: null, createdAt: '2026-01-01T00:00:00.000Z',
}

let tempDir: string
beforeEach(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivintake-')) })
afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }) })

function okResult(url: string, content = 'bytes'): DownloadResult {
  const filePath = path.join(tempDir, `${urlHash(url).slice(0, 8)}.jpg`)
  fs.writeFileSync(filePath, content, 'utf-8')
  return {
    url, ok: true, filePath,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

const phashOf = (val: string) => async (): Promise<string | null> => val

describe('CrawlerIntake', () => {
  it('全新候选：下载→入库→sidecar 生成，ingested=1', async () => {
    const { repo, inserts } = fakeRepo()
    const url = 'https://cdn/a.jpg'
    const { runner, requested } = fakeDownloader({ [url]: okResult(url, 'AAA') })
    const intake = new CrawlerIntake({
      items: repo, downloader: runner,
      getDownloadRoot: () => tempDir, computePhash: phashOf('0000000000000000'),
    })
    const res = await intake.process(source, [draft('https://site/post/1', [url])])
    expect(res.ingested).toBe(1)
    expect(requested).toEqual([url])
    expect(inserts[0]).toMatchObject({ sourceId: 42, sourceUrl: 'https://site/post/1' })
    // sidecar 落在媒体旁，含溯源字段
    const sc = JSON.parse(fs.readFileSync(sidecarPath(inserts[0].imagePath!), 'utf-8'))
    expect(sc.sourceId).toBe(42)
    expect(sc.mediaUrl).toBe(url)
    expect(sc.pageUrl).toBe('https://site/post/1')
    expect(sc.crawledAt).toBeTruthy()
  })

  it('第一级：URL 已采过 → 不下载、不入库', async () => {
    const { repo } = fakeRepo()
    const url = 'https://cdn/dup.jpg'
    repo.insert({ sourceId: 1, sourceUrl: 'x', urlHash: urlHash(url) })
    const { runner, requested } = fakeDownloader({})
    const intake = new CrawlerIntake({
      items: repo, downloader: runner, getDownloadRoot: () => tempDir, computePhash: phashOf('0'),
    })
    const res = await intake.process(source, [draft('https://site/1', [url])])
    expect(res).toMatchObject({ ingested: 0, skippedUrl: 1 })
    expect(requested).toHaveLength(0) // 短路在下载之前
  })

  it('第二级：改 URL 同字节 → file_hash 命中，下载但不入库', async () => {
    const { repo } = fakeRepo()
    const content = 'SAME-BYTES'
    const sha = createHash('sha256').update(content).digest('hex')
    repo.insert({ sourceId: 1, sourceUrl: 'x', urlHash: 'other', fileHash: sha })
    const url = 'https://cdn/newurl.jpg'
    const { runner, requested } = fakeDownloader({ [url]: okResult(url, content) })
    const intake = new CrawlerIntake({
      items: repo, downloader: runner, getDownloadRoot: () => tempDir, computePhash: phashOf('0'),
    })
    const res = await intake.process(source, [draft('https://site/1', [url])])
    expect(res).toMatchObject({ ingested: 0, skippedFile: 1 })
    expect(requested).toEqual([url]) // 第二级在下载之后（需字节才能算 file_hash）
  })

  it('第三级：同图不同压缩 → phash 近重命中，不入库', async () => {
    const { repo } = fakeRepo()
    repo.insert({ sourceId: 1, sourceUrl: 'x', urlHash: 'other', phash: '0000000000000000' })
    const url = 'https://cdn/recompress.jpg'
    const { runner } = fakeDownloader({ [url]: okResult(url, 'different-bytes') })
    const intake = new CrawlerIntake({
      items: repo, downloader: runner, getDownloadRoot: () => tempDir,
      computePhash: phashOf('0000000000000003'), // 距 2 ≤ 10 → 命中
    })
    const res = await intake.process(source, [draft('https://site/1', [url])])
    expect(res).toMatchObject({ ingested: 0, skippedPhash: 1 })
  })

  it('alreadyPresent 未回传 sha256 → 按已落地文件补算 file_hash', async () => {
    const { repo, inserts } = fakeRepo()
    const url = 'https://cdn/exist.jpg'
    const filePath = path.join(tempDir, 'exist.jpg')
    fs.writeFileSync(filePath, 'ONDISK', 'utf-8')
    const { runner } = fakeDownloader({
      [url]: { url, ok: true, filePath, alreadyPresent: true }, // 无 sha256
    })
    const intake = new CrawlerIntake({
      items: repo, downloader: runner, getDownloadRoot: () => tempDir, computePhash: phashOf('0'),
    })
    const res = await intake.process(source, [draft('https://site/1', [url])])
    expect(res.ingested).toBe(1)
    expect(inserts[0].fileHash).toBe(createHash('sha256').update('ONDISK').digest('hex'))
  })

  it('pHash 计算抛错 → 保留落地（第三级降级为不去重），仍入库', async () => {
    const { repo } = fakeRepo()
    const url = 'https://cdn/phfail.jpg'
    const { runner } = fakeDownloader({ [url]: okResult(url, 'X') })
    const intake = new CrawlerIntake({
      items: repo, downloader: runner, getDownloadRoot: () => tempDir,
      computePhash: async () => { throw new Error('sharp 崩了') },
    })
    const res = await intake.process(source, [draft('https://site/1', [url])])
    expect(res.ingested).toBe(1)
  })

  it('下载失败 → failed 计数，不入库', async () => {
    const { repo } = fakeRepo()
    const url = 'https://cdn/fail.jpg'
    const { runner } = fakeDownloader({ [url]: { url, ok: false, error: 'HTTP 403' } })
    const intake = new CrawlerIntake({
      items: repo, downloader: runner, getDownloadRoot: () => tempDir, computePhash: phashOf('0'),
    })
    const res = await intake.process(source, [draft('https://site/1', [url])])
    expect(res).toMatchObject({ ingested: 0, failed: 1 })
  })

  it('无库根 → 零副作用（不下载不入库）', async () => {
    const { repo } = fakeRepo()
    const { runner, requested } = fakeDownloader({})
    const intake = new CrawlerIntake({
      items: repo, downloader: runner, getDownloadRoot: () => null, computePhash: phashOf('0'),
    })
    const res = await intake.process(source, [draft('https://site/1', ['https://cdn/x.jpg'])])
    expect(res.ingested).toBe(0)
    expect(requested).toHaveLength(0)
  })

  it('ingest 契约：回传净新增数（多 url 混合去重分桶）', async () => {
    const { repo } = fakeRepo()
    const fresh = 'https://cdn/fresh.jpg'
    const dupFileUrl = 'https://cdn/dupcontent.jpg'
    const sha = createHash('sha256').update('DUP').digest('hex')
    repo.insert({ sourceId: 1, sourceUrl: 'x', urlHash: 'pre', fileHash: sha })
    const { runner } = fakeDownloader({
      [fresh]: okResult(fresh, 'FRESH'),
      [dupFileUrl]: okResult(dupFileUrl, 'DUP'),
    })
    const intake = new CrawlerIntake({
      items: repo, downloader: runner, getDownloadRoot: () => tempDir,
      computePhash: async (fp) => (fp.includes('fresh') ? '0000000000000000' : 'ffffffffffffffff'),
    })
    const n = await intake.ingest(source, [draft('https://site/1', [fresh, dupFileUrl])])
    expect(n).toBe(1) // fresh 入库，dupcontent 第二级命中
  })
})
