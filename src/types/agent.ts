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

// ─── Jev 决策插件可观测面（T10，IPC 返回给渲染进程） ─────────────

/** Jev 调用计数（内存态，重启归零） */
export interface JevStatsSnapshot {
  calls: number
  successes: number
  /** 因开关/Key/插件未启用或护栏过滤为空被跳过 */
  skipped: number
  /** 因异常（含超时）回落本地规则 */
  failures: number
  /** 隐私护栏累计剔除的出站字段数 */
  filteredFields: number
}

/**
 * Jev 状态快照（T10）：给设置页展示用
 * 硬约束：只含 hasKey 布尔，绝不包含 API Key 明文
 */
export interface JevStatus {
  /** jev.enabled 开关 */
  enabled: boolean
  hasKey: boolean
  /** 插件系统总开关（plugins.enabled），关闭时 Jev 无法装载 */
  pluginsEnabled: boolean
  /** builtin.jev-decision 是否在启用集合中 */
  pluginEnabled: boolean
  /** 插件发现状态；未装载时为 not-discovered */
  pluginState: string
  stats: JevStatsSnapshot
}

/** 开关/Key 变更后返回给渲染进程的结果：状态快照 + 本次入链结果 */
export type JevToggleResult = JevStatus & {
  /** Jev 本次是否成功入升级链 */
  jevRegistered: boolean
  /** 未入链原因（开关关闭属正常态，无此字段） */
  jevError?: string
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

// ─── M3 爬虫接入层契约（T11/T12，D10-D13） ────────────────────

/**
 * 连接器形态（D12）：写入 crawl_sources.config JSON，不做 schema 迁移。
 * 三端共用同一条「调度→执行→去重→入库→提案」流水线，差异只在出流方式。
 */
export type ConnectorType =
  | 'web-http'      // 纯 HTTP（宿主 request-executor 执行）
  | 'web-browser'   // 隐藏浏览器页面上下文（宿主 BrowserProvider 执行）
  | 'pc-app'        // 协议级连接器（如 Telegram MTProto，插件内自跑，D10 例外）
  | 'app-bridge'    // 移动端设备桥：仅类型占位，M3 无实现（禁抓包/禁解签名）

/** 适配器声明的单次请求计划（插件不亲自执行网络请求，D10） */
export interface RequestPlan {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** true → 宿主路由到 BrowserProvider（页面上下文 fetch），否则走 HTTP 执行器 */
  needsBrowser?: boolean
  /** 浏览器取数提示：等待的选择器/全局变量名（如 window.__INITIAL_STATE__） */
  pageHint?: string
  /** 回传给 parseResponse 的不透明上下文（分页游标等，宿主不解读） */
  context?: Record<string, unknown>
}

/** 宿主执行后回传给适配器 parseResponse 的响应（只传文本，媒体字节绝不进 RPC） */
export interface FetchedResponse {
  status: number
  /** 重定向后的最终 URL */
  url: string
  body: string
  headers?: Record<string, string>
}

/** 适配器解析出的候选草稿（T16 RecommendScorer 消费前形态） */
export interface CandidateDraft {
  sourceUrl: string
  pageTitle?: string
  author?: string
  description?: string
  tags: string[]
  /** 待下载的媒体 URL 列表（宿主下载子系统消费） */
  mediaUrls: string[]
  publishedAt?: string
}

/**
 * CandidateDraft → CandidateItem 直转（T12 验收：字段对齐，T16 打分时填
 * score/decisionSrc/confidence，sourceId 由宿主从来源上下文补齐）
 */
export function draftToCandidateBase(
  d: CandidateDraft,
  sourceId: number,
): Pick<CandidateItem, 'sourceId' | 'sourceUrl' | 'pageTitle' | 'author' | 'description' | 'tags'> {
  return {
    sourceId,
    sourceUrl: d.sourceUrl,
    ...(d.pageTitle !== undefined ? { pageTitle: d.pageTitle } : {}),
    ...(d.author !== undefined ? { author: d.author } : {}),
    ...(d.description !== undefined ? { description: d.description } : {}),
    tags: d.tags,
  }
}

/** buildRequests op 的入参（宿主 → 适配器，T12 契约） */
export interface BuildRequestsInput {
  sourceConfig: CrawlSourceConfig
  /** 当前断点游标（首次为 null，同时钟域不透明串） */
  watermark: string | null
}

/** parseResponse op 的入参（宿主 → 适配器）；response.body 只传文本，媒体字节绝不进 RPC */
export interface ParseResponseInput {
  plan: RequestPlan
  response: FetchedResponse
  ctx: {
    sourceId: number
    /** config.params 透传（规则包/关键词等，宿主不解读） */
    params: Record<string, unknown>
  }
}

/** buildRequests op 的返回 */
export interface BuildRequestsResult {
  plans: RequestPlan[]
  /** 本轮完成后的新水位线（不传则保持旧值） */
  nextWatermark?: string
}

/**
 * 信息源 config JSON 约定（D12）：游标进 JSON 不进列。
 * op 名由建源时显式声明（不同适配器 opId 前缀不同，宿主不猜）。
 */
export interface CrawlSourceConfig {
  connectorType: ConnectorType
  /** 站点参数（关键词/uid/规则包…），宿主不解读，透传给 buildRequests */
  params: Record<string, unknown>
  /** 适配器导出的 op 名 */
  ops: {
    buildRequests: string
    parseResponse: string
    /** pc-app 形态专用：插件自跑的发现 op（D10 例外） */
    discover?: string
  }
  /** 断点游标（分页 id / message_id 等，同时钟域不透明串） */
  watermark?: string
}

/** 信息源记录（crawl_sources 表的 TS 形态） */
export interface CrawlSourceRecord {
  id: number
  pluginId: string
  name: string
  config: CrawlSourceConfig
  enabled: boolean
  /** §12.10 健康度：连续反爬信号后退让标记，提醒用户而非默默重试 */
  health: 'ok' | 'degraded'
  successRate: number | null
  lastCrawlAt: string | null
  createdAt: string
}

// ─── M4 UI 交互层契约（T17-T20） ───────────────────────────────

/** 采集 Agent 总览状态（AgentSettings / DiscoverPanel 角标消费） */
export interface AgentStatus {
  /** agent.enabled 定时调度总开关 */
  enabled: boolean
  /** agent.intervalMs 定时间隔（ms） */
  intervalMs: number
  /** crawler.enabled 执行开关（双闸：调度看 enabled，执行看 crawlerEnabled） */
  crawlerEnabled: boolean
  /** 调度器当前是否在定时运行 */
  scheduled: boolean
  /** 待确认提案数（pending 状态计数） */
  pendingProposals: number
}

/** T19 建源入参（config 已在渲染进程组装，主进程再过 parseCrawlSourceConfig 校验） */
export interface CreateCrawlSourceInput {
  pluginId: string
  name: string
  config: CrawlSourceConfig
  enabled?: boolean
}

/** 提案查询（与 ProposalStore.list 入参同形；渲染进程构造） */
export interface ProposalQuery {
  agentKind?: AgentKind
  state?: ProposalState
  /** 1 起始 */
  page?: number
  pageSize?: number
}

/** 提案分页结果（ProposalStore.list 返回） */
export interface ProposalPage {
  items: Proposal[]
  total: number
  page: number
  pageSize: number
}

// ─── M5 · T23 AI 标签建议 / IQA 质量分契约 ───────────────────────

/** 单条标签建议（零样本 softmax 概率 0–1） */
export interface TagSuggestionEntry {
  tagName: string
  confidence: number
}

/** quality 提案 payload（label 作业产出，采纳前不落 image_tags） */
export interface TagSuggestionPayload {
  libraryId: number
  imageId: number
  /** 库内相对路径（与 image_tags.image_path 同形态） */
  imageRelativePath: string
  suggestions: TagSuggestionEntry[]
}

/** listTagSuggestions IPC 视图（提案 + 缩略图定位所需字段） */
export interface TagSuggestionItem {
  proposalId: number
  imageId: number
  imageRelativePath: string
  suggestions: TagSuggestionEntry[]
  /** 最高建议置信度（提案 score 同值） */
  confidence: number
  createdAt: string
}

