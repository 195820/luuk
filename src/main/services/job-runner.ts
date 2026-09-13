import { randomUUID } from 'crypto'
import { logger } from '../../utils/logger'
import type { MasterDB } from './database'
import type { JobState, JobItemState, JobProgress, JobItem } from '../../types'

/** 批处理大小 */
const BATCH_SIZE = 10

/** 处理器函数类型 */
type JobItemHandler = (item: JobItem) => Promise<void>

/** 进度回调 */
type ProgressCallback = (progress: JobProgress) => void

/** 运行中的作业状态 */
interface RunningJob {
  jobId: string
  handler: JobItemHandler
  abortController: AbortController
  paused: boolean
}

/**
 * JobRunner — 持久化后台作业调度器
 *
 * 设计原则（来自设计文档 4.2-4.6）：
 * - 进度落库（job_items 表），进程重启可续跑
 * - 单项失败不中断整批（Promise.allSettled 模式）
 * - 支持暂停/继续/取消
 * - 优先级队列（高优先级先执行）
 * - 批处理 + setImmediate 让权，避免阻塞主线程
 * - 双通道：批处理走 JobRunner，交互式请求不进队列
 */
export class JobRunner {
  private db: MasterDB
  private runningJobs = new Map<string, RunningJob>()
  private handlers = new Map<string, JobItemHandler>()
  private progressCallbacks = new Set<ProgressCallback>()
  /** 跟踪所有 executeJob 的 Promise，供 shutdown 等待 */
  private pendingExecutions = new Set<Promise<void>>()

  constructor(db: MasterDB) {
    this.db = db
  }

  /** 注册作业处理器 */
  registerHandler(kind: string, handler: JobItemHandler): void {
    this.handlers.set(kind, handler)
  }

  /** 订阅进度通知 */
  subscribeProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback)
    return () => this.progressCallbacks.delete(callback)
  }

  /** 创建新作业 */
  async enqueue(
    kind: string,
    payload: unknown,
    options?: {
      priority?: number
      items?: Array<{ libraryId: number; imageId: number | null }>
    }
  ): Promise<string> {
    const jobId = randomUUID()
    const priority = options?.priority ?? 0
    const total = options?.items?.length ?? 0

    this.db.createJob(jobId, kind, priority, total, JSON.stringify(payload))

    if (options?.items?.length) {
      this.db.createJobItems(jobId, options.items)
    }

    logger.info('JobRunner', `作业入队: ${jobId} (${kind}), ${total} 项`)
    return jobId
  }

  /** 启动作业 */
  async start(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error(`作业不存在: ${jobId}`)
    if (job.state !== 'pending' && job.state !== 'paused') {
      throw new Error(`作业状态不允许启动: ${job.state}`)
    }

    const handler = this.handlers.get(job.kind)
    if (!handler) throw new Error(`未注册处理器: ${job.kind}`)

    const abortController = new AbortController()
    this.runningJobs.set(jobId, {
      jobId,
      handler,
      abortController,
      paused: false,
    })

    this.db.updateJobState(jobId, 'running')
    this.emitProgress(jobId)

    // 异步执行，不阻塞调用方
    const execution = this.executeJob(jobId).catch(err => {
      logger.error('JobRunner', `作业执行异常: ${jobId}`, err)
    }).finally(() => {
      this.pendingExecutions.delete(execution)
    })
    this.pendingExecutions.add(execution)
  }

  /** 暂停作业 */
  async pause(jobId: string): Promise<void> {
    const running = this.runningJobs.get(jobId)
    if (!running) return

    running.paused = true
    running.abortController.abort()
    this.db.updateJobState(jobId, 'paused')
    this.emitProgress(jobId)
    this.runningJobs.delete(jobId)

    logger.info('JobRunner', `作业暂停: ${jobId}`)
  }

  /** 继续作业 */
  async resume(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error(`作业不存在: ${jobId}`)
    if (job.state !== 'paused') throw new Error(`作业不在暂停状态: ${job.state}`)

    await this.start(jobId)
  }

  /** 取消作业 */
  async cancel(jobId: string): Promise<void> {
    const running = this.runningJobs.get(jobId)
    if (running) {
      running.abortController.abort()
      this.runningJobs.delete(jobId)
    }

    this.db.updateJobState(jobId, 'cancelled')
    this.emitProgress(jobId)
    logger.info('JobRunner', `作业取消: ${jobId}`)
  }

  /** 关闭所有运行中的作业，等待后台任务完成 */
  async shutdown(): Promise<void> {
    for (const [jobId, running] of this.runningJobs) {
      running.abortController.abort()
      this.db.updateJobState(jobId, 'paused')
    }
    this.runningJobs.clear()
    // 等待所有 executeJob 响应 abort 信号并完成清理
    await Promise.allSettled([...this.pendingExecutions])
  }

  /** 执行作业主循环 */
  private async executeJob(jobId: string): Promise<void> {
    const running = this.runningJobs.get(jobId)
    if (!running) return

    const { handler, abortController } = running

    while (!abortController.signal.aborted) {
      // 取出下一批 pending items
      const pendingItems = this.db.getJobItems(jobId, 'pending' as JobItemState).slice(0, BATCH_SIZE)
      if (pendingItems.length === 0) break

      // 标记为 running
      this.db.updateJobItemState(
        pendingItems.map(i => i.id),
        'running' as JobItemState
      )

      // 并发处理本批（单项失败不中断）
      const results = await Promise.allSettled(
        pendingItems.map(async (item) => {
          try {
            await handler(item)
            return { itemId: item.id, success: true as const }
          } catch (err) {
            return { itemId: item.id, success: false as const, error: (err as Error).message }
          }
        })
      )

      // 先处理结果（保留已完成的 done/failed 状态）
      let batchDone = 0
      let batchFailed = 0
      for (const result of results) {
        const value = result.status === 'fulfilled' ? result.value : null
        if (value?.success) {
          this.db.updateJobItemState([value.itemId], 'done' as JobItemState)
          batchDone++
        } else {
          const itemId = value?.itemId ?? 0
          const errorMsg = result.status === 'rejected'
            ? (result.reason as Error).message
            : value?.error ?? 'unknown error'
          this.db.updateJobItemState([itemId], 'failed' as JobItemState, errorMsg)
          batchFailed++
        }
      }

      // 更新 job 计数
      const job = this.db.getJob(jobId)!
      this.db.updateJobState(
        jobId,
        'running' as JobState,
        job.done + batchDone,
        job.failed + batchFailed
      )

      this.emitProgress(jobId)

      // 中止信号检查：当前批次结果已落库，仅重置仍在 running 的项（实际不应存在）
      // 不开始下一批
      if (abortController.signal.aborted) {
        break
      }

      // 让出执行权，避免阻塞主线程
      await new Promise(resolve => setImmediate(resolve))
    }

    // 决定最终状态：根据 pending 数量和数据库状态判断
    const job = this.db.getJob(jobId)
    const pendingRemaining = this.db.getJobItems(jobId, 'pending' as JobItemState)

    if (pendingRemaining.length === 0) {
      // 所有 items 已处理完 — 保留外部意图状态（pause/cancel）
      if (job?.state === 'cancelled' || job?.state === 'paused') {
        // 不覆盖
      } else {
        this.db.updateJobState(jobId, 'done' as JobState)
        this.emitProgress(jobId)
      }
    }
    // 若仍有 pending items：状态由 pause/cancel 设置为 'paused'/'cancelled'，不覆盖

    this.runningJobs.delete(jobId)
    logger.info('JobRunner', `作业完成: ${jobId}`)
  }

  /** 发送进度通知 */
  private emitProgress(jobId: string): void {
    const job = this.db.getJob(jobId)
    if (!job) return

    const progress: JobProgress = {
      jobId,
      state: job.state,
      total: job.total,
      done: job.done,
      failed: job.failed,
    }

    for (const callback of this.progressCallbacks) {
      try {
        callback(progress)
      } catch (err) {
        logger.error('JobRunner', '进度回调异常', err)
      }
    }
  }
}

// ── 单例管理 ──

let instance: JobRunner | null = null

/** 初始化 JobRunner 单例 */
export function initJobRunner(db: MasterDB): JobRunner {
  if (!instance) {
    instance = new JobRunner(db)
  }
  return instance
}

/** 获取 JobRunner 单例 */
export function getJobRunner(): JobRunner {
  if (!instance) {
    throw new Error('JobRunner 未初始化，请先调用 initJobRunner()')
  }
  return instance
}
