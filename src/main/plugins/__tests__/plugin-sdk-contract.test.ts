import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// settings-service 依赖 electron-store / app，测试内以内存实现替代
const store = new Map<string, unknown>()
vi.mock('../../services/settings-service', () => ({
  getSetting: (key: string) => store.get(key),
  setSetting: (key: string, value: unknown) => {
    store.set(key, value)
  },
}))

import { PluginSdkHost, PermissionError, NotImplementedError } from '../plugin-sdk-host'
import type { PluginInfo, WorkerToMainRequest } from '../../../types/plugin'

/** 构造可激活的插件信息 */
function pluginInfo(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    manifest: {
      id: 'p.test',
      name: 'Test',
      version: '1.0.0',
      apiVersion: '^1.0.0',
      kind: 'ai-transform',
      entry: 'index.js',
      capabilities: [],
      permissions: [],
    },
    state: 'activated',
    path: '/plugins/p.test',
    isBuiltin: true,
    ...overrides,
  } as PluginInfo
}

function req(method: string, params: unknown, pluginId = 'p.test'): WorkerToMainRequest {
  return { type: 'sdk-request', channel: 'worker-to-main', id: 1, method, pluginId, params }
}

describe('PluginSdkHost · 契约（G-1）', () => {
  let libRoot: string
  let host: PluginSdkHost
  let calls: Record<string, unknown[]>
  let fakeRunner: { enqueue: ReturnType<typeof vi.fn> }
  let fakeEdits: { createEdit: ReturnType<typeof vi.fn> }
  let fakeModels: { getModelInfo: ReturnType<typeof vi.fn>; getModelPath: ReturnType<typeof vi.fn>; verifyModel: ReturnType<typeof vi.fn> }
  let loader: { getPlugin: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    store.clear()
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-sdk-lib-'))
    calls = {}
    fakeRunner = { enqueue: vi.fn(async () => 'job-1') }
    fakeEdits = { createEdit: vi.fn(async () => 42) }
    fakeModels = {
      getModelInfo: vi.fn(() => ({ id: 'u2netp', state: 'downloaded' })),
      getModelPath: vi.fn(() => path.join(libRoot, 'u2netp.onnx')),
      verifyModel: vi.fn(async () => true),
    }
    loader = { getPlugin: vi.fn(() => pluginInfo({ manifest: { ...pluginInfo().manifest, permissions: ['fs.read.library', 'fs.write.output', 'edit.write', 'jobs', 'inference'] } })) }
    const db = { getLibraries: () => [{ rootPath: libRoot }] } as any
    host = new PluginSdkHost(loader as any, fakeRunner as any, fakeEdits as any, fakeModels as any, db)
  })

  // ── 权限：未激活插件 ──
  it('未激活插件拒绝一切调用', async () => {
    loader.getPlugin.mockReturnValue(pluginInfo({ state: 'idle' }))
    await expect(host.handleCall(req('sdk.fs.read', { path: path.join(libRoot, 'a.txt') }))).rejects.toThrow(PermissionError)
  })

  it('未知插件 id 拒绝', async () => {
    loader.getPlugin.mockReturnValue(undefined)
    await expect(host.handleCall(req('sdk.fs.read', { path: 'x' })).catch((e) => e)).resolves.toBeInstanceOf(PermissionError)
  })

  // ── 权限：声明外 API ──
  it('缺少权限的方法抛 PERMISSION_DENIED', async () => {
    loader.getPlugin.mockReturnValue(pluginInfo({ manifest: { ...pluginInfo().manifest, permissions: [] } }))
    await expect(host.handleCall(req('sdk.fs.read', { path: 'x' }))).rejects.toThrow(/缺少权限/)
  })

  it('edit.write 走 EditsService 并透传 Buffer', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const id = await host.handleCall(req('sdk.edit.write', { sourcePath: path.join(libRoot, 'a.jpg'), op: 'autotone.auto', outputBuffer: bytes, libraryId: 1, imageId: 2 }))
    expect(id).toBe(42)
    expect(fakeEdits.createEdit).toHaveBeenCalledOnce()
    const arg = fakeEdits.createEdit.mock.calls[0]
    expect(arg[0]).toBe(1)
    expect(arg[1]).toBe(2)
    expect(Buffer.isBuffer(arg[5])).toBe(true)
  })

  it('jobs.enqueue 转发 JobRunner', async () => {
    const jobId = await host.handleCall(req('sdk.jobs.enqueue', { kind: 'ai.x', payload: {}, opts: {} }))
    expect(jobId).toBe('job-1')
    expect(fakeRunner.enqueue).toHaveBeenCalledWith('ai.x', {}, {})
  })

  it('inference.resolveModel 返回本地路径（已下载）', async () => {
    const p = await host.handleCall(req('sdk.inference.resolveModel', { modelId: 'u2netp' }))
    expect(typeof p).toBe('string')
    expect(fakeModels.getModelPath).toHaveBeenCalledWith('u2netp')
  })

  it('inference.resolveModel 未下载且校验失败则抛错', async () => {
    fakeModels.getModelInfo.mockReturnValue({ id: 'u2netp', state: 'not-downloaded' })
    fakeModels.verifyModel.mockResolvedValue(false)
    await expect(host.handleCall(req('sdk.inference.resolveModel', { modelId: 'u2netp' }))).rejects.toThrow(/尚未下载/)
  })

  // ── settings 白名单 ──
  it('settings.get 非白名单键抛 PERMISSION_DENIED', async () => {
    await expect(host.handleCall(req('sdk.settings.get', { key: 'secret.key' }))).rejects.toThrow(PermissionError)
  })

  it('settings.set 白名单键写入内存', async () => {
    await host.handleCall(req('sdk.settings.set', { key: 'ai.enabled', value: true }))
    expect(store.get('ai.enabled')).toBe(true)
  })

  // ── 占位 API ──
  it('browser/fetch/mask 抛 NOT_IMPLEMENTED', async () => {
    for (const m of ['sdk.browser.navigate', 'sdk.fetch.request', 'sdk.mask.request']) {
      await expect(host.handleCall(req(m, {}))).rejects.toThrow(NotImplementedError)
    }
  })

  it('library.query 在 Phase 8 抛 NOT_IMPLEMENTED', async () => {
    loader.getPlugin.mockReturnValue(pluginInfo({ manifest: { ...pluginInfo().manifest, permissions: ['library.read'] } }))
    await expect(host.handleCall(req('sdk.library.query', {}))).rejects.toThrow(NotImplementedError)
  })

  // ── fs.read/write 真实往返 ──
  it('fs.write + fs.read 往返（库目录内）', async () => {
    const target = path.join(libRoot, 'sub', 'out.bin')
    await host.handleCall(req('sdk.fs.write', { path: target, data: new Uint8Array([9, 8, 7]) }))
    const back = (await host.handleCall(req('sdk.fs.read', { path: target }))) as Uint8Array
    expect(Array.from(back)).toEqual([9, 8, 7])
    calls.fs = [target]
  })

  // ── progress/log 无返回但吞掉 ──
  it('progress.report 与 log.* 返回 null 不抛错', async () => {
    await expect(host.handleCall(req('sdk.progress.report', { pct: 50, message: 'x' }))).resolves.toBeNull()
    await expect(host.handleCall(req('sdk.log.info', { msg: 'hi' }))).resolves.toBeNull()
  })
})
