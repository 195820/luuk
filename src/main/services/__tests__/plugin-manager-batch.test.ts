import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 捕获式假对象（在 vi.mock 提升前声明于闭包，通过工厂引用）──
const handlers = new Map<string, (item: any) => Promise<unknown>>()
const rpc = vi.fn()
const getImagePath = vi.fn()
const getPlugin = vi.fn()

const fakeRunner = {
  registerHandler: vi.fn((kind: string, h: (item: any) => Promise<unknown>) => {
    handlers.set(kind, h)
  }),
}
const fakeHostProcess = {
  setMemoryThresholds: vi.fn(),
  onSdkCall: vi.fn(),
  ensureStarted: vi.fn().mockResolvedValue(undefined),
  rpc,
  isReady: vi.fn().mockReturnValue(true),
  shutdown: vi.fn().mockResolvedValue(undefined),
}
const fakeLoader = {
  discover: vi.fn().mockResolvedValue(undefined),
  getPlugins: vi.fn().mockReturnValue([]),
  getPlugin,
  setState: vi.fn(),
}

// ── 模块 mock：隔离 PluginManager 构造期的重量依赖 ──
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/luuk-pm-test' } }))
vi.mock('../settings-service', () => ({ getSetting: vi.fn(() => undefined) }))
vi.mock('../database', () => ({ getMasterDB: vi.fn(() => ({})) }))
vi.mock('../job-runner', () => ({ getJobRunner: () => fakeRunner }))
vi.mock('../image-service', () => ({ getImageService: () => ({ getImagePath }) }))
vi.mock('../../plugins/plugin-loader', () => ({
  PluginLoader: function () {
    return fakeLoader
  },
}))
vi.mock('../../plugins/plugin-host-process', () => ({
  PluginHostProcess: function () {
    return fakeHostProcess
  },
}))
vi.mock('../../plugins/plugin-sdk-host', () => ({
  PluginSdkHost: function () {
    return { handleCall: vi.fn() }
  },
}))
vi.mock('../memory-monitor', () => ({
  MemoryMonitor: function () {
    return {
      start: vi.fn(),
      stop: vi.fn(),
      isRed: vi.fn(() => false),
      getStatus: vi.fn(() => ({ level: 'green', rssMB: 0, threshold: { yellow: 1500, red: 2500 } })),
      on: vi.fn(),
    }
  },
}))
vi.mock('../model-manager', () => ({
  ModelManager: function () {
    return { registerModel: vi.fn(), verifyModel: vi.fn() }
  },
}))
vi.mock('../edits-service', () => ({
  EditsService: function () {
    return { createEdit: vi.fn() }
  },
}))

import { PluginManager } from '../plugin-manager'

describe('P0-1 · 批处理作业链闭合（registerOpHandlers）', () => {
  beforeEach(() => {
    handlers.clear()
    rpc.mockReset()
    getImagePath.mockReset()
    getPlugin.mockReset()
    // loader 报告一个含 op1 的插件
    getPlugin.mockReturnValue({
      manifest: { contributes: { ops: [{ id: 'op1' }] } },
    })
  })

  /** 构造 manager 并触发私有 registerOpHandlers */
  function register(): (item: any) => Promise<unknown> {
    const manager = new (PluginManager as any)()
    manager.registerOpHandlers('test.plugin')
    const h = handlers.get('ai.op1')
    expect(h).toBeTruthy()
    return h!
  }

  it('imageId 非空：解析绝对路径并以非空 paths 传给 Worker', async () => {
    getImagePath.mockReturnValue('D:/lib/set01/photo001.jpg')
    rpc.mockResolvedValue({ results: [{ path: 'x', editId: 1 }] })

    const handler = register()
    await handler({ id: 1, jobId: 'j1', libraryId: 7, imageId: 42, state: 'running', attempt: 0, error: null, updatedAt: '' })

    expect(getImagePath).toHaveBeenCalledWith(7, 42)
    expect(rpc).toHaveBeenCalledWith(
      'plugin.execute',
      expect.objectContaining({
        pluginId: 'test.plugin',
        opId: 'op1',
        input: { paths: ['D:/lib/set01/photo001.jpg'], libraryId: 7, imageId: 42 },
      }),
    )
  })

  it('插件返回 skipped:true：handler 抛错，使 job_item 落 failed（杜绝假成功）', async () => {
    getImagePath.mockReturnValue('D:/lib/set01/photo002.jpg')
    rpc.mockResolvedValue({ results: [], skipped: true })

    const handler = register()
    await expect(
      handler({ id: 2, jobId: 'j1', libraryId: 7, imageId: 43, state: 'running', attempt: 0, error: null, updatedAt: '' }),
    ).rejects.toThrow(/skipped/)
  })

  it('Worker rpc 抛错：向上传播（供 JobRunner 标记 failed）', async () => {
    getImagePath.mockReturnValue('D:/lib/set01/photo003.jpg')
    rpc.mockRejectedValue(new Error('Worker 崩溃'))

    const handler = register()
    await expect(
      handler({ id: 3, jobId: 'j1', libraryId: 7, imageId: 44, state: 'running', attempt: 0, error: null, updatedAt: '' }),
    ).rejects.toThrow('Worker 崩溃')
  })

  it('imageId 为 null（库级 op）：保留 { libraryId, item }，不解析路径', async () => {
    rpc.mockResolvedValue({ results: [] })

    const item = { id: 4, jobId: 'j1', libraryId: 9, imageId: null, state: 'running', attempt: 0, error: null, updatedAt: '' }
    const handler = register()
    await handler(item)

    expect(getImagePath).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith(
      'plugin.execute',
      expect.objectContaining({ input: { libraryId: 9, item } }),
    )
  })
})
