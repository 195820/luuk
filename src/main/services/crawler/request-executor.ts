/**
 * T11 — RequestExecutor（宿主统一 HTTP 出口，D10）
 * crawler-adapter 插件不发网络：只交 RequestPlan，由本执行器集中出流。
 * 治理点：per-host 并发闸 + 随机延时 + 反爬识别即停（§12.10 只识别与退让、不绕过）
 *        + robots.txt（可配置）+ 明确 UA（§12.9）。
 * 纯依赖注入（fetchImpl/sleepImpl/random），单测零真实网络。
 */
import type { RequestPlan, FetchedResponse } from '../../../types/agent'
import { logger } from '../../../utils/logger'
import { parseRobotsTxt, isAllowedByRobots } from './robots'

const LOG_KEY = 'CrawlExecutor'

/** §12.9 UA 明确标识 */
export const CRAWLER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Luuk/0.9 (personal local archive)'

/** 触发反爬退让判定的 HTTP 状态（§12.10；bili 风控常回 412 Precondition Failed） */
const ANTIBOT_STATUSES = new Set([403, 412, 429, 461, 503])
/** 风控常以 HTTP 200 + JSON body 负 code 回体（bili -352 风控/-412 签名缺失） */
const ANTIBOT_JSON_CODES = new Set([-352, -412])
/** 重定向到这些地址视为验证页 */
const CHALLENGE_URL_PATTERN = /(captcha|verify|verification|challenge|__cf|do-?check)/i
/** 响应体含这些特征视为 challenge 页 */
const CHALLENGE_BODY_PATTERN = /just a moment|checking your browser|verify you are human|请完成下方验证|滑动验证/i

/** 连续 N 个响应零抽取 → 反爬退让（阈值由调用方 noteExtraction 消费） */
export const EMPTY_STREAK_THRESHOLD = 3

/**
 * HTTP 200 但 JSON 风控体的识别：content-type 为 json 且顶层 code 命中风控码→返回该 code，否则 null。
 * 解析失败/非对象体一律当作 null（宁可不退让也不误杀正常响应）。
 */
function matchAntiBotJsonCode(response: FetchedResponse): number | null {
  const ct = response.headers?.['content-type'] ?? ''
  if (!ct.includes('json')) return null
  try {
    const parsed = JSON.parse(response.body) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const code = (parsed as Record<string, unknown>).code
      if (typeof code === 'number' && ANTIBOT_JSON_CODES.has(code)) return code
    }
  } catch {
    /* 非纯 JSON（SSR 混排等）忽略 */
  }
  return null
}

export interface ExecutorLimits {
  perHost: number
  global: number
  delayMinMs: number
  delayMaxMs: number
  /** 429 退避后重试一次的等待基数 */
  backoffMs: number
}

const DEFAULT_LIMITS: ExecutorLimits = {
  perHost: 2,
  global: 4,
  delayMinMs: 4000,
  delayMaxMs: 8000,
  backoffMs: 10_000,
}

/** 极简 fetch 抽象：与 globalThis.fetch 兼容的最小面 */
export interface ExecutorFetchResponse {
  status: number
  url: string
  headers: { get(name: string): string | null }
  text(): Promise<string>
}
export type ExecutorFetch = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}) => Promise<ExecutorFetchResponse>

export interface RequestExecutorDeps {
  fetchImpl: ExecutorFetch
  sleepImpl?: (ms: number) => Promise<void>
  random?: () => number
  limits?: Partial<ExecutorLimits>
  userAgent?: string
  /** 按 URL 取 Cookie 串（persist 分区会话由宿主注入；返回空串表示匿名） */
  getCookies?: (url: string) => Promise<string>
  /** robots.txt 尊重开关（§12.9 可配置，默认开） */
  respectRobots?: boolean
  /** robots.txt 抓取超时 */
  robotsTimeoutMs?: number
}

export interface AntiBotSignal {
  kind: 'http-status' | 'redirect-challenge' | 'challenge-body' | 'json-risk-code' | 'empty-streak' | 'degraded-host'
  detail: string
}

export type PlanOutcome =
  | { plan: RequestPlan; ok: true; response: FetchedResponse }
  | { plan: RequestPlan; ok: false; antiBot?: AntiBotSignal; error?: string; blocked?: string }

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * per-host 串行队列 + 全局并发上限的简易闸门。
 * 不追求公平调度，只保证：同主机并发 ≤ perHost、两次同主机请求间隔 ≥ 随机延时。
 */
class HostGate {
  private active = new Map<string, number>()
  /** host → 上一次请求完成时间（延时从 sleep 实现，这里只记录排期） */
  private tail = new Map<string, Promise<void>>()
  private globalActive = 0

  constructor(private limits: ExecutorLimits, private sleep: (ms: number) => Promise<void>, private random: () => number) {}

  async acquire(host: string): Promise<void> {
    // 全局闸：满了就等任一释放（轮询粒度交给 sleep 注入）
    while (this.globalActive >= this.limits.global) {
      await this.sleep(this.limits.delayMinMs / 4)
    }
    // per-host 排队尾：同主机请求串行化 + 随机延时
    const prev = this.tail.get(host) ?? Promise.resolve()
    let releaseQueue: () => void
    const next = new Promise<void>(r => { releaseQueue = r })
    this.tail.set(host, prev.then(() => next))
    const waitTurn = prev.then(() => {})
    await waitTurn
    if (this.active.get(host) === undefined) this.active.set(host, 0)
    this.active.set(host, (this.active.get(host) ?? 0) + 1)
    this.globalActive++
    this.hostWaiters.set(host, (this.hostWaiters.get(host) ?? 0) + 1)
    // 首个进入该 host 的排队者无需延时；后来者付随机延时
    const delay = this.random() * (this.limits.delayMaxMs - this.limits.delayMinMs) + this.limits.delayMinMs
    if ((this.active.get(host) ?? 0) > 0 || this.visited.has(host)) {
      await this.sleep(this.visited.has(host) ? delay : 0)
    }
    this.visited.add(host)
    // 释放排队锁，让下一个同 host 请求进入
    releaseQueue!()
  }

  release(host: string): void {
    this.active.set(host, Math.max(0, (this.active.get(host) ?? 1) - 1))
    this.globalActive = Math.max(0, this.globalActive - 1)
  }

  private hostWaiters = new Map<string, number>()
  private visited = new Set<string>()
}

export class RequestExecutor {
  private limits: ExecutorLimits
  private gate: HostGate
  /** host → degraded（§12.10 识别即停：暂停该主机作业，退避后最多重试一轮） */
  private degradedHosts = new Map<string, string>()
  /** host → 连续零抽取计数 */
  private emptyStreak = new Map<string, number>()
  /** robots.txt 缓存：host → {allowed: string[]} | 'unreachable' */
  private robotsCache = new Map<string, Promise<string[] | 'unreachable'>>()
  private retriedHosts = new Set<string>()

  constructor(private deps: RequestExecutorDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits }
    this.gate = new HostGate(
      this.limits,
      deps.sleepImpl ?? defaultSleep,
      deps.random ?? Math.random,
    )
  }

  /** 识别即停：标记某主机退让 */
  degradeHost(host: string, reason: string): void {
    if (!this.degradedHosts.has(host)) {
      logger.warn(LOG_KEY, `主机退让（§12.10）: ${host} — ${reason}`)
    }
    this.degradedHosts.set(host, reason)
  }

  isDegraded(host: string): string | null {
    return this.degradedHosts.get(host) ?? null
  }

  /** 用户介入（如更新插件/登录）后可人工复位 */
  resetHost(host: string): void {
    this.degradedHosts.delete(host)
    this.emptyStreak.delete(host)
    this.retriedHosts.delete(host)
  }

  /**
   * 适配器抽取结果反馈：连续 EMPTY_STREAK_THRESHOLD 页零抽取 → 判定反爬退让
   * @returns 是否触发退让
   */
  noteExtraction(url: string, extractedCount: number): boolean {
    const host = hostOf(url)
    if (extractedCount > 0) {
      this.emptyStreak.delete(host)
      return false
    }
    const streak = (this.emptyStreak.get(host) ?? 0) + 1
    this.emptyStreak.set(host, streak)
    if (streak >= EMPTY_STREAK_THRESHOLD) {
      this.degradeHost(host, `连续 ${streak} 页零抽取结果`)
      return true
    }
    return false
  }

  /** 顺序编排、闸门内并发执行一批计划（保序返回） */
  async executePlans(plans: RequestPlan[], signal?: AbortSignal): Promise<PlanOutcome[]> {
    const results = new Array<PlanOutcome>(plans.length)
    await Promise.all(plans.map(async (plan, i) => {
      results[i] = await this.executePlan(plan, signal)
    }))
    return results
  }

  async executePlan(plan: RequestPlan, signal?: AbortSignal): Promise<PlanOutcome> {
    const host = hostOf(plan.url)

    // 浏览器形态计划不走 HTTP（由宿主 BrowserProvider 执行，见 crawler-service 路由）
    if (plan.needsBrowser) {
      return { plan, ok: false, blocked: 'needsBrowser 计划应由宿主浏览器层执行，不经 HTTP 出口' }
    }

    const degraded = this.isDegraded(host)
    if (degraded) {
      return { plan, ok: false, antiBot: { kind: 'degraded-host', detail: `${host} 已退让：${degraded}` } }
    }

    if (this.deps.respectRobots !== false) {
      const disallow = await this.checkRobots(plan.url)
      if (disallow) {
        return { plan, ok: false, blocked: `robots.txt 禁止抓取 ${new URL(plan.url).pathname}` }
      }
    }

    await this.gate.acquire(host)
    try {
      let outcome = await this.attempt(plan, signal)
      // §12.10：退避后最多重试一轮（仅 429 限流一次；403/503 不重试）
      if (outcome.ok === false && outcome.antiBot?.kind === 'http-status'
        && outcome.antiBot.detail.includes('429') && !this.retriedHosts.has(host)) {
        this.retriedHosts.add(host)
        await (this.deps.sleepImpl ?? defaultSleep)(this.limits.backoffMs)
        outcome = await this.attempt(plan, signal)
      }
      if (outcome.ok === false && outcome.antiBot) {
        this.degradeHost(host, outcome.antiBot.detail)
      }
      return outcome
    } finally {
      this.gate.release(host)
    }
  }

  private async attempt(plan: RequestPlan, signal?: AbortSignal): Promise<PlanOutcome> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': this.deps.userAgent ?? CRAWLER_UA,
        Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
        ...plan.headers,
      }
      if (!headers.Cookie && this.deps.getCookies) {
        const cookie = await this.deps.getCookies(plan.url)
        if (cookie) headers.Cookie = cookie
      }
      const res = await this.deps.fetchImpl(plan.url, { method: plan.method ?? 'GET', headers, signal })
      const body = await res.text()
      const response: FetchedResponse = {
        status: res.status,
        url: res.url || plan.url,
        body,
        headers: { 'content-type': res.headers.get('content-type') ?? '' },
      }
      return this.classify(plan, response)
    } catch (err) {
      if (signal?.aborted) return { plan, ok: false, error: '作业中止' }
      return { plan, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 反爬信号分类（识别即停，绝不对抗） */
  private classify(plan: RequestPlan, response: FetchedResponse): PlanOutcome {
    if (ANTIBOT_STATUSES.has(response.status)) {
      return {
        plan, ok: false,
        antiBot: { kind: 'http-status', detail: `HTTP ${response.status}（目标站点拒绝/限流）` },
      }
    }
    if (response.url !== plan.url && CHALLENGE_URL_PATTERN.test(response.url)) {
      return { plan, ok: false, antiBot: { kind: 'redirect-challenge', detail: `重定向到验证页 ${response.url}` } }
    }
    if (response.status < 400 && CHALLENGE_BODY_PATTERN.test(response.body.slice(0, 4000))) {
      return { plan, ok: false, antiBot: { kind: 'challenge-body', detail: '响应体含 challenge 特征' } }
    }
    // HTTP 200 但 JSON 风控体（code 为负风控码）：识别为反爬，不硬闯
    const antiBotCode = matchAntiBotJsonCode(response)
    if (antiBotCode !== null) {
      return { plan, ok: false, antiBot: { kind: 'json-risk-code', detail: `JSON 风控码 code=${antiBotCode}` } }
    }
    return { plan, ok: true, response }
  }

  private checkRobots(url: string): Promise<string | null> {
    const target = new URL(url)
    const host = target.host
    const cached = this.robotsCache.get(host) ?? this.fetchRobots(host, target.protocol)
    this.robotsCache.set(host, cached)
    return cached.then(entries =>
      entries === 'unreachable' ? null : (isAllowedByRobots(entries, target.pathname) ? null : target.pathname),
    )
  }

  private async fetchRobots(host: string, protocol: string): Promise<string[] | 'unreachable'> {
    try {
      const res = await this.deps.fetchImpl(`${protocol}//${host}/robots.txt`, {
        method: 'GET',
        headers: { 'User-Agent': this.deps.userAgent ?? CRAWLER_UA },
      })
      if (res.status >= 400) return 'unreachable' // 无 robots 文件或不可达：按允许处理（fail-open，常见爬虫惯例）
      return parseRobotsTxt(await res.text())
    } catch {
      return 'unreachable'
    }
  }
}
