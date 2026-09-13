import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryMonitor } from '../memory-monitor'

describe('MemoryMonitor', () => {
  let monitor: MemoryMonitor

  beforeEach(() => {
    // 默认阈值：yellow 300MB, red 400MB
    monitor = new MemoryMonitor({ yellowMB: 300, redMB: 400 })
    // mock process.memoryUsage().rss（单位 bytes）
    vi.spyOn(process, 'memoryUsage')
  })

  afterEach(() => {
    monitor.stop()
    vi.restoreAllMocks()
  })

  function setRssMB(mb: number) {
    const bytes = mb * 1024 * 1024
    vi.mocked(process.memoryUsage).mockReturnValue({
      rss: bytes,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    })
  }

  describe('初始状态', () => {
    it('初始水位线为 green', () => {
      setRssMB(100)
      monitor.refresh()
      expect(monitor.getStatus().level).toBe('green')
    })

    it('初始 RSS 为 0', () => {
      expect(monitor.getStatus().rssMB).toBe(0)
    })
  })

  describe('水位线判断', () => {
    it('低于 yellow 阈值为 green', () => {
      setRssMB(299)
      monitor.refresh()
      expect(monitor.getStatus().level).toBe('green')
    })

    it('等于 yellow 阈值为 yellow', () => {
      setRssMB(300)
      monitor.refresh()
      expect(monitor.getStatus().level).toBe('yellow')
    })

    it('yellow 与 red 之间为 yellow', () => {
      setRssMB(350)
      monitor.refresh()
      expect(monitor.getStatus().level).toBe('yellow')
    })

    it('等于 red 阈值为 red', () => {
      setRssMB(400)
      monitor.refresh()
      expect(monitor.getStatus().level).toBe('red')
    })

    it('超过 red 阈值为 red', () => {
      setRssMB(500)
      monitor.refresh()
      expect(monitor.getStatus().level).toBe('red')
    })
  })

  describe('isRed / isYellowOrAbove', () => {
    it('green 时 isRed 为 false', () => {
      setRssMB(100)
      monitor.refresh()
      expect(monitor.isRed()).toBe(false)
      expect(monitor.isYellowOrAbove()).toBe(false)
    })

    it('yellow 时 isRed 为 false，isYellowOrAbove 为 true', () => {
      setRssMB(350)
      monitor.refresh()
      expect(monitor.isRed()).toBe(false)
      expect(monitor.isYellowOrAbove()).toBe(true)
    })

    it('red 时 isRed 为 true，isYellowOrAbove 为 true', () => {
      setRssMB(450)
      monitor.refresh()
      expect(monitor.isRed()).toBe(true)
      expect(monitor.isYellowOrAbove()).toBe(true)
    })
  })

  describe('getStatus', () => {
    it('返回完整的 MemoryStatus 结构', () => {
      setRssMB(200)
      monitor.refresh()
      const status = monitor.getStatus()
      expect(status).toEqual({
        level: 'green',
        rssMB: 200,
        threshold: { yellow: 300, red: 400 },
      })
    })
  })

  describe('levelChange 事件', () => {
    it('水位线从 green 变为 yellow 时触发事件', () => {
      setRssMB(100)
      monitor.refresh()

      const handler = vi.fn()
      monitor.on('levelChange', handler)

      setRssMB(350)
      monitor.refresh()

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'yellow' })
      )
    })

    it('水位线从 yellow 变为 red 时触发事件', () => {
      setRssMB(350)
      monitor.refresh()

      const handler = vi.fn()
      monitor.on('levelChange', handler)

      setRssMB(450)
      monitor.refresh()

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'red' })
      )
    })

    it('水位线未变化时不触发事件', () => {
      setRssMB(100)
      monitor.refresh()

      const handler = vi.fn()
      monitor.on('levelChange', handler)

      setRssMB(150)
      monitor.refresh()

      expect(handler).not.toHaveBeenCalled()
    })

    it('连续变化时每次都触发', () => {
      setRssMB(100)
      monitor.refresh()

      const handler = vi.fn()
      monitor.on('levelChange', handler)

      setRssMB(350)
      monitor.refresh()
      setRssMB(450)
      monitor.refresh()

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler.mock.calls[0][0].level).toBe('yellow')
      expect(handler.mock.calls[1][0].level).toBe('red')
    })
  })

  describe('定时刷新', () => {
    it('start 后立即刷新', () => {
      setRssMB(100)
      monitor.start(60000)
      expect(monitor.getStatus().rssMB).toBe(100)
    })

    it('按 interval 定时刷新', () => {
      vi.useFakeTimers()
      setRssMB(100)
      monitor.start(1000)

      setRssMB(350)
      vi.advanceTimersByTime(1000)
      expect(monitor.getStatus().level).toBe('yellow')

      setRssMB(450)
      vi.advanceTimersByTime(1000)
      expect(monitor.getStatus().level).toBe('red')

      monitor.stop()
      vi.useRealTimers()
    })

    it('stop 后停止刷新', () => {
      vi.useFakeTimers()
      setRssMB(100)
      monitor.start(1000)
      monitor.stop()

      setRssMB(450)
      vi.advanceTimersByTime(2000)
      // stop 后不再自动刷新，RSS 保持为 start 时的值
      expect(monitor.getStatus().rssMB).toBe(100)

      vi.useRealTimers()
    })

    it('重复调用 start 不会创建多个定时器', () => {
      vi.useFakeTimers()
      setRssMB(100)
      monitor.start(1000)
      monitor.start(1000)

      setRssMB(350)
      vi.advanceTimersByTime(1000)
      // 只刷新一次（不是两次）
      expect(monitor.getStatus().level).toBe('yellow')

      monitor.stop()
      vi.useRealTimers()
    })
  })

  describe('自定义阈值', () => {
    it('支持自定义 yellow/red 阈值', () => {
      const custom = new MemoryMonitor({ yellowMB: 100, redMB: 200 })
      setRssMB(50)
      custom.refresh()
      expect(custom.getStatus().level).toBe('green')

      setRssMB(150)
      custom.refresh()
      expect(custom.getStatus().level).toBe('yellow')

      setRssMB(250)
      custom.refresh()
      expect(custom.getStatus().level).toBe('red')

      expect(custom.getStatus().threshold).toEqual({ yellow: 100, red: 200 })
      custom.stop()
    })
  })
})
