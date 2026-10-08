/**
 * T3 — PreferenceProfiler（偏好画像构建）
 * 从现有 favorites / ratings / tags / history 冷启动构建 PreferenceProfile，无需用户额外输入。
 * 画像缓存在 preference_profile 表，行为数据变动（最后活动时间 > updatedAt）时标脏重算，
 * 口径与 scanner 的 size+mtime 增量思路一致（时间戳比较，避免全量重扫）。
 */
import type { MasterDB, ProfilerSourceData } from '../database'
import type { PreferenceProfile, WeightedKeyword } from '../../../types/agent'
import { logger } from '../../../utils/logger'

/** 画像超参：集中定义便于调参（与 T6 反馈强度同一风格） */
export const PROFILE_PARAMS = {
  /** 收藏基础权重（未评分收藏的倍率） */
  FAVORITE_BASE: 1,
  /** 每 1 分评分追加的倍率 */
  RATING_WEIGHT: 0.5,
  /** 浏览未收藏的弱信号权重 */
  HISTORY_WEIGHT: 0.2,
  /** rating 在 (0, LOW_RATING_THRESHOLD] 区间视为负信号，标签进入排除项 */
  LOW_RATING_THRESHOLD: 2,
  /** 关键词保留上限，防止画像 JSON 无限膨胀 */
  MAX_KEYWORDS: 200,
} as const

const LOG_KEY = 'PreferenceProfiler'

/**
 * 脏判定（S14）：用行为数据水位线（watermark）与最后活动时间在同时钟域（均为归一化 ISO 秒级串）
 * 字典序比较，避免 JS 毫秒钟与 SQLite 秒级钟混比失真；
 * 同秒内重建后发生的活动漏判窗口 ≤1s，后续任一活动到达即自愈
 */
export function isProfileStale(cached: PreferenceProfile, lastActivityAt: string | null): boolean {
  if (lastActivityAt === null) return false
  const baseline = cached.sourceWatermark ?? cached.updatedAt
  return lastActivityAt > baseline
}

/**
 * 文本分词：标签/文件名 stem → 词项
 * 按非字母数字与中日韩字符切分，小写归一，长度 <2 的词项丢弃
 */
export function tokenize(text: string): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .split(/[^0-9a-z\u3400-\u9fff]+/)
    .filter(t => t.length >= 2)
}

/** 取路径的文件名 stem（去扩展名） */
function stemOf(imagePath: string): string {
  const name = imagePath.split(/[\\/]/).pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** 空白的中性画像：无行为数据时返回，不报错 */
function emptyProfile(libraryId: number | null): PreferenceProfile {
  return {
    libraryId,
    keywords: [],
    learnedDeltas: {},
    sourceAffinity: {},
    exclusions: { terms: [], sourceIds: [] },
    updatedAt: new Date().toISOString(),
  }
}

export class PreferenceProfiler {
  /** 上次重建的壁钟时间（库维度），配合 rebuildThrottleMs 节流全表扫描 */
  private lastRebuildAt = new Map<string, number>()

  /**
   * @param rebuildThrottleMs 同一库两次重建的最小间隔（W8：脏不代表必须立刻全量重扫）；
   * 默认 0 不节流（单测/首次构建），生产接线（T16）建议 5 分钟
   */
  constructor(
    private db: MasterDB,
    private rebuildThrottleMs = 0,
  ) {}

  /**
   * 获取画像：缓存命中且未脏则直接返回，否则冷启动重建并持久化
   * @param force 跳过脏检查与节流强制重算
   */
  getProfile(libraryId: number | null, force = false): PreferenceProfile {
    const cached = this.db.getPreferenceProfile(libraryId)
    const lastActivity = this.db.getPreferenceLastActivityAt(libraryId)
    if (!force && cached) {
      // 行为数据无更新 → 缓存有效（水位线同时钟域比较）
      if (!isProfileStale(cached, lastActivity)) {
        return cached
      }
      // 节流：距上次重建不足间隔时先返回旧画像，避免主进程频繁同步全表扫描
      const last = this.lastRebuildAt.get(String(libraryId))
      if (this.rebuildThrottleMs > 0 && last !== undefined && Date.now() - last < this.rebuildThrottleMs) {
        return cached
      }
    }
    const data = this.db.getProfilerSourceData(libraryId)
    const profile = this.buildFromData(libraryId, data, cached)
    // 水位线推进到本轮已消费的最后活动时间
    profile.sourceWatermark = lastActivity
    this.db.savePreferenceProfile(profile)
    this.lastRebuildAt.set(String(libraryId), Date.now())
    return profile
  }

  /** 冷启动构建：加权 → 排除项晋级 → 合并缓存中由反馈维护的字段 */
  buildFromData(
    libraryId: number | null,
    data: ProfilerSourceData,
    previous?: PreferenceProfile | null,
  ): PreferenceProfile {
    const P = PROFILE_PARAMS
    if (data.favorites.length === 0 && data.tagEntries.length === 0 && data.historyPaths.length === 0) {
      // 无行为数据：保留反馈维护字段，关键词仅剩学习量为正且未被排除的词项（C1：学习信号不丢失）
      if (!previous) return emptyProfile(libraryId)
      const excluded = new Set(previous.exclusions.terms)
      const keywords = Object.entries(previous.learnedDeltas ?? {})
        .filter(([term, d]) => d > 0 && !excluded.has(term))
        .map(([term, weight]) => ({ term, weight }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, P.MAX_KEYWORDS)
      return { ...previous, libraryId, keywords, updatedAt: new Date().toISOString() }
    }

    const weights = new Map<string, number>()
    const negatives = new Map<string, number>()
    const bump = (map: Map<string, number>, term: string, delta: number) => {
      map.set(term, (map.get(term) ?? 0) + delta)
    }

    const favByPath = new Map<string, { tags: string[]; rating: number }>()
    for (const fav of data.favorites) {
      favByPath.set(fav.imagePath, fav)
      const multiplier = P.FAVORITE_BASE + fav.rating * P.RATING_WEIGHT
      // 低评分（有评分但 ≤ 阈值）视为负信号
      const isNegative = fav.rating > 0 && fav.rating <= P.LOW_RATING_THRESHOLD
      const terms = new Set<string>([
        ...fav.tags.flatMap(t => tokenize(t)),
        ...tokenize(stemOf(fav.imagePath)),
      ])
      for (const term of terms) {
        bump(isNegative ? negatives : weights, term, multiplier)
      }
    }

    // image_tags：收藏图的标签权重已按倍率累加过，避免双计；非收藏图仅在命中浏览记录时给弱信号
    const historyPaths = new Set(data.historyPaths.map(h => h.imagePath))
    for (const entry of data.tagEntries) {
      if (favByPath.has(entry.imagePath)) continue
      if (historyPaths.has(entry.imagePath)) {
        for (const term of tokenize(entry.tag)) bump(weights, term, P.HISTORY_WEIGHT)
      }
    }

    // 浏览未收藏：文件名 stem 弱信号（同一路径去重）
    for (const h of data.historyPaths) {
      if (favByPath.has(h.imagePath)) continue
      for (const term of new Set(tokenize(stemOf(h.imagePath)))) {
        bump(weights, term, P.HISTORY_WEIGHT)
      }
    }

    // 排除项晋级：本轮负信号 + 历史已晋级词项均不得重现于正向关键词（W6）
    const allExcluded = new Set([...negatives.keys(), ...(previous?.exclusions.terms ?? [])])
    for (const term of allExcluded) weights.delete(term)

    // C1：反馈学习量叠加到统计基权重（而非被重建覆盖）；已排除词项的学习量同步清除
    const learnedDeltas: Record<string, number> = {}
    for (const [term, delta] of Object.entries(previous?.learnedDeltas ?? {})) {
      if (allExcluded.has(term)) continue
      learnedDeltas[term] = delta
      bump(weights, term, delta)
    }

    // 被负向学习量压到 ≤0 的词项无正向信号，丢弃
    const keywords: WeightedKeyword[] = [...weights.entries()]
      .map(([term, weight]) => ({ term, weight: Math.round(weight * 1000) / 1000 }))
      .filter(k => k.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, P.MAX_KEYWORDS)

    const profile: PreferenceProfile = {
      libraryId,
      keywords,
      // 学习量跨重建保留，已排除词项剔除
      learnedDeltas,
      // M5 前 embedding 不产出，保留旧值（若有）
      visualTraits: previous?.visualTraits,
      // sourceAffinity 由 T6 反馈维护，重建时保留
      sourceAffinity: previous?.sourceAffinity ?? {},
      exclusions: {
        terms: [...allExcluded],
        sourceIds: previous?.exclusions.sourceIds ?? [],
      },
      updatedAt: new Date().toISOString(),
    }
    logger.info(LOG_KEY, `画像重建 lib=${libraryId ?? 'global'} keywords=${keywords.length} exclusions=${profile.exclusions.terms.length}`)
    return profile
  }
}
