/**
 * Phase 9 — Agent 体系核心类型
 * 对应计划 docs/plans/implementation-plan-phase9-agent.md T2
 * 决策层抽象见 D6，人在回路见 D8，Jev 隐私边界见 D9
 */

/** 带权关键词：权重由 FeedbackAggregator 根据用户反馈动态调整 */
export interface WeightedKeyword {
  term: string
  weight: number
}

/** 用户偏好画像：从 favorites/ratings/tags/history 冷启动构建，无需用户额外输入 */
export interface PreferenceProfile {
  /** 关联图库 ID，null 表示全局画像 */
  libraryId: number | null
  keywords: WeightedKeyword[]
  /**
   * 反馈学习量净累计（T6 写入）：与行为数据统计基权重叠加而非覆盖，
   * 重建时保留（weight = base + learned 再钳位），已晋级排除项的词项同步清除；
   * 可选：存量画像/测试构造无此字段时按空对象处理
   */
  learnedDeltas?: Record<string, number>
  /** 视觉特征（M5 后由 embedding 质心填充） */
  visualTraits?: number[]
  /** 来源亲和度：{ sourceId: trustScore }，随采集反馈（T6）填充 */
  sourceAffinity: Record<string, number>
  exclusions: { terms: string[]; sourceIds: number[] }
  updatedAt: string
  /**
   * 行为数据水位线（S14）：重建时已消费到的最后活动时间（归一化 SQL 时间戳）。
   * 脏检查用 lastActivity > watermark 同时钟域比较，避免 JS 毫秒钟与 SQLite 秒级钟混比失真
   */
  sourceWatermark?: string | null
}

/**
 * Agent 种类（D7）：
 * Phase 9 仅落地 'crawler'，其余为协议占位，后续 Phase 复用基座逐个填充
 */
export type AgentKind =
  | 'crawler'      // 采集（Phase 9 落地）
  | 'organize'     // 整理
  | 'quality'      // 质量
  | 'discover'     // 发现
  | 'complete'     // 补全
  | 'cleanup'      // 清理
  | 'create'       // 创作

/** 提案状态机：pending → {accepted | skipped | rejected}，终态不可逆（D8） */
export type ProposalState = 'pending' | 'accepted' | 'skipped' | 'rejected'

/** 决策来源：本地规则 / Jev 云端 / 人工 */
export type DecisionSource = 'local' | 'jev' | 'human'

/** Agent 提案（人在回路的核心协议）：Agent 只产 Proposal，用户 accept 才触发下游动作 */
export interface Proposal<T = unknown> {
  id: number
  agentKind: AgentKind
  libraryId: number | null
  /** 提案内容，采集 Agent 为 CandidateItem */
  payload: T
  /** 匹配度评分 0-1 */
  score: number
  decisionSrc: DecisionSource
  /** 决策置信度 0-1 */
  confidence: number
  state: ProposalState
  createdAt: string
  resolvedAt?: string | null
}

/** 用户反馈动作类型 */
export type FeedbackAction = 'accept' | 'skip' | 'reject'

// ─── 决策层抽象（D6） ────────────────────────────────────────────

/**
 * 决策问题（对齐 Jev 的三类回答形态）：
 * - choice：从 criteria 中选一个（value 为 null 表示无附加描述）
 * - score：对 criteria 各项给出有序分数
 * - noul：是否概率（0-1）
 */
export type DecisionQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string }

/** 单题决策答案 */
export interface DecisionAnswer {
  choice?: string
  score?: number
  noul?: number
  probabilities?: Record<string, number>
  /** 置信度 0-1，由答案分布尖锐度导出 */
  confidence: number
}

/**
 * 决策上下文
 * state 仅允许文本元数据白名单字段（标签、文件名 stem、候选项文本描述、结构化选项），
 * 绝不包含原图字节、图片绝对路径内容、embedding 向量（D9）
 */
export interface DecisionContext {
  state: Record<string, unknown>
  questions: Record<string, DecisionQuestion>
}

/** 决策提供者接口：本地规则实现与 Jev 插件实现共用，供主循环无差别调用 */
export interface DecisionProvider {
  /** 'local-rules' | 'jev' */
  readonly id: string
  /** 是否远端服务（Jev 为 true，受隐私护栏与开关约束） */
  readonly isRemote: boolean
  isAvailable(): Promise<boolean>
  judge(ctx: DecisionContext): Promise<Record<string, DecisionAnswer>>
}

// ─── 采集 Agent 候选项（T16 RecommendScorer 消费） ───────────────

/** 爬虫适配器返回的候选条目（入库前的元数据形态） */
export interface CandidateItem {
  sourceId: number
  sourceUrl: string
  pageTitle?: string
  author?: string
  /** 候选项文本描述（属 D9 白名单，可发往 Jev） */
  description?: string
  tags: string[]
  /** 匹配度评分（RecommendScorer 计算） */
  score: number
  decisionSrc: DecisionSource
  confidence: number
}

/**
 * sidecar 溯源契约占位（T1 验收项 4，M3 下载落地时实现）：
 * 未来 crawl_items 详细字段存 sidecar JSON，下载产物写同名 .luuk-provenance.json
 */
export interface CrawlProvenance {
  /** 产生本条目的作业/提案 id（可追溯链路） */
  jobId?: string
  proposalId?: string
  /** 抓取时间 */
  crawledAt: string
  /** 来源标识（不存完整 URL 以外的敏感信息） */
  sourceId?: number
}
