import { describe, it, expect, afterEach, vi } from 'vitest'
import os from 'os'

// 脱离 electron-store：默认路径不触碰磁盘；ensureAiLayer 测试均显式注入 isEnabled
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))
vi.mock('electron-store', () => ({
  default: class { get() { return false } set() {} },
}))

import { VectorsDB } from '../../database'
import { getVectorIndexService, closeAllVectorIndexServices } from '../../vectors/vector-index-service'
import { FakeEmbeddingEngine } from '../embedding-engine'
import { ensureAiLayer, getAiLayer, resetAiLayer } from '../ai-bootstrap'

describe('ensureAiLayer（Phase 9 M5 · T21 纯 DI，默认全关零引擎零网络）', () => {
  afterEach(() => {
    resetAiLayer()
    closeAllVectorIndexServices()
  })

  it('ai.enabled=false → 返回 null 且不构造引擎', () => {
    let built = false
    const layer = ensureAiLayer({
      isEnabled: () => false,
      engineFactory: () => { built = true; return new FakeEmbeddingEngine() },
    })
    expect(layer).toBeNull()
    expect(built).toBe(false)
    expect(getAiLayer()).toBeNull()
  })

  it('ai.enabled=true + 注入 FakeEngine → 装配出层，buildSessionDeps 绑定库', () => {
    const tmp = os.tmpdir()
    const layer = ensureAiLayer({
      isEnabled: () => true,
      engineFactory: () => new FakeEmbeddingEngine('fake-clip', 16),
      getVectorsDB: () => new VectorsDB(),
      getAnn: (p, dim) => getVectorIndexService(p, dim),
      resolvePath: (_lp, id) => `/img/${id}`,
    })
    expect(layer).not.toBeNull()
    expect(layer!.enabled).toBe(true)
    expect(layer!.modelId).toBe('fake-clip')
    expect(layer!.dim).toBe(16)
    expect(layer!.engine).toBeInstanceOf(FakeEmbeddingEngine)
    const deps = layer!.buildSessionDeps(tmp)
    expect(deps).not.toBeNull()
    expect(deps!.resolvePath(3)).toBe('/img/3')
    expect(deps!.engine.dim).toBe(16)
  })

  it('缺 getAnn → buildSessionDeps 返回 null（拒绝空跑）', () => {
    const layer = ensureAiLayer({
      isEnabled: () => true,
      engineFactory: () => new FakeEmbeddingEngine('fake-clip', 16),
      getVectorsDB: () => new VectorsDB(),
      resolvePath: () => '/x',
    })
    expect(layer!.buildSessionDeps(os.tmpdir())).toBeNull()
  })

  it('ai.enabled=true 但无 engineFactory → engine=null，buildSessionDeps 拒跑', () => {
    const layer = ensureAiLayer({ isEnabled: () => true })
    expect(layer).not.toBeNull()
    expect(layer!.engine).toBeNull()
    expect(layer!.modelId).toBe('clip-vit-b32-int8')
    expect(layer!.dim).toBe(512)
    expect(layer!.buildSessionDeps(os.tmpdir())).toBeNull()
  })

  it('flag 翻 false → 拆层并尽力 unload 已加载引擎', async () => {
    const engine = new FakeEmbeddingEngine('fake', 8)
    ensureAiLayer({ isEnabled: () => true, engineFactory: () => engine })
    await engine.load()
    expect(engine.isLoaded()).toBe(true)

    const after = ensureAiLayer({ isEnabled: () => false })
    expect(after).toBeNull()
    expect(getAiLayer()).toBeNull()
    expect(engine.unloads).toBe(1)
  })
})
