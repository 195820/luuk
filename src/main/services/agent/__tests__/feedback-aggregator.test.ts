import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { MasterDB } from '../../database'
import { PreferenceProfiler } from '../preference-profiler'
import { ProposalStore } from '../proposal-store'
import { FeedbackAggregator, FEEDBACK_PARAMS, extractFeedbackTargets } from '../feedback-aggregator'
import type { CandidateItem } from '../../../../types/agent'

describe('extractFeedbackTargets', () => {
  it('从 CandidateItem 提取分词后的标签与来源 ID', () => {
    const item: CandidateItem = {
      sourceId: 7, sourceUrl: 'https://a.com/p/1', tags: ['Sunset Beach', 'portrait'],
      score: 0.9, decisionSrc: 'local', confidence: 0.8,
    }
    const { terms, sourceId } = extractFeedbackTargets(item)
    expect(terms).toEqual(['sunset', 'beach', 'portrait'])
    expect(sourceId).toBe(7)
  })

  it('非法 payload 返回空目标', () => {
    expect(extractFeedbackTargets(null)).toEqual({ terms: [], sourceId: null })
    expect(extractFeedbackTargets('str')).toEqual({ terms: [], sourceId: null })
    expect(extractFeedbackTargets({ tags: 'not-array' })).toEqual({ terms: [], sourceId: null })
  })
})

describe('FeedbackAggregator（T6 反馈强化）', () => {
  let db: MasterDB
  let tempDir: string
  let store: ProposalStore
  let aggregator: FeedbackAggregator
  let profiler: PreferenceProfiler

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivfb-'))
    db = new MasterDB()
    db.initialize(tempDir)
    db.addLibrary('测试库', path.join(tempDir, 'library'))
    profiler = new PreferenceProfiler(db)
    store = new ProposalStore(db)
    aggregator = new FeedbackAggregator(db, profiler)
    // 冷启动画像：sunset 权重 3.5（5 分收藏）
    db.addFavorite(1, 'a/sunset.jpg', ['sunset'], 5)
    profiler.getProfile(1)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const candidate = (tags: string[], sourceId = 7): CandidateItem => ({
    sourceId, sourceUrl: `https://a.com/${tags.join('-')}`, tags,
    score: 0.9, decisionSrc: 'local', confidence: 0.8,
  })

  const createAndResolve = (tags: string[], action: 'accept' | 'skip' | 'reject', sourceId = 7) => {
    const p = store.create({ agentKind: 'crawler', libraryId: 1, payload: candidate(tags, sourceId), score: 0.9 })
    const resolved = store.resolve(p.id, action)
    return aggregator.applyFeedback(resolved, action)
  }

  const weightOf = (profile: { keywords: Array<{ term: string; weight: number }> }, term: string) =>
    profile.keywords.find(k => k.term === term)?.weight

  it('accept 后关键词权重上升、来源亲和度上升', () => {
    const before = weightOf(db.getPreferenceProfile(1)!, 'sunset')
    const after = createAndResolve(['sunset'], 'accept')
    expect(weightOf(after, 'sunset')).toBeCloseTo(before! + FEEDBACK_PARAMS.DELTA.accept)
    expect(after.sourceAffinity['7']).toBeCloseTo(FEEDBACK_PARAMS.DELTA.accept)
  })

  it('accept 未命中词项以基础权重进入画像（新偏好可学习）', () => {
    const after = createAndResolve(['newterm'], 'accept')
    expect(weightOf(after, 'newterm')).toBeCloseTo(FEEDBACK_PARAMS.DELTA.accept)
  })

  it('skip 小幅下调、reject 大幅下调', () => {
    const skipped = createAndResolve(['sunset'], 'skip')
    expect(weightOf(skipped, 'sunset')).toBeCloseTo(3.5 + FEEDBACK_PARAMS.DELTA.skip)
    const rejected = createAndResolve(['sunset'], 'reject')
    expect(weightOf(rejected, 'sunset')).toBeCloseTo(3.5 + FEEDBACK_PARAMS.DELTA.skip + FEEDBACK_PARAMS.DELTA.reject)
  })

  it('累计 reject 达到阈值后词项与来源进入排除项', () => {
    let profile
    for (let i = 0; i < FEEDBACK_PARAMS.REJECTS_TO_EXCLUDE; i++) {
      profile = createAndResolve(['blurry'], 'reject')
    }
    expect(profile!.exclusions.terms).toContain('blurry')
    expect(weightOf(profile!, 'blurry')).toBeUndefined() // 排除项词项从关键词剔除
    expect(profile!.exclusions.sourceIds).toContain(7)
  })

  it('未达阈值的 reject 不晋级排除项', () => {
    const profile = createAndResolve(['blurry'], 'reject')
    expect(profile.exclusions.terms).not.toContain('blurry')
    expect(profile.exclusions.sourceIds).toEqual([])
  })

  it('权重边界：不下穿 WEIGHT_MIN、亲和度不越 [0,1]', () => {
    // sunset 3.5 连续 reject：每次 -0.2 直到被排除项晋级（≥3 次后进入 exclusions）
    for (let i = 0; i < 5; i++) createAndResolve(['sunset'], 'reject')
    const profile = db.getPreferenceProfile(1)!
    const sunset = profile.keywords.find(k => k.term === 'sunset')
    if (sunset) expect(sunset.weight).toBeGreaterThanOrEqual(FEEDBACK_PARAMS.WEIGHT_MIN)
    // 新词从 0 起 skip：亲和度钳在 0
    const p2 = createAndResolve(['lonely'], 'skip', 9)
    expect(p2.sourceAffinity['9']).toBe(0)
  })

  it('每次反馈在 feedback_log 留痕（delta 记录净调整量）', () => {
    createAndResolve(['sunset'], 'accept')
    const log = db.getRawDb()!.prepare('SELECT * FROM feedback_log ORDER BY id DESC LIMIT 1').get() as any
    expect(log.action).toBe('accept')
    expect(log.delta).toBeCloseTo(FEEDBACK_PARAMS.DELTA.accept) // 1 词项 × 0.1
  })

  it('画像持久化：反馈结果跨重启读取', () => {
    createAndResolve(['sunset'], 'accept')
    const saved = db.getPreferenceProfile(1)!
    db.close()
    const db2 = new MasterDB()
    db2.initialize(tempDir)
    const loaded = db2.getPreferenceProfile(1)!
    expect(loaded.keywords).toEqual(saved.keywords)
    expect(loaded.sourceAffinity).toEqual({ '7': 0.1 })
    db = db2
  })

  it('无缓存画像时经 profiler 冷启动再应用反馈', () => {
    db.getRawDb()!.prepare('DELETE FROM preference_profile').run()
    const after = createAndResolve(['sunset'], 'accept')
    expect(weightOf(after, 'sunset')).toBeCloseTo(3.5 + 0.1)
  })

  // ── 审查回归：学习闭环 ──

  it('C2：反馈前存在未消费行为数据时，先经脏检查重建再应用（不吞行为信号）', () => {
    // 画像水位线回拨到收藏之前，模拟"建像后又收藏了 mountain 但未消费"
    db.getRawDb()!.prepare('UPDATE preference_profile SET source_watermark = ?, updated_at = ?')
      .run('2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z')
    db.addFavorite(1, 'm/mountain.jpg', ['mountain'], 5)
    const after = createAndResolve(['sunset'], 'accept')
    expect(weightOf(after, 'mountain')).toBeCloseTo(3.5) // 新行为已入像
    expect(weightOf(after, 'sunset')).toBeCloseTo(3.6)   // 3.5 + accept 0.1
  })

  it('C1：反馈写入 learnedDeltas 并在后续重建中存活', () => {
    const after = createAndResolve(['sunset', 'newterm'], 'accept')
    expect(after.learnedDeltas?.['sunset']).toBeCloseTo(0.1)
    expect(after.learnedDeltas?.['newterm']).toBeCloseTo(0.1)
    // 强制重建：学习量叠加不丢失
    db.getRawDb()!.prepare('UPDATE preference_profile SET source_watermark = ?').run('2000-01-01T00:00:00.000Z')
    const rebuilt = profiler.getProfile(1)
    expect(weightOf(rebuilt, 'sunset')).toBeCloseTo(3.5 + 0.1)
    expect(weightOf(rebuilt, 'newterm')).toBeCloseTo(0.1)
  })

  it('排除项晋级时词项的学习量同步清除', () => {
    let profile
    for (let i = 0; i < FEEDBACK_PARAMS.REJECTS_TO_EXCLUDE; i++) {
      profile = createAndResolve(['blurry'], 'reject')
    }
    expect(profile!.exclusions.terms).toContain('blurry')
    expect(profile!.learnedDeltas?.['blurry']).toBeUndefined()
  })
})
