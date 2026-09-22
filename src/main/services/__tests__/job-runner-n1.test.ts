// @vitest-environment node
/**
 * N1 回归用例：JobRunner shutdown 后不得再 start 任何作业（§5.7 回归矩阵）。
 * 缺陷背景：shutdown() 后 executeJob 收尾无条件 pump()，可能复活 pending 作业。
 * 本用例固化当前"安全退出"契约：shutdown 后 enqueue/start 新作业应失败或无效。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { JobRunner } from '../job-runner'
import { MasterDB } from '../database'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('N1 回归：shutdown 后不得 start', () => {
  let db: MasterDB
  let runner: JobRunner
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-n1-'))
    db = new MasterDB()
    db.initialize(tmpDir)
    runner = new JobRunner(db)
  })

  afterEach(async () => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // 已知缺陷 N1：shutdown 后 pump 无条件复活 pending 作业（由 91b2ad0 引入）。
  // 修复后移除 .fails 标注。
  it.fails('shutdown 后 start 已有 jobId 应抛错或静默无效（不执行）', async () => {
    let executed = false
    runner.registerHandler('n1.test', async () => { executed = true })

    const jobId = await runner.enqueue('n1.test', {}, {
      items: [{ libraryId: 1, imageId: 1 }],
    })

    await runner.shutdown()

    // shutdown 后尝试 start：应抛错或静默无效
    try {
      await runner.start(jobId)
    } catch {
      // 预期路径：抛错说明有防护
    }
    await sleep(100)
    // 核心断言：作业不被执行
    expect(executed).toBe(false)
  })

  it('shutdown 后 enqueue 新作业不触发自动 start', async () => {
    let executed = false
    runner.registerHandler('n1.auto', async () => { executed = true })

    await runner.shutdown()

    // shutdown 后 enqueue
    try {
      await runner.enqueue('n1.auto', {}, {
        items: [{ libraryId: 1, imageId: 1 }],
      })
    } catch {
      // 如果 enqueue 本身抛错也可接受
    }
    await sleep(100)
    expect(executed).toBe(false)
  })

  it.fails('shutdown 等待运行中作业完成（不丢失正在执行的项）', async () => {
    const processed: number[] = []
    runner.registerHandler('n1.wait', async (item) => {
      await sleep(50)
      processed.push(item.imageId!)
    })

    const jobId = await runner.enqueue('n1.wait', {}, {
      items: [
        { libraryId: 1, imageId: 1 },
        { libraryId: 1, imageId: 2 },
      ],
    })
    await runner.start(jobId)
    // 不等待完成，立即 shutdown
    await runner.shutdown()

    // shutdown 应等待已开始的 executeJob 完成
    expect(processed.length).toBeGreaterThanOrEqual(1)
  })

  it('多次 shutdown 不抛错（幂等）', async () => {
    await runner.shutdown()
    await runner.shutdown()
    await runner.shutdown()
    // 不抛异常即通过
  })
})
