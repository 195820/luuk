/**
 * Phase 9 M5 · T25 — 批量导出收编 JobRunner 单测（不经真 DB/原生链）：
 *  - exportBatchImages：同步校验（库/路径/空集）后入队即返，success + jobId
 *  - 复合处理器 onProgress 三职责：取消观察点（台账 cancelled → exportService.cancel + throw）、
 *    台账映射（四参 updateJobState）、UI 兼容 'export-progress' 事件（100ms 节流 + finished）
 *  - 收口清理：成功/取消后内存参数表（exportJobParams/exportBatchJobs）不泄漏
 *  - cancelExport：双路桥接（runner.cancel + exportService.cancel）
 *  - exportSingleImage：交互式不入队（保留旧直连语义，D-3 双通道原则）
 */
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => { mocks.handlers.set(channel, fn) },
    removeHandler: (channel: string) => { mocks.handlers.delete(channel) },
  },
}))

vi.mock('../../../utils/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

const state = vi.hoisted(() => ({
  libRoot: '',
  // 作业台账（内存替身：getJob/updateJobState 读写同源）
  jobStates: new Map<string, string>(),
  jobStateWrites: [] as Array<{ jobId: string; state: string; done?: number; failed?: number }>,
  exportBatchCalls: [] as Array<{ files: any[]; taskId: string }>,
  exportCancelTaskIds: [] as string[],
  sendToRenderer: vi.fn(),
  runnerCancel: vi.fn(async (_jobId: string) => {}),
  registered: null as null | ((item: any) => Promise<void>),
  enqueued: [] as Array<{ kind: string; payload: unknown; items?: any[] }>,
  started: [] as string[],
}))

vi.mock('../../services/file-service', () => ({
  FileService: class {
    renameFile = vi.fn()
    batchRename = vi.fn()
    moveFiles = vi.fn()
    copyFiles = vi.fn()
    deleteFiles = vi.fn()
    setWallpaper = vi.fn()
    showInExplorer = vi.fn()
  },
}))

vi.mock('../../services/database', () => ({
  getMasterDB: () => ({
    getLibrary: (id: number) => (id === 7 ? { id: 7, rootPath: state.libRoot } : null),
    getJob: (jobId: string) => (state.jobStates.has(jobId) ? { id: jobId, state: state.jobStates.get(jobId) } : null),
    updateJobState: (jobId: string, jobState: string, done?: number, failed?: number) => {
      state.jobStates.set(jobId, jobState)
      state.jobStateWrites.push({ jobId, state: jobState, done, failed })
    },
    getDeletedFiles: () => [],
  }),
}))

vi.mock('../../services/settings-service', () => ({
  getSetting: () => false,
  setSetting: () => {},
}))

vi.mock('../../services/job-runner', () => ({
  getJobRunner: () => ({
    registerHandler: (_kind: string, handler: (item: any) => Promise<void>) => { state.registered = handler },
    enqueue: async (kind: string, payload: unknown, options?: { items?: any[] }) => {
      state.enqueued.push({ kind, payload, items: options?.items })
      return 'job-x'
    },
    start: async (jobId: string) => { state.started.push(jobId) },
    cancel: (...args: unknown[]) => state.runnerCancel(...(args as [string])),
  }),
}))

vi.mock('../../utils/ipc', () => ({
  sendToRenderer: (...args: unknown[]) => { state.sendToRenderer(...(args as [unknown, unknown])) },
}))

// ExportService 动态 import 面替身（exportSingleImage/exportBatchImages 共用）
const exportServiceMock = {
  exportSingle: vi.fn(async () => 'out.jpg'),
  exportBatch: vi.fn(async (
    files: any[],
    _opts: any,
    taskId: string,
    onProgress: (done: number, total: number) => void
  ) => {
    state.exportBatchCalls.push({ files, taskId })
    // 模拟真实 zip 批次的 pending 过场：由用例驱动 tick（onProgress）与 finish（收口）；
    // 若不用例显式 finish，则保持 pending 直到 done 被 reject —— 保证 onProgress 内的 throw
    // 能沿 Promise 链传导（与真实 exportBatch 在 await 中调 onProgress 的语义一致）
    await new Promise<void>((resolve, reject) => {
      ;(state as any).progressTick = (d: number, t: number) => {
        try { onProgress(d, t) } catch (err) { reject(err) }
      }
      ;(state as any).progressFinish = resolve
    })
  }),
  cancel: vi.fn((taskId: string) => { state.exportCancelTaskIds.push(taskId) }),
}

vi.mock('../../services/export-service', () => ({
  ExportService: class {
    exportSingle = exportServiceMock.exportSingle
    exportBatch = exportServiceMock.exportBatch
    cancel = exportServiceMock.cancel
  },
}))

import { registerFileHandlers } from '../file-handlers'

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = mocks.handlers.get(channel)
  if (!fn) throw new Error(`未注册通道: ${channel}`)
  return fn(null, ...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  state.jobStates.clear()
  state.jobStateWrites.length = 0
  state.exportBatchCalls.length = 0
  state.exportCancelTaskIds.length = 0
  state.enqueued.length = 0
  state.started.length = 0
  state.registered = null
  delete (state as any).progressTick
  delete (state as any).progressFinish
  state.runnerCancel.mockClear()
  state.sendToRenderer.mockClear()
  exportServiceMock.exportBatch.mockClear()
  exportServiceMock.cancel.mockClear()
  state.libRoot = path.resolve(os.tmpdir(), 't25-lib')
  registerFileHandlers()
})

describe('exportBatchImages — 入队即返', () => {
  it('库不存在：success false，不建作业', async () => {
    const res = await call('exportBatchImages', 999, ['a.jpg'], {}, 'task-1')
    expect(res.success).toBe(false)
    expect(state.enqueued).toHaveLength(0)
  })

  it('越界路径：Access denied，不建作业', async () => {
    const res = await call('exportBatchImages', 7, ['../evil.jpg'], {}, 'task-1')
    expect(res.success).toBe(false)
    expect(res.error).toContain('Access denied')
    expect(state.enqueued).toHaveLength(0)
  })

  it('空列表：success false，不建作业', async () => {
    const res = await call('exportBatchImages', 7, [], {}, 'task-1')
    expect(res.success).toBe(false)
    expect(state.enqueued).toHaveLength(0)
  })

  it('正常路径：enqueue export.batch 单复合项 → start → 同步返回 jobId，不等待导出完成', async () => {
    const p = call('exportBatchImages', 7, ['a.jpg', 'b.jpg'], { format: 'jpg' }, 'task-1')
    const res = await p
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ jobId: 'job-x' })
    expect(state.enqueued[0]).toEqual({
      kind: 'export.batch',
      payload: { libraryId: 7, taskId: 'task-1' },
      items: [{ libraryId: 7, imageId: null }],
    })
    expect(state.started).toEqual(['job-x'])
  })

  it('入队后相对路径被解析为库内绝对路径（含 ZIP 条目名）', async () => {
    await call('exportBatchImages', 7, ['sub/a.jpg'], {}, 'task-1')
    const handler = state.registered!
    expect(handler).toBeTypeOf('function')
    // 通过处理器实际调用观察 files 形状（替身 pending 过场，finish 后 await 收口避免悬空 promise）
    state.jobStates.set('job-x', 'running')
    const done = handler({ jobId: 'job-x', libraryId: 7, imageId: null } as any)
    ;(state as any).progressFinish()
    await done
    expect(state.exportBatchCalls[0].files).toEqual([
      { absPath: path.resolve(state.libRoot, 'sub/a.jpg'), name: 'sub/a.jpg' },
    ])
  })
})

describe('export.batch 复合处理器 — onProgress 三职责', () => {
  async function startBatch(taskId = 'task-1') {
    await call('exportBatchImages', 7, ['a.jpg', 'b.jpg'], { format: 'jpg', outputPath: 'out.zip' }, taskId)
    state.jobStates.set('job-x', 'running')
    return state.registered!
  }

  it('成功收口：台账映射（running + done 递增）→ 完成事件 finished → 内存表清理', async () => {
    const handler = await startBatch()
    const done = handler({ jobId: 'job-x', libraryId: 7, imageId: null } as any)
    const tick = (state as any).progressTick as (d: number, t: number) => void
    tick(1, 2)
    tick(2, 2)
    ;(state as any).progressFinish()
    await done

    // ② 台账映射：仅 onProgress 回调写入（成功收口不再覆写台账，只复查 getJob 终态）
    const writes = state.jobStateWrites.filter(w => w.jobId === 'job-x')
    expect(writes).toEqual([
      { jobId: 'job-x', state: 'running', done: 1, failed: 0 },
      { jobId: 'job-x', state: 'running', done: 2, failed: 0 },
    ])
    // ③ UI 兼容事件：最后一必为收口补发的 finished（中间 tick 受 100ms 节流影响不断言数量）
    const events = state.sendToRenderer.mock.calls.filter(c => c[0] === 'export-progress').map(c => c[1])
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[events.length - 1]).toEqual({ taskId: 'task-1', done: 2, total: 2, finished: true })

    // 内存表清理：同 taskId 再次 cancelExport 不再有 jobId 桥接
    const res = await call('cancelExport', 'task-1')
    expect(res.success).toBe(true)
    expect(state.runnerCancel).not.toHaveBeenCalled()
  })

  it('取消观察点：台账 cancelled → exportService.cancel + handler 抛错 → 内存表清理', async () => {
    const handler = await startBatch('task-2')
    const done = handler({ jobId: 'job-x', libraryId: 7, imageId: null } as any)
    const tick = (state as any).progressTick as (d: number, t: number) => void
    // 模拟用户取消：JobRunner.cancel 同步写库 cancelled（替身等价行为）
    state.jobStates.set('job-x', 'cancelled')
    tick(1, 2)
    await expect(done).rejects.toThrow('导出已取消')
    // 抛错前不应进入成功收口写（只有取消前已发生的 tick 台账写，次数不限但状态均为 running）
    expect(state.jobStateWrites.every(w => w.state === 'running')).toBe(true)
    // 收口时替身仍 pending（reject 已传导），exportBatch 不会跑到成功收口
    expect(state.exportBatchCalls).toHaveLength(1)

    expect(state.exportCancelTaskIds).toContain('task-2')
    // 取消后内存表清理：cancelExport 不再桥接该 taskId
    await call('cancelExport', 'task-2')
    expect(state.runnerCancel).not.toHaveBeenCalled()
  })

  it('参数丢失（重启后误续跑）：静默跳过，不抛错', async () => {
    await call('exportBatchImages', 7, ['a.jpg'], {}, 'task-3')
    const handler = state.registered!
    await expect(handler({ jobId: 'job-unknown', libraryId: 7, imageId: null } as any)).resolves.toBeUndefined()
    expect(state.exportBatchCalls).toHaveLength(0)
  })
})

describe('cancelExport — 双路桥接', () => {
  it('活跃作业：先 runner.cancel（作业层）再 exportService.cancel（交互式）', async () => {
    await call('exportBatchImages', 7, ['a.jpg'], {}, 'task-4')
    const res = await call('cancelExport', 'task-4')
    expect(res.success).toBe(true)
    expect(state.runnerCancel).toHaveBeenCalledWith('job-x')
    expect(state.exportCancelTaskIds).toContain('task-4')
  })

  it('未知 taskId：仍走 exportService.cancel（单张导出取消路径），作业层不桥接', async () => {
    const res = await call('cancelExport', 'task-unknown')
    expect(res.success).toBe(true)
    expect(state.runnerCancel).not.toHaveBeenCalled()
    expect(state.exportCancelTaskIds).toContain('task-unknown')
  })

  it('runner.cancel 抛错：回退直接 cancel 仍返回 success', async () => {
    state.runnerCancel.mockRejectedValueOnce(new Error('boom'))
    await call('exportBatchImages', 7, ['a.jpg'], {}, 'task-5')
    const res = await call('cancelExport', 'task-5')
    expect(res.success).toBe(true)
    expect(state.exportCancelTaskIds).toContain('task-5')
  })
})

describe('exportSingleImage — 交互式不入队（双通道原则）', () => {
  it('直连 exportService.exportSingle，不建作业', async () => {
    const res = await call(
      'exportSingleImage',
      7,
      'a.jpg',
      { format: 'jpg', outputPath: path.resolve(state.libRoot, 'a.jpg') },
      'task-single'
    )
    expect(res.success).toBe(true)
    expect(res.outputPath).toBe('out.jpg')
    expect(state.enqueued).toHaveLength(0)
  })
})
