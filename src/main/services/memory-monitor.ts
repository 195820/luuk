import { EventEmitter } from 'node:events'
import process from 'node:process'
import { app } from 'electron'
import type { MemoryLevel, MemoryStatus } from '../../types/plugin'

export interface MemoryMonitorOptions {
  yellowMB: number
  redMB: number
  /** 插件 Worker 进程单独的红色硬上限（MB），与聚合口径各司其职（P0-3） */
  workerRedMB?: number
}

/** 插件 Worker 进程在 app.getAppMetrics() 中的服务名（与 plugin-host-process fork 的 serviceName 对齐） */
const WORKER_SERVICE_NAME = 'luuk-plugin-worker'

/**
 * 三级内存水位线监控器
 * - 🟢 green: < yellowMB
 * - 🟡 yellow: yellowMB ~ redMB
 * - 🔴 red: > redMB
 */
export class MemoryMonitor extends EventEmitter {
  private yellowMB: number
  private redMB: number
  private workerRedMB: number
  private currentLevel: MemoryLevel = 'green'
  private currentRssMB: number = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: MemoryMonitorOptions) {
    super()
    this.yellowMB = options.yellowMB
    this.redMB = options.redMB
    this.workerRedMB = options.workerRedMB ?? 500
  }

  /** 获取当前内存状态 */
  getStatus(): MemoryStatus {
    return {
      level: this.currentLevel,
      rssMB: this.currentRssMB,
      threshold: {
        yellow: this.yellowMB,
        red: this.redMB,
      },
    }
  }

  /** 刷新内存水位线，返回当前级别 */
  refresh(): MemoryLevel {
    this.currentRssMB = this.aggregateRssMB()

    const previousLevel = this.currentLevel
    this.currentLevel = this.computeLevel(this.currentRssMB)

    // 水位线变化时触发事件
    if (this.currentLevel !== previousLevel) {
      this.emit('levelChange', this.getStatus())
    }

    return this.currentLevel
  }

  /**
   * 聚合所有进程 RSS（主进程 + 渲染进程 + 插件 utilityProcess）。
   * app.getAppMetrics() 的 workingSetSize 单位为 KB。取不到时回退主进程 RSS。
   */
  private aggregateRssMB(): number {
    try {
      if (app?.isReady?.()) {
        const metrics = app.getAppMetrics()
        const totalKB = metrics.reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0)
        if (totalKB > 0) return Math.round(totalKB / 1024)
      }
    } catch {
      /* 非 Electron 环境或 API 不可用 → 回退 */
    }
    return Math.round(process.memoryUsage().rss / 1024 / 1024)
  }

  /**
   * 插件 Worker 进程单独 RSS（MB）（P0-3）。
   * 与 aggregateRssMB 同源 API，零额外 IPC；Worker 未启动/取不到时返回 0。
   */
  getWorkerRssMB(serviceName: string = WORKER_SERVICE_NAME): number {
    try {
      if (app?.isReady?.()) {
        const m = app.getAppMetrics().find((x) => x.name === serviceName)
        const kb = m?.memory?.workingSetSize ?? 0
        if (kb > 0) return Math.round(kb / 1024)
      }
    } catch {
      /* 非 Electron 环境或 API 不可用 → 视为 0 */
    }
    return 0
  }

  /** Worker 进程是否超其单独红色硬上限（与聚合口径任一命中即拒绝 AI） */
  isWorkerRed(serviceName?: string): boolean {
    return this.getWorkerRssMB(serviceName) >= this.workerRedMB
  }

  /** 启动定时刷新，默认 5000ms 间隔 */
  start(intervalMs: number = 5000): void {
    if (this.timer) return
    // 首次立即刷新
    this.refresh()
    this.timer = setInterval(() => this.refresh(), intervalMs)
  }

  /** 停止定时刷新 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 当前是否为红色水位 */
  isRed(): boolean {
    return this.currentLevel === 'red'
  }

  /** 当前是否为黄色或更高水位 */
  isYellowOrAbove(): boolean {
    return this.currentLevel === 'yellow' || this.currentLevel === 'red'
  }

  /** 根据 RSS 计算水位级别 */
  private computeLevel(rssMB: number): MemoryLevel {
    if (rssMB >= this.redMB) return 'red'
    if (rssMB >= this.yellowMB) return 'yellow'
    return 'green'
  }
}
