/**
 * T16 — RecommendScorer（候选评分 → 决策 → 提案）
 * 采集主循环的下游终点：drafts 经 T15 去重入库后，本轮"新面孔"在此打分并转为
 * `proposals`（agentKind:'crawler'，payload=CandidateItem），等 M4 用户确认（D8 人在回路）。
 *
 * 评分信号（画像一律经 getProfile 注入读取，含 learnedDeltas，不绕过 profiler——M1 修正 C1）：
 *   ① 关键词命中率：候选文本词项命中的画像权重 / 画像总权重
 *   ② 来源亲和度：sourceAffinity[sourceId]（新源中性值，不惩罚未反馈过的来源）
 *   ③ 发布时间衰减：半衰期模型，无日期不衰减
 *   排除词/排除源一票否决：score=0 且不产提案（硬规则，不进决策）
 *
 * 决策经 DecisionRegistry.judge 统一入口（D6）：LocalRules 默认、Jev 达门控才升级；
 * 问题用 noul 型（非单选项，S9 无鉴别力问题天然规避）；回落链尾规则不改（W7）。
 * 无任何可用 provider → decisionSrc='human' 转人工（D6 升级链最终回落）。
 *
 * 隐私（D9）：发往决策层的 state 只含标题/描述/标签/作者等文本元数据，
 * 绝不包含 mediaUrls（file:// 即绝对路径）、来源 URL。
 */
import { logger } from '../../../utils/logger'
import { tokenize } from './preference-profiler'
import type {
  CandidateDraft,
  CandidateItem,
  CrawlSourceRecord,
  DecisionAnswer,
  DecisionContext,
  DecisionSource,
  PreferenceProfile,
} from '../../../types/agent'
import { draftToCandidateBase } from '../../../types/agent'

const LOG_KEY = 'RecommendScorer'

/** 评分超参：集中定义便于调参（与 T3/T6 同一风格） */
export const SCORER_PARAMS = {
  /** 关键词命中率在基础分中的占比 */
  KEYWORD_RATIO: 0.7,
  /** 来源亲和度在基础分中的占比 */
  AFFINITY_RATIO: 0.3,
  /** 无反馈历史的新源中性值 */
  AFFINITY_NEUTRAL: 0.5,
  /** 发布时间衰减半衰期（天）：age=TAU 时因子 0.5 */
  DECAY_TAU_DAYS: 180,
  /** 衰减下限（老内容保留半分价值，不为 0） */
  DECAY_FLOOR: 0.5,
  /** 决策端 noul 在最终分中的融合权重 */
  DECISION_BLEND: 0.3,
} as const

/** 决策统一入口（DecisionRegistry.judge 同形，单测注 fake） */
export interface DecisionJudgeLike {
  judge(ctx: DecisionContext): Promise<{
    answers: Record<string, DecisionAnswer>
    decisionSrc: DecisionSource
    confidence: number
  } | null>
}

/** 提案写入面（ProposalStore.create 同形） */
export interface ProposalWriterLike {
  create(input: {
    agentKind: 'crawler'
    libraryId: number | null
    payload: unknown
    score: number
    decisionSrc: DecisionSource
    confidence: number
  }): unknown
}

export interface RecommendScorerDeps {
  /** 画像读取（生产接 PreferenceProfiler.getProfile——脏检查/节流/学习量全走它） */
  getProfile: (libraryId: number | null) => PreferenceProfile
  registry: DecisionJudgeLike
  proposals: ProposalWriterLike
  /** 同 sourceUrl 已有 pending 提案 → 不重复提案（accept 前重轮次防刷屏） */
  hasPendingProposal: (sourceUrl: string) => boolean
  /** 时钟注入（测试确定性） */
  now?: () => number
}

export interface DraftScore {
  score: number
  /** 排除词/排除源一票否决 */
  excluded: boolean
  hitRatio: number
  affinity: number
  decay: number
}

export interface ProposeResult {
  proposed: number
  vetoed: number
  skippedNoMedia: number
  skippedDuplicate: number
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** 候选文本（标题/描述/标签/作者）→ 词项集合，口径与画像构建同一 tokenize */
export function draftTextTokens(draft: CandidateDraft): Set<string> {
  const tokens = new Set<string>()
  for (const text of [draft.pageTitle, draft.description, draft.author, ...draft.tags]) {
    if (typeof text === 'string') for (const t of tokenize(text)) tokens.add(t)
  }
  return tokens
}

export class RecommendScorer {
  constructor(private deps: RecommendScorerDeps) {}

  /** 确定性信号打分（不含决策融合）：排除一票否决时 score=0 */
  scoreDraft(draft: CandidateDraft, sourceId: number, profile: PreferenceProfile): DraftScore {
    const tokens = draftTextTokens(draft)
    const excluded =
      profile.exclusions.sourceIds.includes(sourceId) ||
      profile.exclusions.terms.some(t => tokens.has(t))
    if (excluded) return { score: 0, excluded: true, hitRatio: 0, affinity: 0, decay: 1 }

    let matched = 0
    let total = 0
    for (const kw of profile.keywords) {
      total += kw.weight
      if (tokens.has(kw.term)) matched += kw.weight
    }
    const hitRatio = total > 0 ? matched / total : 0
    const affinity = clamp01(profile.sourceAffinity[String(sourceId)] ?? SCORER_PARAMS.AFFINITY_NEUTRAL)

    let decay = 1
    if (draft.publishedAt) {
      const ts = Date.parse(draft.publishedAt)
      if (!Number.isNaN(ts)) {
        const now = this.deps.now?.() ?? Date.now()
        const ageDays = Math.max(0, (now - ts) / 86_400_000)
        decay = Math.max(
          SCORER_PARAMS.DECAY_FLOOR,
          Math.pow(0.5, ageDays / SCORER_PARAMS.DECAY_TAU_DAYS),
        )
      }
    }

    const base = SCORER_PARAMS.KEYWORD_RATIO * hitRatio + SCORER_PARAMS.AFFINITY_RATIO * affinity
    return { score: clamp01(base * decay), excluded: false, hitRatio, affinity, decay }
  }

  /**
   * 一轮提案：调用方须已用轮初快照过滤掉 crawl_items 已见的草稿（url_hash 级防重，
   * 见 CrawlerPipelineSink）；此处再按 pending 提案防重 + 排除词否决 + 决策融合。
   * @returns 分桶计数（proposed = 新写入 proposals 行数）
   */
  async propose(
    source: CrawlSourceRecord,
    drafts: CandidateDraft[],
    libraryId: number | null,
  ): Promise<ProposeResult> {
    const result: ProposeResult = { proposed: 0, vetoed: 0, skippedNoMedia: 0, skippedDuplicate: 0 }
    if (drafts.length === 0) return result
    const profile = this.deps.getProfile(libraryId)

    for (const draft of drafts) {
      if (draft.mediaUrls.length === 0) {
        result.skippedNoMedia++
        continue
      }
      const s = this.scoreDraft(draft, source.id, profile)
      if (s.excluded) {
        result.vetoed++
        continue
      }
      if (this.deps.hasPendingProposal(draft.sourceUrl)) {
        result.skippedDuplicate++
        continue
      }

      // 决策统一入口（D6）：noul 型问题天然规避单选项（S9）；provider 全缺 → 转人工
      let decisionSrc: DecisionSource = 'human'
      let confidence = 0
      let noul: number | null = null
      try {
        const judged = await this.deps.registry.judge(this.buildContext(draft, source))
        if (judged) {
          decisionSrc = judged.decisionSrc
          confidence = judged.confidence
          noul = judged.answers.worth?.noul ?? null
        }
      } catch (err) {
        logger.warn(LOG_KEY, `决策失败（按纯规则分产出）: ${err}`)
      }
      // NaN/Infinity 的 provider noul 不参与融合（clamp01 不挡 NaN，会污染 score 排序），回退纯规则分
      const noulValid = noul !== null && Number.isFinite(noul)
      const score = clamp01(noulValid
        ? (1 - SCORER_PARAMS.DECISION_BLEND) * s.score + SCORER_PARAMS.DECISION_BLEND * (noul as number)
        : s.score)

      const payload: CandidateItem = {
        ...draftToCandidateBase(draft, source.id),
        score,
        decisionSrc,
        confidence,
      }
      try {
        this.deps.proposals.create({ agentKind: 'crawler', libraryId, payload, score, decisionSrc, confidence })
        result.proposed++
      } catch (err) {
        logger.warn(LOG_KEY, `提案写入失败 ${draft.sourceUrl}: ${err}`)
      }
    }
    logger.info(
      LOG_KEY,
      `来源 ${source.id} 提案：新增 ${result.proposed} / 否决 ${result.vetoed}` +
      ` / 重复 ${result.skippedDuplicate} / 无媒体 ${result.skippedNoMedia}`,
    )
    return result
  }

  /** D9 白名单 state：只含文本元数据，无 mediaUrls/绝对路径/URL */
  private buildContext(draft: CandidateDraft, source: CrawlSourceRecord): DecisionContext {
    return {
      state: {
        ...(draft.pageTitle !== undefined ? { title: draft.pageTitle } : {}),
        ...(draft.description !== undefined ? { description: draft.description } : {}),
        ...(draft.author !== undefined ? { author: draft.author } : {}),
        tags: draft.tags,
        sourceName: source.name,
      },
      questions: {
        worth: {
          type: 'noul',
          instructions: '根据用户偏好画像，该采集候选是否值得推荐给用户入库？',
        },
      },
    }
  }
}
