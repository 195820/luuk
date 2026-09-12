import { EventEmitter } from 'node:events'
import process from 'node:process'
import type { MemoryLevel, MemoryStatus } from '../../types/plugin'

export interface MemoryMonitorOptions {
  yellowMB: number
  redMB: number
}

/**
 * 三级内存水位线监控器
 * - 🟢 green: < yellowMB
 * - 🟡 yellow: yellowMB ~ redMB
 * - 🔴 red: > redMB
 */
export class MemoryMonitor extends EventEmitter {
  private yellowMB: number
  private redMB: number
  private currentLevel: MemoryLevel = 'green'
  private currentRssMB: number = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: MemoryMonitorOptions) {
    super()
    this.yellowMB = options.yellowMB
    this.redMB = options.redMB
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
    // process.memoryUsage().rss 包含所有 C/C++ 分配（含 native 模块）
    const rssBytes = process.memoryUsage().rss
    this.currentRssMB = Math.round(rssBytes / 1024 / 1024)

    const previousLevel = this.currentLevel
    this.currentLevel = this.computeLevel(this.currentRssMB)

    // 水位线变化时触发事件
    if (this.currentLevel !== previousLevel) {
      this.emit('levelChange', this.getStatus())
    }

    return this.currentLevel
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
