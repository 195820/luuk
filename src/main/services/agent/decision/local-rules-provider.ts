/**
 * T4 — LocalRulesProvider（默认决策提供者）
 * 零联网、零成本：基于偏好画像关键词匹配 + 统计规则回答 choice/score/noul 三类问题。
 * 与 JevProvider（T9）实现同一 DecisionProvider 接口，供 T16 主循环无差别调用（D6）。
 */
import type {
  DecisionProvider,
  DecisionContext,
  DecisionQuestion,
  DecisionAnswer,
  PreferenceProfile,
} from '../../../../types/agent'
import { tokenize } from '../preference-profiler'

/** 规则门控超参：集中定义便于调参 */
export const LOCAL_RULES_PARAMS = {
  /** 无命中时的置信度（低置信，触发升级链回落人工） */
  NO_HIT_CONFIDENCE: 0.2,
  /** 单选项问题无对比基准，置信度封顶为典型门控以下的保守值（S9） */
  SINGLE_OPTION_CAP: 0.4,
  /** noul 命中排除词/正向词时的极端值 */
  NOUL_NEGATIVE: 0.05,
  NOUL_POSITIVE: 0.95,
  NOUL_NEUTRAL: 0.5,
} as const

/** 把 state（文本元数据白名单，D9）展平为词项集合 */
export function flattenStateTokens(state: Record<string, unknown>): Set<string> {
  const tokens = new Set<string>()
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      for (const t of tokenize(value)) tokens.add(t)
    } else if (Array.isArray(value)) {
      value.forEach(walk)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk)
    }
  }
  Object.values(state).forEach(walk)
  return tokens
}

export class LocalRulesProvider implements DecisionProvider {
  readonly id = 'local-rules'
  readonly isRemote = false

  /** 画像经 getter 注入：保证每次判断用最新画像，且与 T6 反馈闭环天然联动 */
  constructor(private getProfile: () => PreferenceProfile) {}

  async isAvailable(): Promise<boolean> {
    // 无外部依赖，恒可用（升级链的最终兜底）
    return true
  }

  async judge(ctx: DecisionContext): Promise<Record<string, DecisionAnswer>> {
    const answers: Record<string, DecisionAnswer> = {}
    for (const [key, question] of Object.entries(ctx.questions)) {
      answers[key] = this.judgeOne(question, ctx.state)
    }
    return answers
  }

  private judgeOne(q: DecisionQuestion, state: Record<string, unknown>): DecisionAnswer {
    switch (q.type) {
      case 'choice': return this.judgeChoice(q, state)
      case 'score': return this.judgeScore(q, state)
      case 'noul': return this.judgeNoul(q, state)
    }
  }

  /** 选项与画像关键词的匹配度打分取最高；置信度由分布尖锐度导出 */
  private judgeChoice(
    q: Extract<DecisionQuestion, { type: 'choice' }>,
    state: Record<string, unknown>,
  ): DecisionAnswer {
    const profile = this.getProfile()
    const options = Object.keys(q.criteria)
    if (options.length === 0) {
      return { confidence: 0 }
    }
    const stateTokens = flattenStateTokens(state)
    const scores = options.map(opt => this.matchWeight(opt, q.criteria[opt], stateTokens, profile))
    const total = scores.reduce((a, b) => a + b, 0)

    if (total === 0) {
      // 无命中：均分分布，低置信
      const uniform = 1 / options.length
      return {
        choice: options[0],
        probabilities: Object.fromEntries(options.map(o => [o, uniform] as const)),
        confidence: LOCAL_RULES_PARAMS.NO_HIT_CONFIDENCE,
      }
    }
    const probabilities = Object.fromEntries(options.map((o, i) => [o, scores[i] / total]))
    const ranked = [...scores].sort((a, b) => b - a)
    // 尖锐度：最高占比 ×（1 与次高差距的集中度），命中越集中置信越高
    const top = ranked[0] / total
    const gap = ranked.length > 1 ? (ranked[0] - ranked[1]) / ranked[0] : 0
    let confidence = Math.min(1, top * (0.5 + gap / 2))
    // S9：单选项无可比对象，gap 不再人为给满分，额外封顶防恒过门控
    if (options.length < 2) confidence = Math.min(confidence, LOCAL_RULES_PARAMS.SINGLE_OPTION_CAP)
    const bestIdx = scores.indexOf(ranked[0])
    return {
      choice: options[bestIdx],
      probabilities,
      confidence,
    }
  }

  /** 命中数映射到有序等级：命中画像关键词的权重和 ÷ 画像权重和（0-1 截断） */
  private judgeScore(
    q: Extract<DecisionQuestion, { type: 'score' }>,
    state: Record<string, unknown>,
  ): DecisionAnswer {
    const profile = this.getProfile()
    const stateTokens = flattenStateTokens(state)
    const hits = q.criteria
      .map(c => this.matchWeight(c, null, stateTokens, profile))
    const hitCount = hits.filter(h => h > 0).length
    const score = q.criteria.length > 0 ? hitCount / q.criteria.length : 0
    const matchedWeight = hits.reduce((a, b) => a + b, 0)
    const totalWeight = profile.keywords.reduce((a, k) => a + k.weight, 0)
    const confidence = totalWeight > 0 && matchedWeight > 0
      ? Math.min(1, 0.4 + (matchedWeight / totalWeight))
      : LOCAL_RULES_PARAMS.NO_HIT_CONFIDENCE
    return { score, confidence }
  }

  /** 命中排除词 → 接近 0；命中正向关键词 → 接近 1；无命中 → 中性低置信 */
  private judgeNoul(
    _q: Extract<DecisionQuestion, { type: 'noul' }>,
    state: Record<string, unknown>,
  ): DecisionAnswer {
    const profile = this.getProfile()
    const stateTokens = flattenStateTokens(state)
    const exclusionHit = profile.exclusions.terms.some(t =>
      stateTokens.has(t.toLowerCase()),
    )
    if (exclusionHit) {
      return { noul: LOCAL_RULES_PARAMS.NOUL_NEGATIVE, confidence: 0.9 }
    }
    const positiveHit = profile.keywords.some(k => stateTokens.has(k.term))
    if (positiveHit) {
      return { noul: LOCAL_RULES_PARAMS.NOUL_POSITIVE, confidence: 0.8 }
    }
    return { noul: LOCAL_RULES_PARAMS.NOUL_NEUTRAL, confidence: LOCAL_RULES_PARAMS.NO_HIT_CONFIDENCE }
  }

  /**
   * 选项与画像的匹配权重：
   * 选项 key/描述 的分词 ∩ state 词项 ∩ 画像关键词，按画像权重累加；
   * state 交集用于把"画像泛权重"收敛到"当前上下文相关权重"
   */
  private matchWeight(
    optionKey: string,
    optionDesc: string | null,
    stateTokens: Set<string>,
    profile: PreferenceProfile,
  ): number {
    const optionTokens = new Set([...tokenize(optionKey), ...(optionDesc ? tokenize(optionDesc) : [])])
    let weight = 0
    for (const kw of profile.keywords) {
      if (optionTokens.has(kw.term) && (stateTokens.size === 0 || stateTokens.has(kw.term))) {
        weight += kw.weight
      }
    }
    return weight
  }
}
