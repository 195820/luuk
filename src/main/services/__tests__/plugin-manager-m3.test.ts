import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 捕获式假对象（vi.mock 提升前声明，工厂引用）──
const seq: string[] = []
const rpc = vi.fn()
const ensureStarted = vi.fn().mockResolvedValue(undefined)
const getPlugin = vi.fn()

const fakeRunner = { registerHandler: vi.fn() }
const fakeHostProcess: any = {
  setMemoryThresholds: vi.fn(),
  onSdkCall: vi.fn(),
  ensureStarted,
  rpc,
  isReady: vi.fn().mockReturnValue(true),
  isCircuitBroken: vi.fn().mockReturnValue(false),
  shutdown: vi.fn().mockResolvedValue(undefined),
  onCircuitBreak: null,
  onWorkerExit: null,
}
const fakeLoader = {
  discover: vi.fn().mockResolvedValue(undefined),
  getPlugins: vi.fn().mockReturnValue([]),
  getPlugin,
  setState: vi.fn((_id: string, state: string) => {
    seq.push(`setState:${state}`)
  }),
}

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/luuk-pm-m3' } }))
vi.mock('../settings-service', () => ({ getSetting: vi.fn(() => undefined) }))
vi.mock('../database', () => ({ getMasterDB: vi.fn(() => ({})) }))
vi.mock('../job-runner', () => ({ getJobRunner: () => fakeRunner }))
vi.mock('../image-service', () => ({ getImageService: () => ({ getImagePath: vi.fn() }) }))
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
      isWorkerRed: vi.fn(() => false),
      getWorkerRssMB: vi.fn(() => 0),
      getStatus: vi.fn(() => ({ level: 'green', rssMB: 0, threshold: { yellow: 1500, red: 2500 } })),
      on: vi.fn(),
    }
  },
}))
vi.mock('../model-manager', () => ({
  ModelManager: function () {
    return { registerModel: vi.fn(), verifyModel: vi.fn(), listModels: vi.fn(() => []) }
  },
}))
vi.mock('../edits-service', () => ({
  EditsService: function () {
    return { createEdit: vi.fn() }
  },
}))

import { PluginManager } from '../plugin-manager'

function validPlugin() {
  return {
    state: 'valid',
    path: '/p/x',
    manifest: { entry: 'index.js', contributes: { ops: [] } },
  }
}

describe('M3 · PluginManager.setEnabled 顺序/回滚（P1-11/C3）+ Worker 崩溃自愈（P1-6）', () => {
  beforeEach(() => {
    seq.length = 0
    rpc.mockReset()
    ensureStarted.mockReset().mockResolvedValue(undefined)
    getPlugin.mockReset()
    fakeHostProcess.isReady.mockReturnValue(true)
    fakeHostProcess.isCircuitBroken.mockReturnValue(false)
  })

  it('启用成功：setState(activated) 在 plugin.load 之后（状态不先于加载）', async () => {
    getPlugin.mockReturnValue(validPlugin())
    rpc.mockImplementation(async (method: string) => {
      seq.push(`rpc:${method}`)
      return undefined
    })

    const m = new (PluginManager as any)()
    await m.setEnabled('x.plugin', true)

    expect(seq).toEqual(['rpc:plugin.load', 'setState:activated'])
    expect(m.loadedInWorker.has('x.plugin')).toBe(true)
    expect(m.enabledPlugins.has('x.plugin')).toBe(true)
  })

  it('启用失败（load 抛错）：不动 enabledPlugins，回滚 state 到 idle', async () => {
    getPlugin.mockReturnValue(validPlugin())
    rpc.mockRejectedValue(new Error('Worker 崩溃'))

    const m = new (PluginManager as any)()
    await expect(m.setEnabled('x.plugin', true)).rejects.toThrow('Worker 崩溃')

    expect(m.enabledPlugins.has('x.plugin')).toBe(false)
    expect(m.loadedInWorker.has('x.plugin')).toBe(false)
    expect(seq).toContain('setState:idle')
    expect(seq).not.toContain('setState:activated')
  })

  it('停用：isReady=false 时仍无条件清除 loadedInWorker 陈旧标记', async () => {
    getPlugin.mockReturnValue(validPlugin())
    rpc.mockResolvedValue(undefined)

    const m = new (PluginManager as any)()
    await m.setEnabled('x.plugin', true)
    expect(m.loadedInWorker.has('x.plugin')).toBe(true)

    // 模拟 Worker 崩溃后就绪态为 false
    fakeHostProcess.isReady.mockReturnValue(false)
    rpc.mockClear()
    await m.setEnabled('x.plugin', false)

    expect(m.loadedInWorker.has('x.plugin')).toBe(false)
    // isReady=false → 不发 unload RPC
    expect(rpc.mock.calls.some((c) => c[0] === 'plugin.unload')).toBe(false)
  })

  it('onWorkerExit：清空 loadedInWorker 并对启用中插件重新 plugin.load（自愈）', async () => {
    getPlugin.mockReturnValue(validPlugin())
    rpc.mockResolvedValue(undefined)

    const m = new (PluginManager as any)()
    await m.setEnabled('x.plugin', true)
    expect(m.loadedInWorker.has('x.plugin')).toBe(true)

    // Worker 崩溃退出 → 触发注册的自愈回调
    rpc.mockClear()
    fakeHostProcess.onWorkerExit(1)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(ensureStarted).toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith(
      'plugin.load',
      expect.objectContaining({ pluginId: 'x.plugin' }),
    )
    expect(m.loadedInWorker.has('x.plugin')).toBe(true)
  })
})
