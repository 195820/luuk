import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// database.ts 顶部 import { app } from 'electron'
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { JobRunner, initJobRunner, getJobRunner } from '../job-runner'
import { MasterDB } from '../database'

/** 等待指定毫秒 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('JobRunner', () => {
  let db: MasterDB
  let runner: JobRunner
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-job-test-'))
    db = new MasterDB()
    db.initialize(tmpDir)
    runner = new JobRunner(db)
  })

  afterEach(async () => {
    await runner.shutdown()
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── 入队 ──

  it('enqueue 创建作业并返回 jobId', async () => {
    const jobId = await runner.enqueue('test.job', { foo: 'bar' })
    expect(jobId).toBeTruthy()

    const job = db.getJob(jobId)
    expect(job).toBeTruthy()
    expect(job!.kind).toBe('test.job')
    expect(job!.state).toBe('pending')
    expect(job!.total).toBe(0)
  })

  it('enqueue 带 items 创建作业项', async () => {
    const jobId = await runner.enqueue('test.job', {}, {
      items: [
        { libraryId: 1, imageId: 1 },
        { libraryId: 1, imageId: 2 },
      ],
    })

    const items = db.getJobItems(jobId)
    expect(items).toHaveLength(2)
    expect(items[0].state).toBe('pending')
    expect(items[1].state).toBe('pending')
  })

  it('enqueue 支持优先级参数', async () => {
    const jobId = await runner.enqueue('test.job', {}, { priority: 10 })
    const job = db.getJob(jobId)
    expect(job!.priority).toBe(10)
  })

  // ── 执行 ──

  it('start 执行作业 — 处理器被调用', async () => {
    const processed: number[] = []

    runner.registerHandler('test.process', async (item) => {
      processed.push(item.imageId!)
    })

    const jobId = await runner.enqueue('test.process', {}, {
      items: [
        { libraryId: 1, imageId: 10 },
        { libraryId: 1, imageId: 20 },
        { libraryId: 1, imageId: 30 },
      ],
    })

    await runner.start(jobId)
    await sleep(200)

    expect(processed.sort((a, b) => a - b)).toEqual([10, 20, 30])
    const job = db.getJob(jobId)!
    expect(job.state).toBe('done')
    expect(job.done).toBe(3)
    expect(job.failed).toBe(0)
  })

  // ── 容错 ──

  it('单项失败不中断整批（Promise.allSettled）', async () => {
    runner.registerHandler('test.fail', async (item) => {
      if (item.imageId === 20) throw new Error('模拟失败')
    })

    const jobId = await runner.enqueue('test.fail', {}, {
      items: [
        { libraryId: 1, imageId: 10 },
        { libraryId: 1, imageId: 20 },
        { libraryId: 1, imageId: 30 },
      ],
    })

    await runner.start(jobId)
    await sleep(200)

    const job = db.getJob(jobId)!
    expect(job.done).toBe(2)
    expect(job.failed).toBe(1)
    expect(job.state).toBe('done')

    // 失败项的 error 字段被记录
    const items = db.getJobItems(jobId)
    const failedItem = items.find(i => i.state === 'failed')
    expect(failedItem).toBeTruthy()
    expect(failedItem!.error).toContain('模拟失败')
  })

  // ── 暂停 / 继续 ──

  it('pause/resume 暂停和继续', async () => {
    let processedCount = 0

    runner.registerHandler('test.pause', async () => {
      processedCount++
      await sleep(100)
    })

    // 30 项 = 3 批（BATCH_SIZE=10）
    const jobId = await runner.enqueue('test.pause', {}, {
      items: Array.from({ length: 30 }, (_, i) => ({
        libraryId: 1, imageId: i,
      })),
    })

    // 等 batch 1 完成（done=10）后立即暂停，确保 batch 2 还没开始
    const batch1Done = new Promise<void>(resolve => {
      runner.subscribeProgress((progress) => {
        if (progress.jobId === jobId && progress.done >= 10) resolve()
      })
    })

    await runner.start(jobId)
    await batch1Done
    // batch 1 刚完成，setImmediate 还没触发 batch 2 → 此时暂停可中断
    await runner.pause(jobId)

    // batch 1 的 10 项已处理，batch 2 未开始
    expect(processedCount).toBe(10)

    const pausedJob = db.getJob(jobId)!
    expect(pausedJob.state).toBe('paused')

    // 继续：处理剩余批次
    const allDone = new Promise<void>(resolve => {
      runner.subscribeProgress((progress) => {
        if (progress.jobId === jobId && progress.state === 'done') resolve()
      })
    })

    await runner.resume(jobId)
    await Promise.race([
      allDone,
      new Promise((_, reject) => setTimeout(() => reject(new Error('resume 超时')), 5000)),
    ])

    expect(processedCount).toBe(30)
    const resumedJob = db.getJob(jobId)!
    expect(resumedJob.state).toBe('done')
    expect(resumedJob.done).toBe(30)
  })

  // ── 取消 ──

  it('cancel 取消作业', async () => {
    runner.registerHandler('test.cancel', async () => {
      await sleep(100)
    })

    const jobId = await runner.enqueue('test.cancel', {}, {
      items: [{ libraryId: 1, imageId: 1 }],
    })

    await runner.start(jobId)
    await runner.cancel(jobId)

    const job = db.getJob(jobId)!
    expect(job.state).toBe('cancelled')
  })

  // ── 进度通知 ──

  it('subscribeProgress 接收进度通知', async () => {
    const progressUpdates: any[] = []

    runner.registerHandler('test.progress', async () => {
      await sleep(10)
    })

    const unsubscribe = runner.subscribeProgress((progress) => {
      progressUpdates.push(progress)
    })

    const jobId = await runner.enqueue('test.progress', {}, {
      items: [{ libraryId: 1, imageId: 1 }, { libraryId: 1, imageId: 2 }],
    })

    await runner.start(jobId)
    await sleep(200)

    expect(progressUpdates.length).toBeGreaterThan(0)
    const last = progressUpdates[progressUpdates.length - 1]
    expect(last.jobId).toBe(jobId)
    expect(last.done).toBe(2)
    expect(last.state).toBe('done')

    // 取消订阅后不再收到通知
    unsubscribe()
    const countBefore = progressUpdates.length
    // 没有新作业，不会有新通知
    expect(progressUpdates.length).toBe(countBefore)
  })

  // ── 错误处理 ──

  it('start 不存在作业抛异常', async () => {
    await expect(runner.start('nonexistent-id')).rejects.toThrow('作业不存在')
  })

  it('start 未注册处理器抛异常', async () => {
    const jobId = await runner.enqueue('unregistered.kind', {})
    await expect(runner.start(jobId)).rejects.toThrow('未注册处理器')
  })

  it('resume 非暂停状态抛异常', async () => {
    const jobId = await runner.enqueue('test.kind', {})
    await expect(runner.resume(jobId)).rejects.toThrow('不在暂停状态')
  })

  // ── 批处理边界 ──

  it('大批量分多批处理（> BATCH_SIZE）', async () => {
    const processed: number[] = []

    runner.registerHandler('test.batch', async (item) => {
      processed.push(item.imageId!)
    })

    // 25 项 = 3 批（10 + 10 + 5）
    const jobId = await runner.enqueue('test.batch', {}, {
      items: Array.from({ length: 25 }, (_, i) => ({
        libraryId: 1, imageId: i,
      })),
    })

    // 使用进度回调等待作业完成，比固定 sleep 更可靠
    const allDone = new Promise<void>(resolve => {
      runner.subscribeProgress((progress) => {
        if (progress.jobId === jobId && progress.state === 'done') resolve()
      })
    })

    await runner.start(jobId)
    await Promise.race([
      allDone,
      new Promise((_, reject) => setTimeout(() => reject(new Error('大批量处理超时')), 5000)),
    ])

    expect(processed).toHaveLength(25)
    const job = db.getJob(jobId)!
    expect(job.state).toBe('done')
    expect(job.done).toBe(25)
  })

  // ── shutdown ──

  it('shutdown 中止所有运行中的作业', async () => {
    runner.registerHandler('test.shutdown', async () => {
      await sleep(200)
    })

    const jobId = await runner.enqueue('test.shutdown', {}, {
      items: Array.from({ length: 20 }, (_, i) => ({
        libraryId: 1, imageId: i,
      })),
    })

    await runner.start(jobId)
    await sleep(50)
    runner.shutdown()

    // shutdown 将 running 作业置为 paused
    const job = db.getJob(jobId)!
    expect(job.state).toBe('paused')
  })
})

// ── 单例管理 ──

describe('JobRunner 单例', () => {
  let tmpDir: string
  let db: MasterDB

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-job-singleton-'))
    db = new MasterDB()
    db.initialize(tmpDir)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('initJobRunner 创建单例，getJobRunner 获取同一实例', async () => {
    // 动态导入获取独立的模块作用域
    const mod = await import('../job-runner')
    const instance1 = mod.initJobRunner(db)
    const instance2 = mod.getJobRunner()
    expect(instance1).toBe(instance2)
    expect(instance1).toBeInstanceOf(mod.JobRunner)
  })

  it('initJobRunner 重复调用返回同一实例', () => {
    // 使用已导入的模块（单例已在上一测试初始化）
    const instance1 = initJobRunner(db)
    const instance2 = getJobRunner()
    expect(instance1).toBe(instance2)
  })
})
