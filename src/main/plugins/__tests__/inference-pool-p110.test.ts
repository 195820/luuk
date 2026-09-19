import { describe, it, expect, vi } from 'vitest'
import { InferencePool, type SessionFactory } from '../inference-pool'

/** 构造可控的假会话工厂：记录 create 调用次数，支持延迟 resolve 以制造并发窗口 */
function makeFactory(delayMs = 0) {
  const created: any[] = []
  const factory: SessionFactory = async (_modelPath: string) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    const session = { _id: created.length, release: vi.fn() }
    created.push(session)
    return session
  }
  // InferencePool 构造参数为 () => SessionFactory（惰性获取）
  return { getFactory: () => factory, created }
}

describe('P1-10 · InferencePool 创建锁 + LRU + 按插件销毁', () => {
  it('并发双建：同名 modelId 并发 acquire 仅创建一个会话', async () => {
    const { getFactory, created } = makeFactory(20) // 制造并发窗口
    const pool = new InferencePool(4, getFactory)

    const [a, b] = await Promise.all([
      pool.acquire('m1', '/x/m1.onnx', undefined, 'pA'),
      pool.acquire('m1', '/x/m1.onnx', undefined, 'pA'),
    ])

    expect(created).toHaveLength(1) // 只建一次
    expect(a).toBe(b) // 返回同一会话
    expect(pool.stats()).toHaveLength(1)
  })

  it('不同 modelId 并发各自创建', async () => {
    const { getFactory, created } = makeFactory(10)
    const pool = new InferencePool(4, getFactory)

    await Promise.all([
      pool.acquire('m1', '/x/m1.onnx', undefined, 'pA'),
      pool.acquire('m2', '/x/m2.onnx', undefined, 'pB'),
    ])

    expect(created).toHaveLength(2)
    expect(pool.stats().map((s) => s.modelId).sort()).toEqual(['m1', 'm2'])
  })

  it('LRU：超过 maxSessions 时按最久未用驱逐空闲会话', async () => {
    const { getFactory } = makeFactory(0)
    const pool = new InferencePool(2, getFactory)

    await pool.acquire('m1', '/x/m1.onnx', undefined, 'pA')
    await new Promise((r) => setTimeout(r, 5))
    await pool.acquire('m2', '/x/m2.onnx', undefined, 'pA')
    await new Promise((r) => setTimeout(r, 5))
    // 触碰 m1，使 m2 成为最久未用
    await pool.acquire('m1', '/x/m1.onnx', undefined, 'pA')
    await new Promise((r) => setTimeout(r, 5))
    // 触发 m3 创建：应先驱逐最久未用的空闲会话（m2）
    await pool.acquire('m3', '/x/m3.onnx', undefined, 'pA')

    const ids = pool.stats().map((s) => s.modelId)
    expect(ids).toHaveLength(2)
    expect(ids).toContain('m1')
    expect(ids).toContain('m3')
    expect(ids).not.toContain('m2')
  })

  it('destroyByPlugin：仅释放该插件的空闲会话，不影响他插件', async () => {
    const { getFactory } = makeFactory(0)
    const pool = new InferencePool(4, getFactory)

    await pool.acquire('shared', '/x/shared.onnx', undefined, 'pA')
    await pool.acquire('other', '/x/other.onnx', undefined, 'pB')

    const released = pool.destroyByPlugin('pA')
    expect(released).toBe(1)
    const ids = pool.stats().map((s) => s.modelId)
    expect(ids).toEqual(['other'])
  })
})
