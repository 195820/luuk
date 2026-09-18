import { describe, it, expect, vi } from 'vitest'
import { InferencePool } from '../inference-pool'
import { serializeTensors } from '../worker-sdk'
import type { SerializedTensor } from '../../../types/plugin'

/** 注入一个可控假会话，记录并发与调用序 */
function inject(pool: InferencePool, modelId: string, runImpl: (feeds: unknown) => Promise<unknown>) {
  const anyPool = pool as any
  anyPool.sessions.set(modelId, {
    session: { run: vi.fn(runImpl) },
    refCount: 0,
    lastUsedAt: 0,
    residentMB: 0,
    ep: 'cpu',
  })
  return anyPool.sessions.get(modelId)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('反向 RPC / 推理池（G-5）', () => {
  it('serializeTensors 产出可跨进程结构', () => {
    const tensor = { type: 'float32', dims: [1, 3, 4, 4], data: new Float32Array(48) }
    const map = serializeTensors({ output: tensor as any })
    const t: SerializedTensor = map.output
    expect(t.dataType).toBe('float32')
    expect(t.dims).toEqual([1, 3, 4, 4])
    expect(t.data).toBeTruthy()
  })

  it('run 未知模型被拒绝', async () => {
    const pool = new InferencePool()
    await expect(pool.run('missing', {})).rejects.toThrow(/未找到/)
  })

  it('并发=1：任务串行执行，互不重叠', async () => {
    const pool = new InferencePool()
    let active = 0
    let peak = 0
    inject(pool, 'm', async () => {
      active++
      peak = Math.max(peak, active)
      await sleep(10)
      active--
      return { out: 1 }
    })

    await Promise.all([
      pool.run('m', { x: 1 }),
      pool.run('m', { x: 2 }),
      pool.run('m', { x: 3 }),
    ])
    expect(peak).toBe(1)
  })

  it('交互式队列优先于批处理队列', async () => {
    const pool = new InferencePool()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((res) => { release = res })
    inject(pool, 'm', async (feeds: any) => {
      order.push(feeds.tag)
      // 首个批处理任务阻塞，令后续任务入队，从而验证出队优先级
      if (feeds.tag === 'batch0') await gate
      return { out: 1 }
    })

    // 先跑一个批处理占位，令 running=true 并阻塞
    const first = pool.run('m', { tag: 'batch0' }, 'batch')
    await sleep(0) // batch0 已出队并开始执行
    // 排队：一个批处理 + 一个交互式
    const b = pool.run('m', { tag: 'batch1' }, 'batch')
    const i = pool.run('m', { tag: 'inter1' }, 'interactive')
    await sleep(0)
    release() // batch0 完成 → tryExecute 弹出下一项（interactive 优先）
    await Promise.all([first, b, i])

    // batch0 先执行（占用），释放后 interactive 应先于 batch1
    expect(order).toEqual(['batch0', 'inter1', 'batch1'])
  })

  it('evictOnMemoryPressure 仅回收空闲会话', () => {
    const pool = new InferencePool()
    const idle = inject(pool, 'idle', async () => ({}))
    const busy = inject(pool, 'busy', async () => ({}))
    busy.refCount = 1
    void idle
    pool.evictOnMemoryPressure()
    expect((pool as any).sessions.has('idle')).toBe(false)
    expect((pool as any).sessions.has('busy')).toBe(true)
  })

  it('stats 反映会话与 EP', () => {
    const pool = new InferencePool()
    inject(pool, 'm', async () => ({}))
    const s = pool.stats()
    expect(s).toHaveLength(1)
    expect(s[0].modelId).toBe('m')
    expect(s[0].ep).toBe('cpu')
  })
})
