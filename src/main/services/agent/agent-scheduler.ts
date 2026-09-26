/**
 * T7 — AgentScheduler（调度循环）
 * 不新造调度器：Agent 的发现循环经 JobRunner（Phase 8 交付）入队为 job，
 * 天然获得批处理/取消/续跑能力（重启续跑不丢进度）。
 * 触发时机：定时（可配置间隔）+ 手动（UI 触发）+ 新信息源加入。
 * 尊重 feature flag agent.enabled：关闭时完全不调度。
 */
import { logger } from '../../../utils/logger'
import type { JobRunner } from '../job-runner'

const LOG_KEY = 'AgentScheduler'

/** 采集 Agent 发现循环的 job kind */
export const AGENT_DISCOVERY_KIND = 'agent.crawler-discovery'

/** 默认定时间隔（settings 不可用时的兜底）：6 小时 */
export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000

/** 定时间隔下限（S10）：防 settings 被手改成 0/负数后 setInterval 按 1ms 连发调度 */
export const MIN_INTERVAL_MS = 60 * 1000

/** 单次发现作业的目标库与其待爬取信息源 */
export interface DiscoveryPlan {
  libraryId: number
  sourceIds: number[]
}

/**
 * 发现计划提供器：由采集 Agent（T16/M3）注册，
 * 调度器不感知 crawl_sources 细节，只负责"何时触发、以什么形态入队"
 */
export type AgentPlanner = () => DiscoveryPlan[] | Promise<DiscoveryPlan[]>

export interface AgentSchedulerDeps {
  getRunner: () => JobRunner
  /** feature flag agent.enabled 读取（注入以便测试与 T20 设置页联动） */
  isEnabled: () => boolean
  getIntervalMs?: () => number
}

export class AgentScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private unsubscribeProgress: (() => void) | null = null
  private planner: AgentPlanner | null = null
  /** 在途作业：jobId → 未完成的 sourceId 集合，同来源并发去重 */
  private activeJobs = new Map<string, Set<number>>()

  constructor(private deps: AgentSchedulerDeps) {
    this.ensureSubscription()
  }

  /**
   * 进度订阅与定时开关解耦（W4）：手动触发/新来源入队的作业也要靠终态事件出账；
   * 幂等，start() 时重建（stop 后重新调度前保证订阅在位）
   */
  private ensureSubscription(): void {
    if (this.unsubscribeProgress) return
    this.unsubscribeProgress = this.deps.getRunner().subscribeProgress(p => {
      // 终态作业出账；paused/running 保留以阻止同来源重复入队
      if (p.state === 'done' || p.state === 'failed' || p.state === 'cancelled') {
        this.activeJobs.delete(p.jobId)
      }
    })
  }

  /** 注册发现计划提供器（采集 Agent 启动时调用） */
  registerPlanner(planner: AgentPlanner): void {
    this.planner = planner
  }

  /** 启动定时调度；重复调用无效果 */
  start(): void {
    if (this.timer) return
    this.ensureSubscription()
    const intervalMs = Math.max(MIN_INTERVAL_MS, this.deps.getIntervalMs?.() ?? DEFAULT_INTERVAL_MS)
    this.timer = setInterval(() => {
      void this.runScheduled().catch(err => logger.error(LOG_KEY, `定时调度失败: ${err}`))
    }, intervalMs)
    // 不阻止进程退出（测试与开发环境友好）
    this.timer.unref?.()
    logger.info(LOG_KEY, `定时调度已启动，间隔 ${Math.round(intervalMs / 1000)}s`)
  }

  /** 运行期间隔配置变更（T20 设置页联动）后重建定时器；未处于定时状态时 no-op */
  reschedule(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.start()
  }

  /**
   * 停止定时调度（不取消在途作业，JobRunner 持久化进度可续跑）
   * 进度订阅保留：stop 后仍可能经 triggerNow/onSourceAdded 手动入队，需终态出账（W4）
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  get isScheduled(): boolean {
    return this.timer !== null
  }

  /** 定时触发：按 planner 给出的计划逐库入队 */
  async runScheduled(): Promise<string[]> {
    if (!this.deps.isEnabled()) return []
    if (!this.planner) {
      logger.warn(LOG_KEY, '未注册 AgentPlanner，跳过本轮调度')
      return []
    }
    const plans = await this.planner()
    const jobIds: string[] = []
    for (const plan of plans) {
      const id = await this.triggerNow(plan.libraryId, plan.sourceIds)
      jobIds.push(...id)
    }
    return jobIds
  }

  /**
   * 立即调度一次发现作业（手动触发 / 新信息源加入）。
   * flag 关闭时完全不调度；在途作业覆盖的来源自动跳过。
   * @returns 本次入队的 jobId（无新来源或被关闭时为空数组）
   */
  async triggerNow(libraryId: number, sourceIds?: number[]): Promise<string[]> {
    if (!this.deps.isEnabled()) return []
    const targets = this.filterActive(sourceIds ?? [])
    if (sourceIds && targets.length === 0) return []
    try {
      const runner = this.deps.getRunner()
      const jobId = await runner.enqueue(
        AGENT_DISCOVERY_KIND,
        { libraryId, sourceIds: targets },
        {
          // 约定：发现作业不涉及图片，job_items.image_id 复用为 source_id，
          // 处理器（T16）按 item.imageId 取信息源执行抓取
          items: targets.map(sid => ({ libraryId, imageId: sid })),
        },
      )
      if (targets.length > 0) this.activeJobs.set(jobId, new Set(targets))
      try {
        await runner.start(jobId)
      } catch (err) {
        // W3：start 同步抛错（如处理器未注册）时作业永不会有终态事件，
        // 回滚在途登记并 cancel 残留 pending 作业，避免来源永久滞留去重集合
        this.activeJobs.delete(jobId)
        await runner.cancel(jobId).catch(() => {})
        throw err
      }
      logger.info(LOG_KEY, `发现作业已入队: ${jobId} lib=${libraryId} sources=[${targets.join(',')}]`)
      return [jobId]
    } catch (err) {
      logger.error(LOG_KEY, `发现作业入队失败: ${err}`)
      return []
    }
  }

  /** 新信息源加入触发（T19 启用来源后调用） */
  onSourceAdded(libraryId: number, sourceId: number): Promise<string[]> {
    logger.info(LOG_KEY, `新信息源加入，触发首次发现: lib=${libraryId} source=${sourceId}`)
    return this.triggerNow(libraryId, [sourceId])
  }

  /** 过滤掉已有在途作业覆盖的来源 */
  private filterActive(sourceIds: number[]): number[] {
    const inFlight = new Set<number>()
    for (const active of this.activeJobs.values()) {
      for (const sid of active) inFlight.add(sid)
    }
    return sourceIds.filter(sid => !inFlight.has(sid))
  }

  /** 在途作业快照（UI 展示/测试用） */
  activeJobSources(): Record<string, number[]> {
    const result: Record<string, number[]> = {}
    for (const [jobId, sources] of this.activeJobs) result[jobId] = [...sources]
    return result
  }
}
