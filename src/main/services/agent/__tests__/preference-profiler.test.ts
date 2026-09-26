import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { MasterDB } from '../../database'
import { PreferenceProfiler, tokenize, PROFILE_PARAMS, isProfileStale } from '../preference-profiler'

describe('tokenize 分词', () => {
  it('按分隔符切分并小写归一', () => {
    expect(tokenize('Sunset_Beach-2024')).toEqual(['sunset', 'beach', '2024'])
  })

  it('丢弃长度 <2 的词项，保留中日韩字符', () => {
    expect(tokenize('a 人像 b 海边2')).toEqual(['人像', '海边2'])
  })

  it('空串返回空数组', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('PreferenceProfiler（T3 偏好画像）', () => {
  let db: MasterDB
  let tempDir: string
  let profiler: PreferenceProfiler

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivprof-'))
    db = new MasterDB()
    db.initialize(tempDir)
    db.addLibrary('测试库', path.join(tempDir, 'library'))
    profiler = new PreferenceProfiler(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const weightOf = (term: string) =>
    profiler.getProfile(1).keywords.find(k => k.term === term)?.weight

  it('空库返回中性画像（不报错，keywords 为空）', () => {
    const profile = profiler.getProfile(null)
    expect(profile.keywords).toEqual([])
    expect(profile.exclusions.terms).toEqual([])
    expect(profile.sourceAffinity).toEqual({})
  })

  it('高频高评分标签权重显著高于低频低评分标签', () => {
    // "sunset" 出现在 3 张 5 分收藏中；"blur" 只出现在 1 张 1 分收藏中
    db.addFavorite(1, 'a/sunset_1.jpg', ['sunset'], 5)
    db.addFavorite(1, 'b/sunset_2.jpg', ['sunset'], 5)
    db.addFavorite(1, 'c/sunset_3.jpg', ['sunset'], 4)
    db.addFavorite(1, 'd/blur.jpg', ['blur'], 3)
    const profile = profiler.getProfile(1)
    const sunset = profile.keywords.find(k => k.term === 'sunset')!.weight
    const blur = profile.keywords.find(k => k.term === 'blur')!.weight
    expect(sunset).toBeGreaterThan(blur * 2)
  })

  it('评分越高权重越大（同频次下倍率生效）', () => {
    db.addFavorite(1, 'x.jpg', ['beach'], 5)
    db.addFavorite(1, 'y.jpg', ['beach'], 2) // 低评分 → 负信号进排除项，用 3 分对照
    const p1 = profiler.getProfile(1, true)
    // 排除：rating 在 (0,2] 视为负信号，beach 被拉低并进入排除项
    expect(p1.exclusions.terms).toContain('beach')
    expect(p1.keywords.find(k => k.term === 'beach')).toBeUndefined()
  })

  it('低评分标签进入排除项', () => {
    db.addFavorite(1, 'photo1.jpg', ['watermark'], 1)
    const profile = profiler.getProfile(1)
    expect(profile.exclusions.terms).toContain('watermark')
  })

  it('文件名 stem 分词进入关键词', () => {
    db.addFavorite(1, 'shots/cherry_blossom.jpg', [], 5)
    const profile = profiler.getProfile(1)
    expect(profile.keywords.map(k => k.term)).toContain('cherry')
    expect(profile.keywords.map(k => k.term)).toContain('blossom')
  })

  it('image_tags 与收藏标签不双计：收藏图标签只按倍率累加一次', () => {
    db.addFavorite(1, 'a.jpg', ['portrait'], 5)
    const tag = db.createTag('portrait')
    db.tagImages([tag.id], 1, ['a.jpg'])
    const expected = PROFILE_PARAMS.FAVORITE_BASE + 5 * PROFILE_PARAMS.RATING_WEIGHT
    expect(weightOf('portrait')).toBe(expected)
  })

  it('浏览未收藏给弱信号，浏览图的 image_tags 也计入', () => {
    const tag = db.createTag('street')
    db.tagImages([tag.id], 1, ['viewed.jpg'])
    db.addHistory(1, 'viewed.jpg')
    const profile = profiler.getProfile(1)
    expect(weightOf('street')).toBeCloseTo(PROFILE_PARAMS.HISTORY_WEIGHT)
    expect(profile.keywords.map(k => k.term)).toContain('viewed')
  })

  it('画像持久化：跨重启可读取，且无新行为时命中缓存不重算', () => {
    db.addFavorite(1, 'a/sunset.jpg', ['sunset'], 5)
    const first = profiler.getProfile(1)
    db.close()

    const db2 = new MasterDB()
    db2.initialize(tempDir)
    const profiler2 = new PreferenceProfiler(db2)
    const loaded = profiler2.getProfile(1)
    expect(loaded.keywords).toEqual(first.keywords)
    expect(loaded.updatedAt).toBe(first.updatedAt) // 命中缓存，非重建
    db = db2
  })

  it('增量标脏：新行为数据活动时间晚于水位线时自动重算', () => {
    db.addFavorite(1, 'a/sunset.jpg', ['sunset'], 5)
    const first = profiler.getProfile(1)

    // 脏判定已改用水位线（S14）：把 watermark/updatedAt 回拨到过去模拟脏
    db.savePreferenceProfile({ ...first, updatedAt: '2000-01-01T00:00:00.000Z', sourceWatermark: '2000-01-01T00:00:00.000Z' })
    const rebuilt = profiler.getProfile(1)
    expect(rebuilt.keywords.map(k => k.term)).toContain('sunset')
    expect(rebuilt.updatedAt >= first.updatedAt).toBe(true)

    // 重建后再次获取应命中缓存（updatedAt 不变）
    const cached = profiler.getProfile(1)
    expect(cached.updatedAt).toBe(rebuilt.updatedAt)
  })

  it('重建保留反馈维护的 sourceAffinity（T6 字段的连续性）', () => {
    db.addFavorite(1, 'a.jpg', ['sunset'], 5)
    const first = profiler.getProfile(1)
    db.savePreferenceProfile({ ...first, sourceAffinity: { '7': 0.8 }, updatedAt: '2000-01-01T00:00:00.000Z', sourceWatermark: '2000-01-01T00:00:00.000Z' })
    const rebuilt = profiler.getProfile(1)
    expect(rebuilt.sourceAffinity).toEqual({ '7': 0.8 })
  })

  it('全局画像（libraryId=null）聚合所有库', () => {
    db.addLibrary('库B', path.join(tempDir, 'lib2'))
    db.addFavorite(1, 'a.jpg', ['albumA'], 5)
    db.addFavorite(2, 'b.jpg', ['albumB'], 5)
    const profile = profiler.getProfile(null)
    const terms = profile.keywords.map(k => k.term)
    expect(terms).toContain('albuma')
    expect(terms).toContain('albumb')
  })

  // ── 审查回归：学习闭环 / 排除项连续性 / 评分标脏 ──

  it('C1：重建把 learnedDeltas 叠加到基权重，学习新词并入关键词', () => {
    db.addFavorite(1, 'a/sunset.jpg', ['sunset'], 5)
    const first = profiler.getProfile(1) // sunset = 1 + 5*0.5 = 3.5
    db.savePreferenceProfile({
      ...first,
      learnedDeltas: { sunset: 0.1, aurora: 0.2 },
      sourceWatermark: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
    })
    const rebuilt = profiler.getProfile(1)
    const weight = (t: string) => rebuilt.keywords.find(k => k.term === t)?.weight
    expect(weight('sunset')).toBeCloseTo(3.6) // base + learned，不被重建覆盖
    expect(weight('aurora')).toBeCloseTo(0.2) // 行为数据不存在的新词也不丢失
    expect(rebuilt.learnedDeltas).toEqual({ sunset: 0.1, aurora: 0.2 })
  })

  it('C1：无行为数据时关键词仅剩学习量为正的词项（学习信号不清零）', () => {
    db.savePreferenceProfile({
      libraryId: 1,
      keywords: [{ term: 'aurora', weight: 0.2 }],
      learnedDeltas: { aurora: 0.2, down: -0.1 },
      sourceAffinity: {},
      exclusions: { terms: [], sourceIds: [] },
      updatedAt: new Date().toISOString(),
    })
    const rebuilt = profiler.getProfile(1, true)
    expect(rebuilt.keywords.map(k => k.term)).toEqual(['aurora'])
  })

  it('W6：历史已晋级排除词重建后不重现于正向关键词', () => {
    db.addFavorite(1, 'a/sunset.jpg', ['sunset'], 5)
    const first = profiler.getProfile(1)
    db.savePreferenceProfile({
      ...first,
      learnedDeltas: { sunset: 0.1 },
      exclusions: { terms: ['sunset'], sourceIds: [] },
      sourceWatermark: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
    })
    const rebuilt = profiler.getProfile(1)
    expect(rebuilt.keywords.map(k => k.term)).not.toContain('sunset')
    expect(rebuilt.exclusions.terms).toContain('sunset')
    expect(rebuilt.learnedDeltas?.['sunset']).toBeUndefined() // 排除词学习量同步清除
  })

  it('W5：修改已收藏图评分会刷新 updated_at 并标脏画像', () => {
    db.addFavorite(1, 'a/beach.jpg', ['beach'], 3)
    const first = profiler.getProfile(1) // beach = 1 + 3*0.5 = 2.5
    db.setFavoriteRating(1, 'a/beach.jpg', 5)
    const row = db.getRawDb()!.prepare('SELECT updated_at FROM favorites').get() as { updated_at: string | null }
    expect(row.updated_at).not.toBeNull()
    // 秒级精度下同秒活动不立即脏（≤1s 自愈窗口）；推进 updated_at 验证脏路径
    db.getRawDb()!.prepare('UPDATE favorites SET updated_at = ?').run('2027-01-01 00:00:00')
    const rebuilt = profiler.getProfile(1)
    expect(rebuilt.keywords.find(k => k.term === 'beach')!.weight).toBeCloseTo(3.5)
    expect(rebuilt.updatedAt >= first.updatedAt).toBe(true)
  })

  it('S14：脏判定用水位线同时钟域比较，无 watermark 时回退 updatedAt', () => {
    const base = {
      libraryId: 1, keywords: [], sourceAffinity: {},
      exclusions: { terms: [], sourceIds: [] }, sourceWatermark: '2026-01-01T00:00:00.000Z',
    }
    const withWm = { ...base, updatedAt: 'x' as never }
    expect(isProfileStale(withWm as any, null)).toBe(false)
    expect(isProfileStale(withWm as any, '2026-01-01T00:00:00.000Z')).toBe(false)
    expect(isProfileStale(withWm as any, '2026-01-01T00:00:01.000Z')).toBe(true)
    const legacy = { libraryId: 1, keywords: [], sourceAffinity: {}, exclusions: { terms: [], sourceIds: [] }, updatedAt: '2026-01-01T00:00:00.000Z' }
    expect(isProfileStale(legacy, '2026-01-01T00:00:01.000Z')).toBe(true)
    expect(isProfileStale(legacy, '2025-12-31T23:59:59.000Z')).toBe(false)
  })
})
