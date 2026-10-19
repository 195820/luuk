import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// database.ts 顶部 import { app } from 'electron'
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { JobRunner } from '../job-runner'
import { MasterDB } from '../database'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 轮询直到条件成立。自泵类断言不得依赖固定 sleep：
 * 全量并行满载跑（多 worker 抢 CPU）时，30ms 级作业的收尾可超出固定窗口造成假失败（2026-10-19 实测）。
 */
async function waitFor(fn: () => boolean, timeoutMs = 3000, label = ''): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor 超时${label ? `: ${label}` : ''}`)
    await sleep(20)
  }
}

describe('P1-9 · JobRunner 自泵（第二个作业不再永久 pending）', () => {
  let db: MasterDB
  let runner: JobRunner
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-job-p19-'))
    db = new MasterDB()
    db.initialize(tmpDir)
    runner = new JobRunner(db, 1) // maxConcurrent = 1
  })

  afterEach(async () => {
    await runner.shutdown()
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('队头作业完成后，自动拉起 pending 的第二作业（串行）', async () => {
    const order: string[] = []
    runner.registerHandler('test.pump', async (item) => {
      order.push(`${item.imageId}`)
    })

    const job1 = await runner.enqueue('test.pump', {}, { items: [{ libraryId: 1, imageId: 1 }] })
    const job2 = await runner.enqueue('test.pump', {}, { items: [{ libraryId: 1, imageId: 2 }] })

    // 只手动启动 job1；job2 应保持 pending，直到 job1 完成后由 pump 拉起
    expect(db.getJob(job2)!.state).toBe('pending')
    await runner.start(job1)
    await waitFor(() => db.getJob(job1)!.state === 'done' && db.getJob(job2)!.state === 'done', 3000, 'job1/job2 done')
    expect(order.sort()).toEqual(['1', '2'])
  })

  it('作业级串行：maxConcurrent=1 时两个作业不会同时在跑（item 级并行不算）', async () => {
    const activeJobs = new Set<string>()
    let peakJobs = 0
    runner.registerHandler('test.gate', async (item) => {
      activeJobs.add(item.jobId)
      peakJobs = Math.max(peakJobs, activeJobs.size)
      await sleep(20)
      activeJobs.delete(item.jobId)
    })

    const a = await runner.enqueue('test.gate', {}, { items: [{ libraryId: 1, imageId: 1 }, { libraryId: 1, imageId: 2 }] })
    // 第二个作业入队但不自动启动（enqueue 不启动，由 IPC 层判断；此处模拟：直接 enqueue）
    const b = await runner.enqueue('test.gate', {}, { items: [{ libraryId: 1, imageId: 3 }] })

    await runner.start(a)
    await waitFor(() => db.getJob(a)!.state === 'done' && db.getJob(b)!.state === 'done', 3000, 'gate a/b done')

    expect(peakJobs).toBe(1) // 同一作业内多 item 并行，但作业间始终串行
    expect(db.getJob(a)!.state).toBe('done')
    expect(db.getJob(b)!.state).toBe('done') // 由 pump 拉起后完成
  })

  it('取消队头作业后，pump 拉起 pending 的第二作业', async () => {
    runner.registerHandler('test.cancel', async (item) => {
      // 队头作业：单项耗时，便于在运行中取消
      await sleep(30)
      void item
    })

    const job1 = await runner.enqueue('test.cancel', {}, { items: [{ libraryId: 1, imageId: 1 }, { libraryId: 1, imageId: 2 }] })
    const job2 = await runner.enqueue('test.cancel', {}, { items: [{ libraryId: 1, imageId: 3 }] })

    await runner.start(job1)
    await sleep(10) // 让 job1 进入运行
    await runner.cancel(job1)
    await waitFor(() => db.getJob(job1)!.state === 'cancelled' && db.getJob(job2)!.state === 'done', 3000, 'cancel 后 job2 done')

    expect(db.getJob(job2)!.state).toBe('done') // 取消释放槽位后 pump 拉起
  })

  // DEF-PUMP-01（2026-10-19 发版门禁由 E2E PH8-18 暴露）：自泵不得被「无注册 handler 的陈旧 pending 作业」饿死。
  // 旧实现只取 maxConcurrent * 4 行窗口（默认并发 1 → 窗口 4），按 created_at 升序若窗口被
  // 插件未启用而永久 pending 的旧作业占满，循环逐个 continue 后窗口耗尽，真正可跑的排队作业永不启动。
  it('DEF-PUMP-01 饿死回归：窗口内全是无 handler 的旧 pending 作业时，pump 仍须分页拉到可跑作业', async () => {
    runner.registerHandler('test.hungry', async () => { /* 即时完成 */ })

    // 先造 8 个「kind 从未注册 handler」的更旧 pending 作业（模拟插件关闭期入队后未启用）
    for (let i = 0; i < 8; i++) {
      await runner.enqueue('test.nohandler', {}, { items: [{ libraryId: 1, imageId: 100 + i }] })
      await sleep(3) // 拉开 created_at，确保严格排在新作业之前
    }

    const head = await runner.enqueue('test.hungry', {}, { items: [{ libraryId: 1, imageId: 1 }] })
    const tail = await runner.enqueue('test.hungry', {}, { items: [{ libraryId: 1, imageId: 2 }] })

    await runner.start(head)
    await waitFor(() => db.getJob(head)!.state === 'done' && db.getJob(tail)!.state === 'done', 3000, 'DEF-PUMP-01 分页后 tail done')

    // 修复前：tail 永久 pending（窗口被 8 个无 handler 作业占满）
    expect(db.getJob(tail)!.state).toBe('done')
    // 无 handler 的作业不得被误启动（仍保留 pending，等对应插件启用）
    const orphans = db.getAllJobs().filter(j => j.kind === 'test.nohandler')
    expect(orphans.every(j => j.state === 'pending')).toBe(true)
  })

  // N1（退出期一致性，登记于全面测试方案 §附）：shutdown 后的 pump 收尾不得复活其它 pending 作业
  it('N1 回归：shutdown 期间收尾 pump 不再拉起新作业', async () => {
    runner.registerHandler('test.slow', async () => { await sleep(40) })

    const head = await runner.enqueue('test.slow', {}, { items: [{ libraryId: 1, imageId: 1 }] })
    const tail = await runner.enqueue('test.slow', {}, { items: [{ libraryId: 1, imageId: 2 }] })
    await runner.start(head)
    await sleep(5) // head 进入运行

    await runner.shutdown()
    const stateRightAfterShutdown = db.getJob(tail)!.state
    await sleep(200)

    // 在飞作业转 paused（可续跑）；排队作业不得被自泵复活
    expect(stateRightAfterShutdown).toBe('pending')
    expect(db.getJob(tail)!.state).toBe('pending')
    expect(db.getJob(head)!.state).toBe('paused')
  })
})
