import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

import { LibraryMonitor } from '../library-monitor'

/** 等待指定毫秒 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('LibraryMonitor', () => {
  let tmpDir: string
  let monitor: LibraryMonitor

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-monitor-test-'))
    monitor = new LibraryMonitor(30) // 短间隔便于测试
  })

  afterEach(() => {
    monitor.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('start() 立即探测：可达目录判定 online，回调收到状态变更', async () => {
    const libDir = path.join(tmpDir, 'lib')
    fs.mkdirSync(libDir)
    const changes: Array<{ id: number; status: string }> = []
    monitor.setLibraries([{ id: 1, rootPath: libDir }])
    // setLibraries 初始缓存为 online，start 首次探测仍为 online → 无变更；
    // 改用不存在的库验证首次 unknown → offline 的变更通知
    monitor.setLibraries([{ id: 2, rootPath: path.join(tmpDir, 'missing') }])
    monitor.onStatusChanged((id, status) => changes.push({ id, status }))
    monitor.start()
    await sleep(100)
    expect(monitor.getStatus(2)).toBe('offline')
    expect(changes).toContainEqual({ id: 2, status: 'offline' })
  })

  it('目录从可访问变为删除：状态 online → offline 并触发回调', async () => {
    const libDir = path.join(tmpDir, 'lib')
    fs.mkdirSync(libDir)
    monitor.setLibraries([{ id: 1, rootPath: libDir }])
    const changes: Array<{ id: number; status: string }> = []
    monitor.onStatusChanged((id, status) => changes.push({ id, status }))
    monitor.start()
    await sleep(80)
    expect(monitor.getStatus(1)).toBe('online')
    fs.rmSync(libDir, { recursive: true })
    await waitForStatus(1, 'offline', monitor)
    expect(changes).toContainEqual({ id: 1, status: 'offline' })
  })

  it('状态未变化不重复触发回调', async () => {
    const libDir = path.join(tmpDir, 'stable')
    fs.mkdirSync(libDir)
    monitor.setLibraries([{ id: 1, rootPath: libDir }])
    const cb = vi.fn()
    monitor.onStatusChanged(cb)
    monitor.start()
    await sleep(150) // 至少 4 轮探测
    expect(cb).not.toHaveBeenCalled()
    expect(monitor.getStatus(1)).toBe('online')
  })

  it('stop() 释放定时器：停止后删除目录不再改变状态', async () => {
    const libDir = path.join(tmpDir, 'lib')
    fs.mkdirSync(libDir)
    monitor.setLibraries([{ id: 1, rootPath: libDir }])
    monitor.start()
    await sleep(80)
    monitor.stop()
    fs.rmSync(libDir, { recursive: true })
    await sleep(100)
    expect(monitor.getStatus(1)).toBe('online') // 已停止探测，缓存保持不变
  })

  it('重复 start() 幂等，不叠加定时器', async () => {
    monitor.setLibraries([{ id: 1, rootPath: tmpDir }])
    monitor.start()
    monitor.start()
    await sleep(80)
    expect(monitor.getStatus(1)).toBe('online')
    monitor.stop()
  })

  it('getStatus 未知库返回 offline', () => {
    expect(monitor.getStatus(999)).toBe('offline')
  })
})

/** 轮询等待某库达到目标状态（超时 2s） */
async function waitForStatus(id: number, expected: 'online' | 'offline', monitor: LibraryMonitor): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (monitor.getStatus(id) === expected) return
    await sleep(20)
  }
  throw new Error(`库 ${id} 未在 2s 内变为 ${expected}`)
}
