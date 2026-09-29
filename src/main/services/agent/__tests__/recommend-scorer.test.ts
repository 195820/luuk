/**
 * T16 — RecommendScorer + CrawlerPipelineSink 单测
 * 覆盖：确定性评分信号（命中/亲和/衰减/排除一票否决）、决策融合与归因、pending 防重、
 *       轮初快照语义（本轮入库不误判为重复）、D9 state 白名单、真库全链路（fixture→提案入库，零网络）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { RecommendScorer, SCORER_PARAMS, draftTextTokens } from '../recommend-scorer'
import { CrawlerPipelineSink, CrawlerService } from '../../crawler/crawler-service'
import { CrawlerIntake } from '../../crawler/intake'
import { CrawlItemStore, urlHash } from '../../crawler/crawl-item-store'
import { ProposalStore, resetProposalStore } from '../proposal-store'
import { MasterDB } from '../../database'
import type {
  CandidateDraft,
  CrawlSourceRecord,
  DecisionAnswer,
  DecisionContext,
  DecisionSource,
  PreferenceProfile,
} from '../../../../types/agent'

// ── 测试基元 ──

const NOW = Date.parse('2026-09-26T00:00:00Z')

function profile(over: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    libraryId: null,
    keywords: [
      { term: 'sunset', weight: 2 },
      { term: 'beach', weight: 1 },
    ],
    sourceAffinity: {},
    exclusions: { terms: [], sourceIds: [] },
    updatedAt: '2026-01-01',
    ...over,
  }
}

function draft(over: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    sourceUrl: 'https://site/post/1',
    pageTitle: 'sunset beach',
    tags: ['sunset'],
    mediaUrls: ['https://cdn/1.jpg'],
    ...over,
  }
}

function makeSource(over: Partial<CrawlSourceRecord> = {}): CrawlSourceRecord {
  return {
    id: 1, pluginId: 'builtin.demo', name: 'demo', enabled: true, health: 'ok',
    successRate: null, lastCrawlAt: null, createdAt: '2026-01-01',
    config: {
      connectorType: 'web-http', params: {},
      ops: { buildRequests: 'demo.buildRequests', parseResponse: 'demo.parseResponse' },
    },
    ...over,
  }
}

/** 决策替身：固定返回 + 记录 ctx（null=无任何可用 provider） */
function fakeJudge(result: {
  answers: Record<string, DecisionAnswer>; decisionSrc: DecisionSource; confidence: number
} | null) {
  const calls: DecisionContext[] = []
  return { calls, judge: async (ctx: DecisionContext) => { calls.push(ctx); return result } }
}

interface CreateCall {
  agentKind: 'crawler'
  libraryId: number | null
  payload: CandidateDraft & { score: number }
  score: number
  decisionSrc: DecisionSource
  confidence: number
}

/** 提案写入替身 */
function fakeProposals() {
  const calls: CreateCall[] = []
  return { calls, create: (input: CreateCall) => { calls.push(input); return { id: calls.length } } }
}

function makeScorer(deps: {
  profile?: PreferenceProfile
  registry?: ReturnType<typeof fakeJudge>
  proposals?: ReturnType<typeof fakeProposals>
  hasPendingProposal?: (u: string) => boolean
} = {}): RecommendScorer {
  return new RecommendScorer({
    getProfile: () => deps.profile ?? profile(),
    registry: deps.registry ?? fakeJudge(null),
    proposals: deps.proposals ?? fakeProposals(),
    hasPendingProposal: deps.hasPendingProposal ?? (() => false),
    now: () => NOW,
  })
}

// ── 纯打分 ──

describe('scoreDraft', () => {
  it('全命中 + 中性亲和：base=0.7*1+0.3*0.5', () => {
    const s = makeScorer().scoreDraft(draft(), 1, profile())
    expect(s.hitRatio).toBe(1)
    expect(s.excluded).toBe(false)
    expect(s.score).toBeCloseTo(SCORER_PARAMS.KEYWORD_RATIO + SCORER_PARAMS.AFFINITY_RATIO * 0.5)
  })
  it('sourceAffinity 参与打分（钳位 0-1）', () => {
    const s = makeScorer().scoreDraft(draft(), 7, profile({ sourceAffinity: { '7': 1.5 } }))
    expect(s.affinity).toBe(1)
    expect(s.score).toBeCloseTo(SCORER_PARAMS.KEYWORD_RATIO + SCORER_PARAMS.AFFINITY_RATIO)
  })
  it('发布衰减：一个半衰期 → 0.5；低于 FLOOR 封底；无日期不衰减', () => {
    const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString()
    const scorer = makeScorer()
    const half = scorer.scoreDraft(draft({ publishedAt: at(SCORER_PARAMS.DECAY_TAU_DAYS) }), 1, profile())
    expect(half.decay).toBeCloseTo(0.5)
    const old = scorer.scoreDraft(draft({ publishedAt: at(10_000) }), 1, profile())
    expect(old.decay).toBe(SCORER_PARAMS.DECAY_FLOOR)
    expect(scorer.scoreDraft(draft(), 1, profile()).decay).toBe(1)
  })
  it('排除词与排除源一票否决：score=0 excluded', () => {
    const scorer = makeScorer()
    expect(scorer.scoreDraft(draft(), 1, profile({ exclusions: { terms: ['sunset'], sourceIds: [] } })))
      .toMatchObject({ score: 0, excluded: true })
    expect(scorer.scoreDraft(draft(), 3, profile({ exclusions: { terms: [], sourceIds: [3] } })))
      .toMatchObject({ excluded: true })
  })
  it('draftTextTokens 与画像同一 tokenize 口径（CJK 连写 + 小写归一）', () => {
    const t = draftTextTokens(draft({ pageTitle: '落日海岸 Sunset', description: 'x' }))
    expect(t.has('落日海岸')).toBe(true)
    expect(t.has('sunset')).toBe(true)
    expect(t.has('x')).toBe(false) // 长度 <2 丢弃
  })
})

// ── propose：决策融合 / 归因 / 防重 ──

describe('RecommendScorer.propose', () => {
  it('排除一票否决：不产提案、不进决策（vetoed 计数）', async () => {
    const registry = fakeJudge(null)
    const proposals = fakeProposals()
    const scorer = makeScorer({
      profile: profile({ exclusions: { terms: ['sunset'], sourceIds: [] } }),
      registry,
      proposals,
    })
    const res = await scorer.propose(makeSource(), [draft()], 1)
    expect(res).toMatchObject({ proposed: 0, vetoed: 1 })
    expect(proposals.calls).toHaveLength(0)
    expect(registry.calls).toHaveLength(0)
  })

  it('noul 融合 + decisionSrc 归因保持真实（jev 达标即记 jev）', async () => {
    const proposals = fakeProposals()
    const scorer = makeScorer({
      registry: fakeJudge({ answers: { worth: { noul: 1, confidence: 0.9 } }, decisionSrc: 'jev', confidence: 0.9 }),
      proposals,
    })
    const res = await scorer.propose(makeSource(), [draft()], 5)
    expect(res.proposed).toBe(1)
    const input = proposals.calls[0]
    expect(input).toMatchObject({ agentKind: 'crawler', libraryId: 5, decisionSrc: 'jev', confidence: 0.9 })
    const base = SCORER_PARAMS.KEYWORD_RATIO + SCORER_PARAMS.AFFINITY_RATIO * SCORER_PARAMS.AFFINITY_NEUTRAL
    expect(input.score).toBeCloseTo((1 - SCORER_PARAMS.DECISION_BLEND) * base + SCORER_PARAMS.DECISION_BLEND * 1)
    // payload = CandidateItem：元数据直转 + 三分字段
    expect(input.payload).toMatchObject({ sourceId: 1, sourceUrl: 'https://site/post/1', tags: ['sunset'] })
  })

  it('provider 全缺（judge=null）→ decisionSrc=human 转人工', async () => {
    const proposals = fakeProposals()
    const scorer = makeScorer({ proposals })
    await scorer.propose(makeSource(), [draft()], null)
    expect(proposals.calls[0]).toMatchObject({ decisionSrc: 'human', confidence: 0 })
  })

  it('同 sourceUrl 已有 pending 提案 → 零重复；无媒体草稿不提案', async () => {
    const scorer = makeScorer({ hasPendingProposal: u => u === 'https://site/post/1' })
    const res = await scorer.propose(makeSource(), [
      draft(),
      draft({ sourceUrl: 'https://site/post/2', mediaUrls: [] }),
    ], null)
    expect(res).toMatchObject({ proposed: 0, skippedDuplicate: 1, skippedNoMedia: 1 })
  })

  it('D9 白名单：决策 state 不含 mediaUrls/URL/绝对路径；问题为 noul（非单选项，S9）', async () => {
    const registry = fakeJudge(null)
    const scorer = makeScorer({ registry })
    await scorer.propose(makeSource(), [draft({ description: 'd' })], null)
    const ctx = registry.calls[0]
    expect(JSON.stringify(ctx.state)).not.toContain('https://')
    expect(ctx.state).toMatchObject({ title: 'sunset beach', description: 'd', sourceName: 'demo' })
    expect(ctx.questions.worth.type).toBe('noul')
  })
})

// ── CrawlerPipelineSink：轮初快照时序 ──

describe('CrawlerPipelineSink', () => {
  it('intake 收全量草稿、propose 只收轮初未见的；返回 ingested', async () => {
    const seen = new Set(['https://cdn/old.jpg'])
    const intakeCalls: CandidateDraft[][] = []
    const proposeCalls: Array<{ drafts: CandidateDraft[]; lib: number | null }> = []
    const sink = new CrawlerPipelineSink({
      intake: {
        process: async (_s, ds) => { intakeCalls.push(ds); return { ingested: 7 } },
      },
      urlSeen: u => seen.has(u),
      stage: {
        propose: async (_s, ds, lib) => { proposeCalls.push({ drafts: ds, lib }); return 1 },
      },
      getLibraryId: () => 42,
    })
    const old = draft({ sourceUrl: 'https://site/old', mediaUrls: ['https://cdn/old.jpg'] })
    const freshOne = draft({ sourceUrl: 'https://site/new', mediaUrls: ['https://cdn/new.jpg'] })
    expect(await sink.ingest(makeSource(), [old, freshOne])).toBe(7)
    expect(intakeCalls[0]).toHaveLength(2)      // 全量交 intake（由其做三级去重）
    expect(proposeCalls[0].drafts).toEqual([freshOne]) // 提案只收新面孔
    expect(proposeCalls[0].lib).toBe(42)        // libraryId 透传
  })

  it('提案段抛错不影响入库结果', async () => {
    const sink = new CrawlerPipelineSink({
      intake: { process: async () => ({ ingested: 3 }) },
      urlSeen: () => false,
      stage: { propose: async () => { throw new Error('scorer 崩了') } },
      getLibraryId: () => null,
    })
    expect(await sink.ingest(makeSource(), [draft()])).toBe(3)
  })
})

// ── 真库全链路集成：fixture 响应 → 提案入库（零真实网络） ──

describe('T16 全链路集成（真 MasterDB + fake 出流）', () => {
  let db: MasterDB
  let tempDir: string
  let proposals: ProposalStore
  let items: CrawlItemStore

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivrec-'))
    db = new MasterDB()
    db.initialize(tempDir)
    resetProposalStore()
    proposals = new ProposalStore(db)
    items = new CrawlItemStore(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  /** fake 下载器：按 url 落一个占位文件（intake 的 hashFile/phash 走真实文件路径） */
  const fakeDownloader = (dir: string) => ({
    downloadAll: async (_base: string, targets: Array<{ url: string }>) =>
      targets.map(t => {
        const fp = path.join(dir, t.url.split('/').pop() || 'media.bin')
        fs.writeFileSync(fp, `bytes-of-${t.url}`)
        return { url: t.url, ok: true, filePath: fp }
      }),
    abortAll: () => 0,
  })

  it('首轮：入库 1 行 crawl_items + 1 条 pending 提案；二轮 url_hash 命中 → 零重复提案', async () => {
    const source = makeSource()
    const intake = new CrawlerIntake({
      items,
      downloader: fakeDownloader(tempDir) as never,
      getDownloadRoot: () => tempDir,
      computePhash: async () => '0000000000000000',
    })
    const scorer = new RecommendScorer({
      getProfile: () => profile(),
      registry: fakeJudge(null),
      proposals,
      hasPendingProposal: u => proposals.hasPendingForSourceUrl(u),
      now: () => NOW,
    })
    const sink = new CrawlerPipelineSink({
      intake,
      urlSeen: u => items.urlSeen(urlHash(u)),
      stage: { propose: (s, ds, lib) => scorer.propose(s, ds, lib) },
      getLibraryId: () => 1,
    })
    const svc = new CrawlerService({
      sourceStore: {
        get: () => source,
        commitRound: vi.fn(),
        setHealth: vi.fn(),
      } as never,
      executeOp: async (_p: string, opId: string) => opId === 'demo.buildRequests'
        ? { plans: [{ url: 'https://api.site/list' }], nextWatermark: '2' }
        : [{ ...draft(), mediaUrls: ['https://cdn/only-new.jpg'] }],
      executor: {
        executePlan: async (plan: { url: string }) => ({
          plan, ok: true, response: { status: 200, url: plan.url, body: '{}' },
        }),
        noteExtraction: () => false,
      } as never,
      sink,
    })

    const r1 = await svc.runSource(1)
    expect(r1.ingested).toBe(1)
    expect(items.count()).toBe(1)
    const page = proposals.list({ agentKind: 'crawler', state: 'pending' })
    expect(page.total).toBe(1)
    expect(page.items[0].payload).toMatchObject({
      sourceUrl: 'https://site/post/1', decisionSrc: 'human',
    })
    expect((page.items[0].payload as { score: number }).score).toBeGreaterThan(0)

    // 第二轮：同 url 已在 crawl_items → 轮初快照判重，propose 收不到新面孔
    const r2 = await svc.runSource(1)
    expect(r2.ingested).toBe(0)
    expect(items.count()).toBe(1)
    expect(proposals.list({ agentKind: 'crawler', state: 'pending' }).total).toBe(1) // 零重复提案
  })
})
