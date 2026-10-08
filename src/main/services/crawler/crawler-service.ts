/**
 * T11 — CrawlerService（发现作业主编排，宿主侧）
 * 注册 JobRunner handler（kind = AGENT_DISCOVERY_KIND，job_items.imageId 约定 = sourceId，
 * 见 agent-scheduler.ts triggerNow）。每个来源的流程：
 *   读 config → executeOp(adapter.buildRequests) → 宿主执行 plans（HTTP/浏览器路由，D10）
 *   → executeOp(adapter.parseResponse) → 候选交下游（T15 去重入库 → T16 打分提案）
 * pc-app 形态例外（D10）：不调 request-executor，直接 executeOp(adapter.discover) 插件自跑。
 *
 * 本文件不 import electron：网络/浏览器能力全部经接口注入，单测零真实网络零窗口。
 * §12.10：任一计划触发反爬信号 → 本轮即止（不硬闯），source 标 degraded。
 */
import type { JobRunner } from '../job-runner'
import type { JobItem } from '../../../types'
import type {
  CrawlSourceRecord,
  RequestPlan,
  FetchedResponse,
  CandidateDraft,
  BuildRequestsResult,
} from '../../../types/agent'
import { AGENT_DISCOVERY_KIND } from '../agent/agent-scheduler'
import { logger } from '../../../utils/logger'
import type { CrawlSourceStore } from './source-store'
import type { RequestExecutor } from './request-executor'
import type { BrowserProvider } from './browser-session'

const LOG_KEY = 'CrawlerService'

/** 插件 RPC 解耦面（PluginManager.executeOp 同形，便于单测） */
export type CrawlerExecuteOp = (pluginId: string, opId: string, input: unknown) => Promise<unknown>

/** 候选下游（T15 intake 实现；未接线时候选只计数不落库，防半截流水线被误用） */
export interface CandidateSink {
  ingest(source: CrawlSourceRecord, drafts: CandidateDraft[]): Promise<number>
}

export interface CrawlerServiceDeps {
  sourceStore: CrawlSourceStore
  executeOp: CrawlerExecuteOp
  executor: RequestExecutor
  /** web-browser 形态必需；缺失时含 needsBrowser 计划的来源直接失败（不降级裸 fetch） */
  browser?: BrowserProvider | null
  sink?: CandidateSink | null
  /** §12.10 退让留档：反爬识别时写一条 crawl_items.error（diagnostic，由宿主注入 items 实现） */
  recordError?: (sourceId: number, sourceUrl: string, detail: string) => void
  /** pc-app 连接器媒体落盘目录（如 {库根}/_downloads）：插件未自指时由宿主注入，避免误落盘根 */
  getPcAppDownloadDir?: () => string | null
}

/** 单来源一轮发现的结果统计（handler 返回值进 job payload 便于排障） */
export interface SourceRoundResult {
  sourceId: number
  plans: number
  executed: number
  /** 反截断口径：本轮成功解析出的候选数（未去重前） */
  candidates: number
  ingested: number
  watermarkAdvanced: boolean
  degraded: boolean
  errors: string[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** buildRequests 返回的防御式规整（RPC 对端是插件，宁严勿宽） */
function normalizeBuildResult(raw: unknown): BuildRequestsResult {
  if (!isRecord(raw) || !Array.isArray(raw.plans)) {
    throw new Error('adapter.buildRequests 返回形状非法（需 {plans:[...]}）')
  }
  const plans: RequestPlan[] = []
  for (const p of raw.plans) {
    if (!isRecord(p) || typeof p.url !== 'string' || !p.url) continue
    plans.push({
      url: p.url,
      method: p.method === 'POST' ? 'POST' : 'GET',
      ...(isRecord(p.headers) ? { headers: p.headers as Record<string, string> } : {}),
      ...(p.needsBrowser === true ? { needsBrowser: true } : {}),
      ...(typeof p.pageHint === 'string' ? { pageHint: p.pageHint } : {}),
      ...(isRecord(p.context) ? { context: p.context as Record<string, unknown> } : {}),
    })
  }
  return {
    plans,
    ...(typeof raw.nextWatermark === 'string' ? { nextWatermark: raw.nextWatermark } : {}),
  }
}

function normalizeDrafts(raw: unknown, plan: RequestPlan): CandidateDraft[] {
  if (!Array.isArray(raw)) return []
  const drafts: CandidateDraft[] = []
  for (const d of raw) {
    if (!isRecord(d) || typeof d.sourceUrl !== 'string' || !d.sourceUrl) continue
    drafts.push({
      sourceUrl: d.sourceUrl,
      ...(typeof d.pageTitle === 'string' ? { pageTitle: d.pageTitle } : {}),
      ...(typeof d.author === 'string' ? { author: d.author } : {}),
      ...(typeof d.description === 'string' ? { description: d.description } : {}),
      tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : [],
      mediaUrls: Array.isArray(d.mediaUrls)
        ? d.mediaUrls.filter((m): m is string => typeof m === 'string' && m.length > 0)
        : [],
      ...(typeof d.publishedAt === 'string' ? { publishedAt: d.publishedAt } : {}),
    })
  }
  if (drafts.length === 0 && Array.isArray(raw) && raw.length > 0) {
    logger.warn(LOG_KEY, `parseResponse 返回 ${raw.length} 项但全部非法（缺 sourceUrl），plan=${plan.url}`)
  }
  return drafts
}

export class CrawlerService {
  constructor(private deps: CrawlerServiceDeps) {}

  /** 挂进 JobRunner（ensureCrawlerLayer 调用；重复注册覆盖安全） */
  register(runner: JobRunner): void {
    runner.registerHandler(AGENT_DISCOVERY_KIND, async (item: JobItem) => {
      const sourceId = item.imageId
      if (sourceId == null) throw new Error('发现作业 item.imageId 缺失（约定=sourceId）')
      const result = await this.runSource(sourceId)
      logger.info(
        LOG_KEY,
        `来源轮次完成 source=${result.sourceId} plans=${result.plans} 候选=${result.candidates} 入库=${result.ingested}` +
        `${result.degraded ? ' [已退让]' : ''}`,
      )
      if (result.degraded) throw new Error(`§12.10 反爬退让: ${result.errors[0] ?? '见 crawl_sources.health'}`)
    })
  }

  /**
   * 执行一个来源的一轮发现。
   * 抛错仅限结构性错误（来源不存在/op 形状非法）；网络与反爬以 degraded 返回。
   */
  async runSource(sourceId: number, signal?: AbortSignal): Promise<SourceRoundResult> {
    const source = this.deps.sourceStore.get(sourceId)
    if (!source) throw new Error(`信息源不存在: ${sourceId}`)
    if (!source.enabled) {
      return { sourceId, plans: 0, executed: 0, candidates: 0, ingested: 0, watermarkAdvanced: false, degraded: false, errors: ['来源已停用，跳过'] }
    }

    return source.config.connectorType === 'pc-app'
      ? this.runPcApp(source, signal)
      : this.runHostPipeline(source, signal)
  }

  // ── web-http / web-browser：声明式计划 + 宿主集中出流（D10 主路径） ──

  private async runHostPipeline(source: CrawlSourceRecord, signal?: AbortSignal): Promise<SourceRoundResult> {
    const { id, pluginId, config } = source
    const built = normalizeBuildResult(await this.deps.executeOp(pluginId, config.ops.buildRequests, {
      sourceConfig: config,
      watermark: config.watermark ?? null,
    }))

    const errors: string[] = []
    let executed = 0
    let okCount = 0
    const drafts: CandidateDraft[] = []
    let degraded = false

    for (const plan of built.plans) {
      if (signal?.aborted) {
        errors.push('作业中止，剩余计划未执行')
        break
      }
      const response = await this.dispatch(plan, degraded ? 'degraded' : undefined)
      if ('error' in response) {
        executed++
        errors.push(`${plan.url}: ${response.error}`)
        if (response.antiBot) {
          degraded = true
          await this.markDegraded(id, response.antiBot.detail, plan.url)
          break // 识别即停：本轮不再硬闯
        }
        continue
      }
      executed++
      if (response.status >= 400) {
        errors.push(`${plan.url}: HTTP ${response.status}`)
        // 未被 classify 判为反爬的 4xx/5xx（如持续 500）也喂零抽取，使其能经 empty-streak 升级退让
        if (this.deps.executor.noteExtraction(plan.url, 0)) degraded = true
        continue
      }
      okCount++
      const parsed = normalizeDrafts(
        await this.deps.executeOp(pluginId, config.ops.parseResponse, {
          plan,
          response: { status: response.status, url: response.url, body: response.body },
          ctx: { sourceId: id, params: config.params },
        }),
        plan,
      )
      drafts.push(...parsed)
      // 零抽取反馈进执行器状态机（连续 N 页 → host 级退让）
      if (this.deps.executor.noteExtraction(plan.url, parsed.length)) degraded = true
    }

    return this.finishRound(source, built, { executed, okCount, drafts, errors, degraded, total: built.plans.length })
  }

  /** 计划路由：needsBrowser → 浏览器层；否则 HTTP 出口 */
  private async dispatch(plan: RequestPlan, skipReason?: string): Promise<
    | ({ status: number; url: string; body: string } & { antiBot?: undefined })
    | ({ error: string } & { antiBot?: { kind: string; detail: string } })
  > {
    if (skipReason) {
      return { error: `主机已退让（${skipReason}），本计划跳过` }
    }
    if (plan.needsBrowser) {
      if (!this.deps.browser) {
        return { error: '需要浏览器层但宿主未装配（crawler.enabled 关闭或窗口不可用）' }
      }
      try {
        const res = await this.deps.browser.runPlan(plan)
        return { status: res.status, url: res.url, body: res.body }
      } catch (err) {
        return { error: `浏览器层执行失败: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    const outcome = await this.deps.executor.executePlan(plan)
    if (outcome.ok) {
      return { status: outcome.response.status, url: outcome.response.url, body: outcome.response.body }
    }
    return {
      error: outcome.antiBot?.detail ?? outcome.blocked ?? outcome.error ?? '未知失败',
      ...(outcome.antiBot ? { antiBot: outcome.antiBot } : {}),
    }
  }

  // ── pc-app：协议级连接器例外（D10），插件内自跑（如 Telegram MTProto） ──

  private async runPcApp(source: CrawlSourceRecord, _signal?: AbortSignal): Promise<SourceRoundResult> {
    const { id, pluginId, config } = source
    if (!config.ops.discover) {
      throw new Error(`pc-app 来源 ${id} 未声明 ops.discover（D10 例外要求显式声明）`)
    }
    // 宿主注入媒体落盘目录（插件自配的 downloadDir 优先）：否则 tg 系缺省会落到盘根
    const hostDir = this.deps.getPcAppDownloadDir?.() ?? null
    const sourceConfig =
      hostDir && typeof config.params?.downloadDir !== 'string'
        ? { ...config, params: { ...config.params, downloadDir: hostDir } }
        : config
    const raw = await this.deps.executeOp(pluginId, config.ops.discover, {
      sourceConfig,
      watermark: config.watermark ?? null,
    })
    const drafts = normalizeDrafts(isRecord(raw) ? raw.drafts : raw, { url: `pc-app://${pluginId}` })
    const nextWatermark = isRecord(raw) && typeof raw.nextWatermark === 'string'
      ? raw.nextWatermark
      : undefined
    return this.finishRound(
      source,
      { plans: [], ...(nextWatermark !== undefined ? { nextWatermark } : {}) },
      { executed: 1, okCount: 1, drafts, errors: [], degraded: false, total: 1 },
    )
  }

  // ── 共同收尾 ──

  private async finishRound(
    source: CrawlSourceRecord,
    built: BuildRequestsResult,
    round: {
      executed: number; okCount: number; drafts: CandidateDraft[]
      errors: string[]; degraded: boolean; total: number
    },
  ): Promise<SourceRoundResult> {
    let ingested = 0
    if (round.drafts.length > 0 && this.deps.sink) {
      ingested = await this.deps.sink.ingest(source, round.drafts)
    } else if (round.drafts.length > 0) {
      logger.warn(LOG_KEY, `候选 ${round.drafts.length} 条但 sink 未接线（T15），本批丢弃`)
    }

    // 水位只在"无页级错误且未退让"时推进：失败轮绝不跳内容（宁重跑勿漏抓，
    // 重复由 T15 url_hash 幂等消化）——部分页失败也须守住，否则永久跳页
    const clean = round.errors.length === 0
    const canAdvance = !round.degraded && clean && round.okCount > 0 && built.nextWatermark !== undefined
    // 成功率样本仅在有计划可跑时采集（total=0 的空轮=水位耗尽，不算失败，不拉低健康度）
    const sample = round.total > 0 ? round.okCount / round.total : undefined
    if (canAdvance || (built.nextWatermark === undefined && !round.degraded)) {
      this.deps.sourceStore.commitRound(source.id, canAdvance ? built.nextWatermark : undefined, sample)
    }
    // 恢复：degraded 来源被显式重跑（triggerNow 绕过 planner）且本轮干净无退让 → 擦回 ok
    if (source.health === 'degraded' && !round.degraded && clean && round.total > 0) {
      this.deps.sourceStore.setHealth(source.id, 'ok')
    }

    return {
      sourceId: source.id,
      plans: round.total,
      executed: round.executed,
      candidates: round.drafts.length,
      ingested,
      watermarkAdvanced: canAdvance,
      degraded: round.degraded,
      errors: round.errors,
    }
  }

  private async markDegraded(sourceId: number, detail: string, sourceUrl?: string): Promise<void> {
    try {
      this.deps.sourceStore.setHealth(sourceId, 'degraded')
    } catch (err) {
      logger.warn(LOG_KEY, `degraded 标记失败 source=${sourceId}: ${err}`)
    }
    // §12.10「识别即停 → 写 crawl_items.error」：留一条诊断行供 UI 按条展示
    if (sourceUrl) {
      try {
        this.deps.recordError?.(sourceId, sourceUrl, detail)
      } catch (err) {
        logger.warn(LOG_KEY, `crawl_items.error 留档失败 source=${sourceId}: ${err}`)
      }
    }
    logger.warn(LOG_KEY, `来源 ${sourceId} 反爬退让（§12.10 只停不让）: ${detail}`)
  }
}

// ── JobRunner 消费 JobItem 形状对齐（防 job-runner 侧类型漂移） ──
export type { FetchedResponse }

// ── T16 — 流水线下游：去重入库 → 打分提案 ──

/** 提案段（RecommendScorer.propose 同形，agent-handlers 生产注入） */
export interface ProposalStage {
  propose: (
    source: CrawlSourceRecord,
    drafts: CandidateDraft[],
    libraryId: number | null,
  ) => Promise<unknown>
}

/**
 * CrawlerPipelineSink：CandidateSink 的生产终态。
 * 关键时序：url_hash 已见判定必须在 intake 写入 crawl_items **之前**取轮初快照，
 * 否则本轮新入库的候选会被自己判成重复（零提案）。提案段失败不影响入库结果（只记日志）。
 */
export class CrawlerPipelineSink implements CandidateSink {
  constructor(private deps: {
    intake: { process(source: CrawlSourceRecord, drafts: CandidateDraft[]): Promise<{ ingested: number }> }
    /** 轮初判定：任一媒体 URL 未见于 crawl_items 即算"新面孔" */
    urlSeen: (url: string) => boolean
    stage: ProposalStage
    getLibraryId: (source: CrawlSourceRecord) => number | null
  }) {}

  async ingest(source: CrawlSourceRecord, drafts: CandidateDraft[]): Promise<number> {
    const fresh = drafts.filter(
      d => d.mediaUrls.length === 0 || d.mediaUrls.some(u => !this.deps.urlSeen(u)),
    )
    const res = await this.deps.intake.process(source, drafts)
    if (fresh.length > 0) {
      try {
        await this.deps.stage.propose(source, fresh, this.deps.getLibraryId(source))
      } catch (err) {
        logger.warn(LOG_KEY, `提案段失败（入库结果不受影响）source=${source.id}: ${err}`)
      }
    }
    return res.ingested
  }
}
