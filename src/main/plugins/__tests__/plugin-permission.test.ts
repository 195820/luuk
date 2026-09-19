import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const store = new Map<string, unknown>()
vi.mock('../../services/settings-service', () => ({
  getSetting: (key: string) => store.get(key),
  setSetting: (key: string, value: unknown) => void store.set(key, value),
}))

import { PluginSdkHost, PermissionError } from '../plugin-sdk-host'
import type { PluginInfo, WorkerToMainRequest, PluginPermission } from '../../../types/plugin'

function makeHost(libRoot: string, perms: PluginPermission[]) {
  const plugin: PluginInfo = {
    manifest: {
      id: 'p.perm', name: 'P', version: '1.0.0', apiVersion: '^1.0.0',
      kind: 'ai-transform', entry: 'index.js', capabilities: [], permissions: perms,
    },
    state: 'activated', path: '/x', isBuiltin: true,
  }
  const loader = { getPlugin: () => plugin } as any
  const runner = { enqueue: vi.fn(async () => 'j') } as any
  const edits = { createEdit: vi.fn(async () => 1) } as any
  const models = { getModelInfo: vi.fn(() => ({ id: 'm', state: 'downloaded' })), getModelPath: vi.fn(() => 'm.onnx'), verifyModel: vi.fn(async () => true) } as any
  const db = { getLibraries: () => [{ rootPath: libRoot }] } as any
  return new PluginSdkHost(loader, runner, edits, models, db)
}

function req(method: string, params: unknown): WorkerToMainRequest {
  return { type: 'sdk-request', channel: 'worker-to-main', id: 1, method, pluginId: 'p.perm', params }
}

describe('插件权限拒绝（G-2 · §5.11 三类违规）', () => {
  let libRoot: string
  let outside: string

  beforeEach(() => {
    store.clear()
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-perm-lib-'))
    outside = path.join(os.tmpdir(), 'luuk-perm-outside.txt')
    fs.writeFileSync(outside, 'secret')
  })

  // 违规类 1：声明外路径读写 → 拒绝（即便声明了 fs.read.library，路径在库外）
  it('类1 · 越界路径读取被拒', async () => {
    const host = makeHost(libRoot, ['fs.read.library'])
    await expect(host.handleCall(req('sdk.fs.read', { path: outside }))).rejects.toThrow(/路径越权/)
  })

  it('类1 · 越界路径写入被拒', async () => {
    const host = makeHost(libRoot, ['fs.write.output'])
    await expect(host.handleCall(req('sdk.fs.write', { path: outside, data: new Uint8Array([1]) }))).rejects.toThrow(/路径越权/)
  })

  it('类1 · 库内路径不被判越权（Windows 下大小写不敏感）', async () => {
    const inside = path.join(libRoot, 'a.txt')
    fs.writeFileSync(inside, 'ok')
    const host = makeHost(libRoot, ['fs.read.library'])
    // Windows 文件系统大小写不敏感，仅在 win32 校验大小写变体；其他平台校验原路径
    const probe = process.platform === 'win32' ? inside.toUpperCase() : inside
    const back = (await host.handleCall(req('sdk.fs.read', { path: probe }))) as Uint8Array
    expect(Buffer.from(back).toString()).toBe('ok')
  })

  // 违规类 2：自开 BrowserWindow（browser 域）→ 拒绝
  it('类2 · browser 域即使声明权限也拒绝', async () => {
    const host = makeHost(libRoot, ['browser' as PluginPermission])
    await expect(host.handleCall(req('sdk.browser.navigate', { url: 'https://x' }))).rejects.toThrow(/未实现/)
  })

  // 违规类 3：未声明 inference 权限却调推理路径解析 → PERMISSION_DENIED
  it('类3 · 未声明 inference 权限不得解析模型', async () => {
    const host = makeHost(libRoot, ['fs.read.library'])
    await expect(host.handleCall(req('sdk.inference.resolveModel', { modelId: 'm' }))).rejects.toThrow(PermissionError)
  })

  it('未声明 edit.write 权限拒绝写编辑', async () => {
    const host = makeHost(libRoot, ['fs.read.library'])
    await expect(host.handleCall(req('sdk.edit.write', { sourcePath: 'a', op: 'o', outputBuffer: new Uint8Array([1]) }))).rejects.toThrow(/缺少权限/)
  })

  // P1-4：edit.write 不得绕过路径守卫
  it('P1-4 · edit.write 越界 sourcePath 被路径守卫拒绝', async () => {
    const host = makeHost(libRoot, ['edit.write'])
    await expect(
      host.handleCall(req('sdk.edit.write', {
        libraryId: 1, imageId: 1, sourcePath: outside, op: 'autotone', outputBuffer: new Uint8Array([1]),
      })),
    ).rejects.toThrow(/路径越权/)
  })

  it('P1-4 · edit.write 库内 sourcePath 通过并落库', async () => {
    const inside = path.join(libRoot, 'in.jpg')
    fs.writeFileSync(inside, 'x')
    const host = makeHost(libRoot, ['edit.write'])
    const id = await host.handleCall(req('sdk.edit.write', {
      libraryId: 1, imageId: 1, sourcePath: inside, op: 'autotone', outputBuffer: new Uint8Array([1]),
    }))
    expect(id).toBe(1)
  })
})
