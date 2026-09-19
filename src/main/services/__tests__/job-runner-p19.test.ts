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
    await sleep(300)

    expect(db.getJob(job1)!.state).toBe('done')
    expect(db.getJob(job2)!.state).toBe('done')
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
    await sleep(400)

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
    await sleep(300)

    expect(db.getJob(job1)!.state).toBe('cancelled')
    expect(db.getJob(job2)!.state).toBe('done') // 取消释放槽位后 pump 拉起
  })
})
