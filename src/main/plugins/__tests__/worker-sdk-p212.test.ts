import { describe, it, expect, vi } from 'vitest'
import { createPluginSdk } from '../worker-sdk'

/** 假 InferencePool + 捕获式 callMain（不触及 onnxruntime：只测 createSession 与 run 的拒绝路径） */
function makeFakes() {
  const acquire = vi.fn(async (_modelId: string, modelPath: string) => ({
    inputNames: ['in'],
    outputNames: ['out'],
    _mp: modelPath,
  }))
  const run = vi.fn(async () => ({}))
  const destroy = vi.fn(async () => {})
  const pool = { acquire, run, destroy } as any
  const calls: Array<{ method: string; params: any; pluginId: string }> = []
  const callMain = vi.fn(async (method: string, params: any, pluginId: string) => {
    calls.push({ method, params, pluginId })
    if (method === 'sdk.inference.resolveModel') return '/main/resolved/m.onnx'
    return null
  })
  return { pool, acquire, run, callMain, calls }
}

describe('P2-12 · createSession 忽略外部 modelPath + run 权限/归属门', () => {
  it('createSession 忽略插件传入 modelPath，仅用主进程 resolveModel 路径，并透传 pluginId', async () => {
    const f = makeFakes()
    const sdk = createPluginSdk('pA', f.callMain as any, f.pool)
    const res = (await sdk.inference.createSession('m1', 'C:/evil/any.onnx')) as any

    const rm = f.calls.find((c) => c.method === 'sdk.inference.resolveModel')
    expect(rm).toBeTruthy()
    expect(rm!.pluginId).toBe('pA')
    // acquire 使用主进程解析路径，而非插件传入的越权路径
    expect(f.acquire.mock.calls[0][0]).toBe('m1')
    expect(f.acquire.mock.calls[0][1]).toBe('/main/resolved/m.onnx')
    expect(res.modelPath).toBe('/main/resolved/m.onnx')
  })

  it('run 未经本插件 createSession 的模型 → 未授权，且不调用 pool.run', async () => {
    const f = makeFakes()
    const sdk = createPluginSdk('pB', f.callMain as any, f.pool)
    await expect(sdk.inference.run('ghost', {}, {} as any)).rejects.toThrow(/未授权/)
    expect(f.run).not.toHaveBeenCalled()
  })

  it('跨插件隔离：pA 建立的会话 pB 不能直接 run（防无 inference 权限插件借用）', async () => {
    const f = makeFakes()
    const a = createPluginSdk('pA', f.callMain as any, f.pool)
    await a.inference.createSession('shared', '')
    const b = createPluginSdk('pB', f.callMain as any, f.pool)
    await expect(b.inference.run('shared', {}, {} as any)).rejects.toThrow(/未授权/)
    expect(f.run).not.toHaveBeenCalled()
  })
})
