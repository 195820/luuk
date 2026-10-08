import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { MasterDB } from '../../database'
import { JobRunner } from '../../job-runner'
import { AgentScheduler, AGENT_DISCOVERY_KIND, MIN_INTERVAL_MS } from '../agent-scheduler'
import type { JobItem } from '../../../../types'

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('AgentScheduler（T7 调度循环）', () => {
  let db: MasterDB
  let tempDir: string
  let runner: JobRunner
  let enabled: boolean
  let scheduler: AgentScheduler
  let handled: JobItem[]

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivsched-'))
    db = new MasterDB()
    db.initialize(tempDir)
    db.addLibrary('测试库', path.join(tempDir, 'library'))
    runner = new JobRunner(db)
    handled = []
    enabled = true
    runner.registerHandler(AGENT_DISCOVERY_KIND, async item => { handled.push(item) })
    scheduler = new AgentScheduler({
      getRunner: () => runner,
      isEnabled: () => enabled,
      getIntervalMs: () => 1000,
    })
  })

  afterEach(() => {
    scheduler.stop()
    vi.useRealTimers()
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('Agent 作业以 job 形态出现在 jobs 表，items 按来源展开', async () => {
    const [jobId] = await scheduler.triggerNow(1, [11, 12])
    expect(jobId).toBeTruthy()
    const job = db.getJob(jobId!)
    expect(job!.kind).toBe(AGENT_DISCOVERY_KIND)
    expect(job!.total).toBe(2)
    expect(JSON.parse(job!.payload as unknown as string)).toEqual({ libraryId: 1, sourceIds: [11, 12] })
    const items = db.getJobItems(jobId!)
    // 约定：image_id 复用为 source_id
    expect(items.map(i => i.imageId).sort()).toEqual([11, 12])
    await waitFor(() => db.getJob(jobId!)!.state === 'done')
    expect(handled).toHaveLength(2)
  })

  it('agent.enabled=false 时完全不调度', async () => {
    enabled = false
    expect(await scheduler.triggerNow(1, [11])).toEqual([])
    scheduler.registerPlanner(() => [{ libraryId: 1, sourceIds: [12] }])
    expect(await scheduler.runScheduled()).toEqual([])
    expect(db.getJobItems('anyway')).toEqual([])
    const jobs = db.getRawDb()!.prepare('SELECT COUNT(*) as n FROM jobs').get() as { n: number }
    expect(jobs.n).toBe(0)
  })

  it('手动触发（不带来源）也入队空作业，由处理器按 payload 自行发现', async () => {
    const [jobId] = await scheduler.triggerNow(1)
    expect(jobId).toBeTruthy()
    expect(db.getJob(jobId!)!.total).toBe(0)
    await waitFor(() => db.getJob(jobId!)!.state === 'done')
  })

  it('定时触发：interval 钳制到下限后 tick 调用 planner 并入队', async () => {
    vi.useFakeTimers()
    // harness 的 getIntervalMs=1000 低于下限，应被钳制到 MIN_INTERVAL_MS（S10：防 0/负数连发）
    scheduler.registerPlanner(() => [{ libraryId: 1, sourceIds: [21, 22] }])
    scheduler.start()
    expect(scheduler.isScheduled).toBe(true)

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS - 1)
    expect(db.getRawDb()!.prepare('SELECT id FROM jobs WHERE kind = ?').all(AGENT_DISCOVERY_KIND)).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    const rows = db.getRawDb()!
      .prepare('SELECT id FROM jobs WHERE kind = ?')
      .all(AGENT_DISCOVERY_KIND) as Array<{ id: string }>
    expect(rows.length).toBe(1)
    expect(db.getJobItems(rows[0].id).length).toBe(2)
    vi.useRealTimers()
  })

  it('同来源在途去重：作业未结束时重复触发被跳过，终态后可再次触发', async () => {
    // 共享 gate：release 前所有在途项挂起，release 后统一完成
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    runner.registerHandler(AGENT_DISCOVERY_KIND, () => gate)
    const [jobId] = await scheduler.triggerNow(1, [31])
    expect(scheduler.activeJobSources()[jobId]).toEqual([31])
    // 在途中：同来源跳过
    expect(await scheduler.triggerNow(1, [31])).toEqual([])
    // 不同来源仍可入队
    const [otherId] = await scheduler.triggerNow(1, [32])
    expect(otherId).toBeTruthy()
    release()
    await waitFor(() => db.getJob(jobId!)!.state === 'done')
    await waitFor(() => db.getJob(otherId!)!.state === 'done')
    expect(Object.keys(scheduler.activeJobSources())).toHaveLength(0)
    expect((await scheduler.triggerNow(1, [31])).length).toBe(1)
  })

  it('可取消：cancel 后作业转 cancelled 并从在途出账', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    runner.registerHandler(AGENT_DISCOVERY_KIND, () => gate)
    const [jobId] = await scheduler.triggerNow(1, [41])
    await runner.cancel(jobId!)
    release()
    await waitFor(() => db.getJob(jobId!)!.state === 'cancelled')
    expect(scheduler.activeJobSources()[jobId!]).toBeUndefined()
  })

  it('新信息源加入触发首次发现', async () => {
    const [jobId] = await scheduler.onSourceAdded(1, 51)
    expect(JSON.parse(db.getJob(jobId!)!.payload as unknown as string)).toEqual({ libraryId: 1, sourceIds: [51] })
  })

  it('未注册 planner 时定时触发为空跑不报错', async () => {
    expect(await scheduler.runScheduled()).toEqual([])
  })

  it('处理器抛错：单项失败不阻断，作业可查（JobRunner 语义）', async () => {
    runner.registerHandler(AGENT_DISCOVERY_KIND, () => { throw new Error('crawl failed') })
    const [jobId] = await scheduler.triggerNow(1, [61])
    await waitFor(() => db.getJob(jobId!)!.state === 'done')
    const failed = db.getJobItems(jobId!, 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toContain('crawl failed')
  })

  it('W3：start() 抛错时回滚在途登记并 cancel 残留作业，来源可再次被触发', async () => {
    const spy = vi.spyOn(runner, 'start').mockRejectedValueOnce(new Error('handler missing'))
    expect(await scheduler.triggerNow(1, [71])).toEqual([])
    expect(scheduler.activeJobSources()).toEqual({})
    const rows = db.getRawDb()!.prepare('SELECT id, state FROM jobs WHERE kind = ?')
      .all(AGENT_DISCOVERY_KIND) as Array<{ id: string; state: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('cancelled') // 残留 pending 作业已清理，不占位 jobs 表
    spy.mockRestore()
    // 未因旧登记的残留去重而被永久吞掉
    const [jobId] = await scheduler.triggerNow(1, [71])
    expect(jobId).toBeTruthy()
    await waitFor(() => db.getJob(jobId!)!.state === 'done')
  })

  it('W4：stop() 后手动触发仍能终态出账（订阅不随 stop 拆除）', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    runner.registerHandler(AGENT_DISCOVERY_KIND, () => gate)
    scheduler.stop()
    const [jobId] = await scheduler.triggerNow(1, [81])
    expect(jobId).toBeTruthy()
    expect(scheduler.activeJobSources()[jobId!]).toEqual([81])
    // 在途中同来源去重生效，且不会因停止过而永不出账
    expect(await scheduler.triggerNow(1, [81])).toEqual([])
    release()
    await waitFor(() => Object.keys(scheduler.activeJobSources()).length === 0)
    expect(db.getJob(jobId!)!.state).toBe('done')
  })
})
