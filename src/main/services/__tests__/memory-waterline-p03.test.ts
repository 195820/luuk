import { describe, it, expect, vi, beforeEach } from 'vitest'

// 可控的 app.getAppMetrics() 返回值（workingSetSize 单位 KB）
let metrics: Array<{ name: string; memory: { workingSetSize: number } }> = []

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getAppMetrics: () => metrics,
  },
}))

import { MemoryMonitor } from '../memory-monitor'

const KB = (mb: number) => mb * 1024

describe('P0-3 · 内存水位线口径 / 阈值统一', () => {
  beforeEach(() => {
    metrics = []
  })

  it('聚合口径三态边界随新阈值：1499 green / 1500 yellow / 2500 red', () => {
    const m = new MemoryMonitor({ yellowMB: 1500, redMB: 2500, workerRedMB: 500 })

    metrics = [{ name: 'main', memory: { workingSetSize: KB(1499) } }]
    expect(m.refresh()).toBe('green')

    metrics = [{ name: 'main', memory: { workingSetSize: KB(1500) } }]
    expect(m.refresh()).toBe('yellow')

    metrics = [{ name: 'main', memory: { workingSetSize: KB(2500) } }]
    expect(m.refresh()).toBe('red')
    expect(m.isRed()).toBe(true)
  })

  it('Worker 口径独立：聚合仍 green，但 Worker RSS ≥ workerRedMB → isWorkerRed true', () => {
    const m = new MemoryMonitor({ yellowMB: 1500, redMB: 2500, workerRedMB: 500 })
    metrics = [
      { name: 'main', memory: { workingSetSize: KB(100) } },
      { name: 'luuk-plugin-worker', memory: { workingSetSize: KB(520) } },
    ]
    // 聚合 = 620MB < 1500 → green（解除旧口径恒拒）
    expect(m.refresh()).toBe('green')
    expect(m.isRed()).toBe(false)
    // 但 Worker 单独 520MB ≥ 500 → 命中 Worker 口径
    expect(m.getWorkerRssMB()).toBe(520)
    expect(m.isWorkerRed()).toBe(true)
  })

  it('Worker 未启动：getWorkerRssMB=0，isWorkerRed=false（不误拒）', () => {
    const m = new MemoryMonitor({ yellowMB: 1500, redMB: 2500, workerRedMB: 500 })
    metrics = [{ name: 'main', memory: { workingSetSize: KB(100) } }]
    expect(m.getWorkerRssMB()).toBe(0)
    expect(m.isWorkerRed()).toBe(false)
  })

  it('旧恒拒场景复现并解除：正常会话聚合 RSS 800MB 应 green（旧 400 阈值下必 red）', () => {
    const m = new MemoryMonitor({ yellowMB: 1500, redMB: 2500, workerRedMB: 500 })
    metrics = [{ name: 'main', memory: { workingSetSize: KB(800) } }]
    expect(m.refresh()).toBe('green')
    expect(m.isRed()).toBe(false)
  })
})
