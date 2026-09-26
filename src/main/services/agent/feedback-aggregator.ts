/**
 * T6 — FeedbackAggregator（反馈强化）
 * 把用户对提案的 accept/skip/reject 反馈回写为画像权重调整，形成学习闭环。
 * 反馈强度超参集中定义；每次调整在 feedback_log.delta 留痕，便于回溯与调参。
 */
import type { MasterDB } from '../database'
import type { PreferenceProfiler } from './preference-profiler'
import type { PreferenceProfile, Proposal, FeedbackAction } from '../../../types/agent'
import { tokenize } from './preference-profiler'
import { logger } from '../../../utils/logger'

const LOG_KEY = 'FeedbackAggregator'

/** 反馈强度超参（集中定义，调参只改这里） */
export const FEEDBACK_PARAMS = {
  /** 单次反馈对命中词项/来源亲和度的调整量 */
  DELTA: {
    accept: 0.1,
    skip: -0.02,
    reject: -0.2,
  } as Record<FeedbackAction, number>,
  /** 关键词权重上下限 */
  WEIGHT_MIN: 0,
  WEIGHT_MAX: 100,
  /** 来源亲和度上下限 */
  AFFINITY_MIN: 0,
  AFFINITY_MAX: 1,
  /** 同一词项/来源被累计 reject 达到该次数 → 晋级为排除项 */
  REJECTS_TO_EXCLUDE: 3,
} as const

/** 从提案 payload 提取可加权的词项与来源（采集 Agent payload = CandidateItem） */
export function extractFeedbackTargets(payload: unknown): { terms: string[]; sourceId: number | null } {
  if (!payload || typeof payload !== 'object') return { terms: [], sourceId: null }
  const p = payload as Record<string, unknown>
  const terms = new Set<string>()
  const tags = Array.isArray(p.tags) ? p.tags : []
  for (const tag of tags) {
    if (typeof tag === 'string') for (const t of tokenize(tag)) terms.add(t)
  }
  const sourceId = typeof p.sourceId === 'number' ? p.sourceId : null
  return { terms: [...terms], sourceId }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export class FeedbackAggregator {
  constructor(
    private db: MasterDB,
    private profiler: PreferenceProfiler,
  ) {}

  /**
   * 应用一次反馈：调整命中关键词权重与来源亲和度 → 排除项晋级 → 持久化画像 → feedback_log 留痕
   * 画像必经 profiler 获取（C2：先过脏检查，不绕过重建直接改旧缓存吞掉未消费的行为数据）
   */
  applyFeedback(proposal: Proposal, action: FeedbackAction): PreferenceProfile {
    const P = FEEDBACK_PARAMS
    const delta = P.DELTA[action]
    const libraryId = proposal.libraryId
    const profile = this.profiler.getProfile(libraryId)
    const { terms, sourceId } = extractFeedbackTargets(proposal.payload)

    // 1) 关键词权重调整（accept 未命中词项时新增，保证新偏好可进入画像）；
    //    同步累加 learnedDeltas（C1：重建时叠加不覆盖，学习信号跨重建保留）
    let applied = 0
    const learnedDeltas = { ...profile.learnedDeltas }
    const keywordMap = new Map(profile.keywords.map(k => [k.term, k]))
    for (const term of terms) {
      learnedDeltas[term] = Math.round(((learnedDeltas[term] ?? 0) + delta) * 1000) / 1000
      const existing = keywordMap.get(term)
      if (existing) {
        const next = clamp(existing.weight + delta, P.WEIGHT_MIN, P.WEIGHT_MAX)
        applied += next - existing.weight
        existing.weight = Math.round(next * 1000) / 1000
      } else if (delta > 0) {
        keywordMap.set(term, { term, weight: delta })
        applied += delta
      }
    }

    // 2) 来源亲和度调整
    const affinity = { ...profile.sourceAffinity }
    if (sourceId !== null) {
      const key = String(sourceId)
      const prev = affinity[key] ?? 0
      affinity[key] = Math.round(clamp(prev + delta, P.AFFINITY_MIN, P.AFFINITY_MAX) * 1000) / 1000
    }

    // 3) 排除项晋级：统计该词项/来源在提案反馈中被 reject 的累计次数
    const rejectCounts = this.countRejectsByTerm(libraryId)
    const exclusions = {
      terms: [...new Set([...profile.exclusions.terms, ...rejectCounts.terms])],
      sourceIds: [...new Set([...profile.exclusions.sourceIds, ...rejectCounts.sourceIds])],
    }

    // 进入排除项的词项从关键词与学习量中同步剔除（与 profiler 重建口径一致）
    const excludedSet = new Set(exclusions.terms)
    let keywords = [...keywordMap.values()].filter(k => !excludedSet.has(k.term))
    keywords.sort((a, b) => b.weight - a.weight)
    for (const term of excludedSet) delete learnedDeltas[term]

    const next: PreferenceProfile = {
      ...profile,
      keywords,
      learnedDeltas,
      sourceAffinity: affinity,
      exclusions,
      updatedAt: new Date().toISOString(),
    }
    this.db.savePreferenceProfile(next)

    // 4) feedback_log 留痕：本次反馈对画像权重的净调整量
    const raw = this.db.getRawDb()
    raw?.prepare(
      'UPDATE feedback_log SET delta = ? WHERE id = (SELECT MAX(id) FROM feedback_log WHERE proposal_id = ?)',
    ).run(Math.round(applied * 1000) / 1000, proposal.id)

    logger.info(LOG_KEY, `反馈 ${action} 提案 ${proposal.id}：净 delta=${applied.toFixed(3)} 词项=${terms.length} 来源=${sourceId ?? '-'}`)
    return next
  }

  /**
   * 统计"该库范围内、payload 命中某词项 / 某来源"的 reject 反馈累计次数，
   * 达到 REJECTS_TO_EXCLUDE 的词项/来源晋级排除项。
   * 与本次反馈合并统计（本次 resolve 已写入 feedback_log，reject 计数天然包含当前提案）
   */
  private countRejectsByTerm(libraryId: number | null): { terms: string[]; sourceIds: number[] } {
    const raw = this.db.getRawDb()
    if (!raw) return { terms: [], sourceIds: [] }
    const rows = raw.prepare(`
      SELECT p.payload FROM proposals p
      JOIN feedback_log f ON f.proposal_id = p.id
      WHERE f.action = 'reject' AND p.agent_kind = 'crawler' ${libraryId === null ? '' : 'AND p.library_id = ?'}
    `).all(...(libraryId === null ? [] : [libraryId])) as Array<{ payload: string }>

    const rejectCount = new Map<string, number>()
    const sourceReject = new Map<number, number>()
    for (const row of rows) {
      let payload: unknown
      try { payload = JSON.parse(row.payload) } catch { continue }
      const { terms, sourceId } = extractFeedbackTargets(payload)
      const seen = new Set<string>()
      for (const term of terms) {
        if (seen.has(term)) continue
        seen.add(term)
        rejectCount.set(term, (rejectCount.get(term) ?? 0) + 1)
      }
      if (sourceId !== null) sourceReject.set(sourceId, (sourceReject.get(sourceId) ?? 0) + 1)
    }
    const threshold = FEEDBACK_PARAMS.REJECTS_TO_EXCLUDE
    return {
      terms: [...rejectCount.entries()].filter(([, n]) => n >= threshold).map(([t]) => t),
      sourceIds: [...sourceReject.entries()].filter(([, n]) => n >= threshold).map(([s]) => s),
    }
  }
}
