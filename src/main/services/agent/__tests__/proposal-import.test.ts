/**
 * T18 — ProposalImportService 单测（accept 落地：`_downloads` → 主库 Imported/）
 * 全依赖注入：listMedia/updateImagePath/scanLibrary 用替身，文件迁移走临时目录真实 fs。
 * 覆盖：正常迁移+回写+扫描、缺库/payload 非法/无留档的零副作用、单文件缺失尽力迁移、sidecar 随迁。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { CrawlItemRow } from '../../crawler/crawl-item-store'
import type { CandidateItem } from '../../../../types/agent'
import {
  importAcceptedCrawlerProposal,
  sanitizeDirName,
  IMPORT_DIR,
  type ProposalImportDeps,
} from '../proposal-import'

function makeCandidate(over: Partial<CandidateItem> = {}): CandidateItem {
  return {
    sourceId: 1,
    sourceUrl: 'https://www.bilibili.com/read/cv123',
    pageTitle: '落日 图集',
    tags: [],
    score: 0.5,
    decisionSrc: 'local',
    confidence: 0.5,
    ...over,
  }
}

function mediaRow(id: number, imagePath: string): CrawlItemRow {
  return {
    id, sourceId: 1, sourceUrl: 'https://www.bilibili.com/read/cv123',
    pageTitle: null, author: null, urlHash: 'h' + id, fileHash: null,
    phash: null, imagePath, error: null, crawledAt: new Date().toISOString(),
  }
}

describe('sanitizeDirName', () => {
  it('剔除非法字符、空白归一、危险名回退', () => {
    expect(sanitizeDirName('a/b:c*d?', 'x')).toBe('a_b_c_d_')
    expect(sanitizeDirName('  ', 'fb')).toBe('fb')
    expect(sanitizeDirName('.', 'fb')).toBe('fb')
    expect(sanitizeDirName('正常 名称', 'fb')).toBe('正常 名称')
  })

  it('M1：去尾点/空格 + Windows 保留名回退', () => {
    expect(sanitizeDirName('照片..', 'fb')).toBe('照片')
    expect(sanitizeDirName('name  ', 'fb')).toBe('name')
    expect(sanitizeDirName('CON', 'fb')).toBe('fb')
    expect(sanitizeDirName('con.txt', 'fb')).toBe('fb')
    expect(sanitizeDirName('LPT9', 'fb')).toBe('fb')
    expect(sanitizeDirName('contract', 'fb')).toBe('contract') // 非保留名不误伤
  })
})

describe('importAcceptedCrawlerProposal', () => {
  let root: string
  let dlDir: string
  let scanCalls: number[]
  let updates: Array<{ id: number; p: string }>

  function baseDeps(items: CrawlItemRow[]): ProposalImportDeps {
    return {
      listMedia: () => items,
      updateImagePath: (id, p) => { updates.push({ id, p }) },
      getLibraryRootPath: () => root,
      scanLibrary: async (libraryId) => { scanCalls.push(libraryId) },
    }
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivimport-'))
    dlDir = path.join(root, '_downloads', 'bili-web', '落日 图集')
    fs.mkdirSync(dlDir, { recursive: true })
    scanCalls = []
    updates = []
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('迁移媒体+sidecar 到 Imported、回写路径、触发扫描', async () => {
    const f1 = path.join(dlDir, 'p1.jpg')
    fs.writeFileSync(f1, 'AAA')
    fs.writeFileSync(f1 + '.luuk-provenance.json', '{}')
    const res = await importAcceptedCrawlerProposal(makeCandidate(), 7, baseDeps([mediaRow(1, f1)]))

    expect(res.moved).toBe(1)
    expect(res.scanned).toBe(true)
    expect(res.errors).toHaveLength(0)
    const target = path.join(root, IMPORT_DIR, 'www.bilibili.com', '落日 图集', 'p1.jpg')
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.existsSync(f1)).toBe(false) // 已迁走
    expect(fs.existsSync(target + '.luuk-provenance.json')).toBe(true)
    expect(updates).toEqual([{ id: 1, p: target }])
    expect(scanCalls).toEqual([7])
  })

  it('无在线库 → 零副作用返回错误', async () => {
    const deps = baseDeps([mediaRow(1, path.join(dlDir, 'x.jpg'))])
    deps.getLibraryRootPath = () => null
    const res = await importAcceptedCrawlerProposal(makeCandidate(), 7, deps)
    expect(res.moved).toBe(0)
    expect(res.scanned).toBe(false)
    expect(res.errors[0]).toContain('无在线图库')
    expect(scanCalls).toHaveLength(0)
  })

  it('payload 缺 sourceUrl → 拒绝', async () => {
    const res = await importAcceptedCrawlerProposal(
      makeCandidate({ sourceUrl: undefined as unknown as string }), 7, baseDeps([mediaRow(1, 'z')]),
    )
    expect(res.moved).toBe(0)
    expect(res.errors[0]).toContain('sourceId/sourceUrl')
  })

  it('无已采留档 → 不扫描', async () => {
    const res = await importAcceptedCrawlerProposal(makeCandidate(), 7, baseDeps([]))
    expect(res.moved).toBe(0)
    expect(res.scanned).toBe(false)
    expect(scanCalls).toHaveLength(0)
  })

  it('部分文件缺失：尽力迁移其余，缺失计入 errors', async () => {
    const ok = path.join(dlDir, 'ok.jpg')
    fs.writeFileSync(ok, 'ok')
    const missing = path.join(dlDir, 'gone.jpg')
    const res = await importAcceptedCrawlerProposal(
      makeCandidate(), 7, baseDeps([mediaRow(1, ok), mediaRow(2, missing)]),
    )
    expect(res.moved).toBe(1)
    expect(res.errors.some(e => e.includes('媒体文件缺失'))).toBe(true)
    expect(res.scanned).toBe(true)
    expect(updates.map(u => u.id)).toEqual([1])
  })

  it('注入 relocate 走自定义迁移（跨卷替身）', async () => {
    const f = path.join(dlDir, 'a.jpg')
    fs.writeFileSync(f, 'A')
    const deps = baseDeps([mediaRow(1, f)])
    deps.relocate = async (from, to) => { fs.copyFileSync(from, to); fs.unlinkSync(from) }
    const res = await importAcceptedCrawlerProposal(makeCandidate(), 7, deps)
    expect(res.moved).toBe(1)
    expect(fs.existsSync(f)).toBe(false)
  })

  it('C1：库外原件（非 _downloads）只复制不删源，sidecar 随附', async () => {
    const exportDir = path.join(root, 'user_exports')
    fs.mkdirSync(exportDir, { recursive: true })
    const orig = path.join(exportDir, 'o.jpg')
    fs.writeFileSync(orig, 'OUT')
    fs.writeFileSync(orig + '.luuk-provenance.json', '{}')
    const res = await importAcceptedCrawlerProposal(makeCandidate(), 7, baseDeps([mediaRow(1, orig)]))

    const target = path.join(root, IMPORT_DIR, 'www.bilibili.com', '落日 图集', 'o.jpg')
    expect(res.moved).toBe(1)
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.existsSync(orig)).toBe(true) // 原件原地保留（人在回路护栏）
    expect(fs.existsSync(target + '.luuk-provenance.json')).toBe(true)
    expect(updates).toEqual([{ id: 1, p: target }])
  })

  it('M2：同名目标不覆盖，第二个追加 _1 后缀', async () => {
    const a = path.join(dlDir, 'subA', 'dup.jpg')
    const b = path.join(dlDir, 'subB', 'dup.jpg')
    fs.mkdirSync(path.dirname(a), { recursive: true })
    fs.mkdirSync(path.dirname(b), { recursive: true })
    fs.writeFileSync(a, 'A')
    fs.writeFileSync(b, 'B')
    const res = await importAcceptedCrawlerProposal(
      makeCandidate(), 7, baseDeps([mediaRow(1, a), mediaRow(2, b)]),
    )
    expect(res.moved).toBe(2)
    const dir = path.join(root, IMPORT_DIR, 'www.bilibili.com', '落日 图集')
    expect(fs.existsSync(path.join(dir, 'dup.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'dup_1.jpg'))).toBe(true)
    expect(updates.map(u => u.p)).toEqual([
      path.join(dir, 'dup.jpg'), path.join(dir, 'dup_1.jpg'),
    ])
  })

  it('M3：sidecar 迁移失败不阻断主文件登记', async () => {
    const f = path.join(dlDir, 'm.jpg')
    fs.writeFileSync(f, 'M')
    fs.writeFileSync(f + '.luuk-provenance.json', '{}')
    const deps = baseDeps([mediaRow(1, f)])
    deps.relocate = async (from, to) => {
      if (from.endsWith('.luuk-provenance.json')) throw new Error('EACCES sidecar')
      fs.copyFileSync(from, to); fs.unlinkSync(from)
    }
    const res = await importAcceptedCrawlerProposal(makeCandidate(), 7, deps)
    expect(res.moved).toBe(1)
    expect(updates).toHaveLength(1) // 主文件成功→回写不受 sidecar 失败影响
    expect(res.errors.some(e => e.includes('sidecar 迁移失败'))).toBe(true)
    expect(res.scanned).toBe(true)
  })

  it('H1：落点目录创建失败回 errors，不冒泡崩溃且零扫描', async () => {
    const fileAsRoot = path.join(root, 'afile')
    fs.writeFileSync(fileAsRoot, 'x') // 用文件当库根 → mkdir 必失败
    const deps = baseDeps([mediaRow(1, path.join(dlDir, 'x.jpg'))])
    deps.getLibraryRootPath = () => fileAsRoot
    const res = await importAcceptedCrawlerProposal(makeCandidate(), 7, deps)
    expect(res.moved).toBe(0)
    expect(res.scanned).toBe(false)
    expect(res.errors[0]).toContain('落点目录创建失败')
    expect(scanCalls).toHaveLength(0)
  })
})
