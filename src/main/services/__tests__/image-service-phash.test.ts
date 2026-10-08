/**
 * Phase 9 M5 · T25 — pHash 回填收编 JobRunner 单测（不经真 DB/原生链）：
 *  - startPhashBackfill：库校验、入队参数、空集短路、库级守卫复用、活动作业跨库独立
 *  - 进度兼容映射：JobRunner 进度 → 'phashProgress' 事件（remaining/percent 计算、终态退订+清守卫）
 *  - 处理器契约：computePhash → updatePhash；已删除跳过；失败 throw（记 failed 可续跑，不写空串）
 *  - stopPhashBackfill：逐库 cancel
 */
import path from 'path'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const state = vi.hoisted(() => ({
  // MasterDB.getLibrary 替身数据
  libraries: new Map<number, { id: number; rootPath: string }>(),
  // ThumbnailsDB 替身数据：libraryId → 无 phash 的 id 列表 / imageId → 相对路径
  idsWithoutPhash: [] as number[],
  relPaths: new Map<number, string>(),
  // 捕获面
  sendToRenderer: vi.fn(),
  updatePhash: vi.fn(),
  subscribeCallbacks: [] as Array<(p: any) => void>,
  cancelled: [] as string[],
  enqueueArgs: [] as Array<{ kind: string; payload: unknown; items?: Array<{ libraryId: number; imageId: number | null }> }>,
  started: [] as string[],
  registeredKinds: [] as string[],
}))

vi.mock('../../../utils/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

vi.mock('../../utils/ipc', () => ({
  sendToRenderer: (...args: unknown[]) => { state.sendToRenderer(...(args as [unknown, unknown])) },
}))

vi.mock('../../utils/phash', () => ({
  computePhash: vi.fn(async (p: string) => `hash:${p}`),
  hammingDistance: () => 0,
}))

vi.mock('../settings-service', () => ({
  getSetting: () => 256,
  setSetting: () => {},
}))

vi.mock('../cache', () => ({
  getLRUCache: () => ({}),
}))

const thumbsMock = {
  listImageIdsWithoutPhash: () => state.idsWithoutPhash,
  getImageRelativePath: (id: number) => state.relPaths.get(id) ?? null,
  updatePhash: (...args: unknown[]) => state.updatePhash(...(args as [number, string | null])),
}

vi.mock('../database', () => ({
  getMasterDB: () => ({
    getLibrary: (id: number) => state.libraries.get(id) ?? null,
  }),
  getThumbnailsDB: () => thumbsMock,
  closeThumbnailsDB: () => {},
  closeVectorsDB: () => {},
  closeAllDatabases: () => {},
}))

vi.mock('../job-runner', () => ({
  getJobRunner: () => ({
    registerHandler: (kind: string, handler: any) => {
      state.registeredKinds.push(kind)
      ;(state as any).handler = handler
    },
    enqueue: async (kind: string, payload: unknown, options?: { items?: any[] }) => {
      state.enqueueArgs.push({ kind, payload, items: options?.items })
      return 'job-1'
    },
    start: async (jobId: string) => { state.started.push(jobId) },
    cancel: async (jobId: string) => { state.cancelled.push(jobId) },
    subscribeProgress: (cb: (p: any) => void) => {
      state.subscribeCallbacks.push(cb)
      return () => {
        const i = state.subscribeCallbacks.indexOf(cb)
        if (i >= 0) state.subscribeCallbacks.splice(i, 1)
      }
    },
  }),
}))

// image-service 顶层 import 但 phash 路径不使用的面：仅占位
vi.mock('../thumbnailer', () => ({
  getThumbnailer: () => ({}),
  generateThumbnail: async () => ({}),
  getVideoMetadata: async () => (null),
  generateVideoThumbnail: async () => (null),
}))

vi.mock('../scanner', () => ({
  LibraryScanner: class {},
}))

import { ImageService } from '../image-service'

function makeService(): ImageService {
  return new ImageService()
}

beforeEach(() => {
  state.libraries.clear()
  state.libraries.set(7, { id: 7, rootPath: 'D:/lib7' })
  state.libraries.set(8, { id: 8, rootPath: 'D:/lib8' })
  state.idsWithoutPhash = [11, 12, 13]
  state.relPaths.clear()
  state.relPaths.set(11, 'a.jpg')
  state.relPaths.set(12, 'b.jpg')
  state.sendToRenderer.mockClear()
  state.updatePhash.mockClear()
  state.subscribeCallbacks.length = 0
  state.cancelled.length = 0
  state.enqueueArgs.length = 0
  state.started.length = 0
  state.registeredKinds.length = 0
  delete (state as any).handler
})

describe('startPhashBackfill — 入队与守卫', () => {
  it('库不存在：success false，不建作业', async () => {
    const svc = makeService()
    const res = await svc.startPhashBackfill(999)
    expect(res.success).toBe(false)
    expect(res.error).toContain('库不存在')
    expect(state.enqueueArgs).toHaveLength(0)
  })

  it('正常路径：enqueue image.phash-backfill（项级 items）→ start → 返回 jobId', async () => {
    const svc = makeService()
    const res = await svc.startPhashBackfill(7)
    expect(res).toEqual({ success: true, data: { jobId: 'job-1' } })
    expect(state.registeredKinds).toContain('image.phash-backfill')
    expect(state.enqueueArgs[0]).toEqual({
      kind: 'image.phash-backfill',
      payload: { libraryId: 7 },
      items: [
        { libraryId: 7, imageId: 11 },
        { libraryId: 7, imageId: 12 },
        { libraryId: 7, imageId: 13 },
      ],
    })
    expect(state.started).toEqual(['job-1'])
  })

  it('空集短路：无待处理项不建作业，直接广播 finished 事件', async () => {
    state.idsWithoutPhash = []
    const svc = makeService()
    const res = await svc.startPhashBackfill(7)
    expect(res).toEqual({ success: true })
    expect(state.enqueueArgs).toHaveLength(0)
    expect(state.sendToRenderer).toHaveBeenCalledWith('phashProgress', {
      libraryId: 7, done: 0, remaining: 0, percent: 100, finished: true,
    })
  })

  it('库级守卫：同库重复调用复用活跃 jobId，不重复入队', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    const res = await svc.startPhashBackfill(7)
    expect(res).toEqual({ success: true, data: { jobId: 'job-1' } })
    expect(state.enqueueArgs).toHaveLength(1)
  })

  it('取代旧全局单槽：另一库可独立启动作业', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    const res = await svc.startPhashBackfill(8)
    expect(res.success).toBe(true)
    expect(state.enqueueArgs).toHaveLength(2)
    expect(state.enqueueArgs[1].payload).toEqual({ libraryId: 8 })
  })
})

describe('startPhashBackfill — 进度兼容映射（D-3 保留 phashProgress 事件名）', () => {
  it('running 事件映射 done/remaining/percent；终态事件 finished 且退订、清守卫后可重新入队', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    expect(state.subscribeCallbacks).toHaveLength(1)
    const cb = state.subscribeCallbacks[0]

    cb({ jobId: 'other', state: 'running', total: 10, done: 1, failed: 0 })
    cb({ jobId: 'job-1', state: 'running', total: 10, done: 3, failed: 2 })
    expect(state.sendToRenderer).toHaveBeenLastCalledWith('phashProgress', {
      libraryId: 7, done: 3, remaining: 5, percent: 50, finished: false,
    })

    cb({ jobId: 'job-1', state: 'done', total: 10, done: 10, failed: 0 })
    expect(state.sendToRenderer).toHaveBeenLastCalledWith('phashProgress', {
      libraryId: 7, done: 10, remaining: 0, percent: 100, finished: true,
    })
    // 终态退订
    expect(state.subscribeCallbacks).toHaveLength(0)
    // 守卫已清：再次启动会建新作业（enqueue 仍返回 job-1 属替身行为，只断言调用次数）
    await svc.startPhashBackfill(7)
    expect(state.enqueueArgs).toHaveLength(2)
  })

  it('cancelled 与 failed 同样映射为 finished', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    const cb = state.subscribeCallbacks[0]
    cb({ jobId: 'job-1', state: 'cancelled', total: 4, done: 1, failed: 0 })
    expect(state.sendToRenderer).toHaveBeenLastCalledWith('phashProgress', {
      libraryId: 7, done: 1, remaining: 3, percent: 25, finished: true,
    })
  })
})

describe('image.phash-backfill 处理器契约', () => {
  it('计算写回：computePhash(rootPath/rel) → updatePhash', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    const handler = (state as any).handler
    await handler({ id: 1, jobId: 'job-1', libraryId: 7, imageId: 11, state: 'pending', attempt: 0, error: null })
    expect(state.updatePhash).toHaveBeenCalledWith(11, `hash:${path.join('D:/lib7', 'a.jpg')}`)
  })

  it('图片已删除（无相对路径）：跳过视为成功，不写库', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    const handler = (state as any).handler
    await handler({ id: 1, jobId: 'job-1', libraryId: 7, imageId: 404, state: 'pending', attempt: 0, error: null })
    expect(state.updatePhash).not.toHaveBeenCalled()
  })

  it('computePhash 失败：throw 交由 JobRunner 记 failed（可续跑，不写空串污染 phash）', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    const { computePhash } = await import('../../utils/phash')
    vi.mocked(computePhash).mockRejectedValueOnce(new Error('解码失败'))
    const handler = (state as any).handler
    await expect(
      handler({ id: 1, jobId: 'job-1', libraryId: 7, imageId: 11, state: 'pending', attempt: 0, error: null })
    ).rejects.toThrow('解码失败')
    expect(state.updatePhash).not.toHaveBeenCalled()
  })

  it('复合项 imageId=null：直接跳过', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    const handler = (state as any).handler
    await expect(
      handler({ id: 1, jobId: 'job-1', libraryId: 7, imageId: null, state: 'pending', attempt: 0, error: null })
    ).resolves.toBeUndefined()
  })
})

describe('stopPhashBackfill', () => {
  it('逐库取消活跃作业', async () => {
    const svc = makeService()
    await svc.startPhashBackfill(7)
    await svc.startPhashBackfill(8)
    svc.stopPhashBackfill()
    await Promise.resolve()
    // 两个库各建一个作业（替身同号 job-1）：断言发起了两次取消且无异常外抛
    expect(state.cancelled).toEqual(['job-1', 'job-1'])
  })

  it('无活跃作业：no-op 不抛', async () => {
    const svc = makeService()
    expect(() => svc.stopPhashBackfill()).not.toThrow()
    expect(state.cancelled).toHaveLength(0)
  })
})
