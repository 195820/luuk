/**
 * T11 — CrawlerService 编排单测（纯逻辑，全注入 fake，零网络零窗口零 DB）
 * 覆盖：web-http 主流水线、反爬即停降级、pc-app 例外自跑、水位推进口径、
 *       needsBrowser 路由、buildRequests/parseResponse 返回规整、sink 未接线丢弃。
 */
import { describe, it, expect, vi } from 'vitest'
import { CrawlerService, type CrawlerServiceDeps } from '../crawler-service'
import type { CrawlSourceRecord, ConnectorType } from '../../../../types/agent'

function makeSource(over: Partial<CrawlSourceRecord> = {}): CrawlSourceRecord {
  return {
    id: 1, pluginId: 'builtin.demo', name: 'demo', enabled: true, health: 'ok',
    successRate: null, lastCrawlAt: null, createdAt: '2026-01-01',
    config: {
      connectorType: 'web-http' as ConnectorType,
      params: { keyword: 'sunset' },
      ops: { buildRequests: 'demo.buildRequests', parseResponse: 'demo.parseResponse' },
    },
    ...over,
  }
}

/** 可编排的 fake 执行器：按 url 返回预置结果 */
function fakeExecutor(planResults: Record<string, { ok: boolean; response?: any; antiBot?: any; error?: string; blocked?: string }>) {
  const extractionCalls: Array<{ url: string; count: number }> = []
  return {
    instance: {
      executePlan: vi.fn(async (plan: any) => {
        const r = planResults[plan.url] ?? { ok: true, response: { status: 200, url: plan.url, body: '{}' } }
        return r.ok
          ? { plan, ok: true, response: r.response }
          : { plan, ok: false, ...(r.antiBot ? { antiBot: r.antiBot } : {}), ...(r.error ? { error: r.error } : {}), ...(r.blocked ? { blocked: r.blocked } : {}) }
      }),
      noteExtraction: vi.fn((url: string, count: number) => {
        extractionCalls.push({ url, count })
        return false
      }),
    },
    extractionCalls,
  }
}

function fakeStore(source: CrawlSourceRecord | null) {
  return {
    get: vi.fn(() => source),
    commitRound: vi.fn(),
    setHealth: vi.fn(),
  }
}

function buildDeps(over: Partial<CrawlerServiceDeps> = {}): CrawlerServiceDeps {
  return {
    sourceStore: fakeStore(makeSource()) as any,
    executeOp: vi.fn(async () => ({ plans: [] })),
    executor: fakeExecutor({}).instance as any,
    ...over,
  }
}

describe('CrawlerService.runSource', () => {
  it('来源不存在抛结构性错误', async () => {
    const svc = new CrawlerService(buildDeps({ sourceStore: fakeStore(null) as any }))
    await expect(svc.runSource(99)).rejects.toThrow('信息源不存在')
  })

  it('来源停用：跳过且不出流', async () => {
    const store = fakeStore(makeSource({ enabled: false }))
    const executeOp = vi.fn()
    const svc = new CrawlerService(buildDeps({ sourceStore: store as any, executeOp }))
    const res = await svc.runSource(1)
    expect(res).toMatchObject({ plans: 0, candidates: 0, degraded: false })
    expect(executeOp).not.toHaveBeenCalled()
  })

  it('web-http 主流水线：buildRequests→执行→parseResponse→sink 入库', async () => {
    const store = fakeStore(makeSource())
    const executor = fakeExecutor({ 'https://a.com/p1': { ok: true, response: { status: 200, url: 'https://a.com/p1', body: '{}' } } })
    const drafts = [{ sourceUrl: 'https://a.com/item/1', tags: ['sunset'], mediaUrls: ['https://a.com/1.jpg'] }]
    const executeOp = vi.fn(async (_p, opId) =>
      opId === 'demo.buildRequests'
        ? { plans: [{ url: 'https://a.com/p1' }], nextWatermark: 'w2' }
        : opId === 'demo.parseResponse' ? drafts : undefined)
    const sink = { ingest: vi.fn(async () => 1) }
    const svc = new CrawlerService(buildDeps({
      sourceStore: store as any, executor: executor.instance as any, executeOp, sink,
    }))

    const res = await svc.runSource(1)
    expect(res).toMatchObject({ plans: 1, executed: 1, candidates: 1, ingested: 1, degraded: false, watermarkAdvanced: true })
    // 有 nextWatermark 且成功 → commitRound 带新水位
    expect(store.commitRound).toHaveBeenCalledWith(1, 'w2', 1)
    expect(sink.ingest).toHaveBeenCalledWith(makeSource(), drafts)
  })

  it('反爬信号：本轮即停、source 标 degraded、不推进水位、抛错给 JobRunner', async () => {
    const store = fakeStore(makeSource())
    const executor = fakeExecutor({
      'https://a.com/p1': { ok: false, antiBot: { kind: 'http-status', detail: 'HTTP 429' } },
    })
    const executeOp = vi.fn(async (_p, opId) =>
      opId === 'demo.buildRequests' ? { plans: [{ url: 'https://a.com/p1' }, { url: 'https://a.com/p2' }] } : [])
    const svc = new CrawlerService(buildDeps({
      sourceStore: store as any, executor: executor.instance as any, executeOp,
    }))

    // register() 里的 handler 会把 degraded 转成抛错；runSource 本身返回 degraded 结果
    const res = await svc.runSource(1)
    expect(res.degraded).toBe(true)
    expect(res.watermarkAdvanced).toBe(false)
    expect(store.setHealth).toHaveBeenCalledWith(1, 'degraded')
    expect(store.commitRound).not.toHaveBeenCalled()
    // 第二个计划因退让被跳过（executePlan 只调用一次）
    expect(executor.instance.executePlan).toHaveBeenCalledTimes(1)
  })

  it('退让时写 crawl_items.error 留档（§12.10）', async () => {
    const store = fakeStore(makeSource())
    const executor = fakeExecutor({
      'https://a.com/p1': { ok: false, antiBot: { kind: 'http-status', detail: 'HTTP 429' } },
    })
    const recordError = vi.fn()
    const executeOp = vi.fn(async (_p, opId) =>
      opId === 'demo.buildRequests' ? { plans: [{ url: 'https://a.com/p1' }] } : [])
    const svc = new CrawlerService(buildDeps({
      sourceStore: store as any, executor: executor.instance as any, executeOp, recordError,
    }))
    const res = await svc.runSource(1)
    expect(res.degraded).toBe(true)
    expect(recordError).toHaveBeenCalledWith(1, 'https://a.com/p1', 'HTTP 429')
  })

  it('部分页失败（500）：不推进水位（守"失败轮不跳内容"）', async () => {
    const store = fakeStore(makeSource())
    const executor = fakeExecutor({
      'https://a.com/p1': { ok: true, response: { status: 200, url: 'https://a.com/p1', body: '{}' } },
      'https://a.com/p2': { ok: true, response: { status: 500, url: 'https://a.com/p2', body: '' } },
      'https://a.com/p3': { ok: true, response: { status: 200, url: 'https://a.com/p3', body: '{}' } },
    })
    const drafts = [{ sourceUrl: 'https://a.com/item/1', tags: [], mediaUrls: ['https://a.com/1.jpg'] }]
    const executeOp = vi.fn(async (_p, opId) =>
      opId === 'demo.buildRequests'
        ? { plans: [{ url: 'https://a.com/p1' }, { url: 'https://a.com/p2' }, { url: 'https://a.com/p3' }], nextWatermark: 'w3' }
        : drafts)
    const sink = { ingest: vi.fn(async () => 1) }
    const svc = new CrawlerService(buildDeps({
      sourceStore: store as any, executor: executor.instance as any, executeOp, sink,
    }))
    const res = await svc.runSource(1)
    // 页 2 的 500 计入 errors → clean=false → 不推进（尽管 okCount=2>0）
    expect(res.watermarkAdvanced).toBe(false)
    expect(res.errors.some(e => e.includes('500'))).toBe(true)
    expect(store.commitRound).not.toHaveBeenCalled()
  })

  it('pc-app 例外：直接跑 discover，不经 HTTP 出口', async () => {
    const source = makeSource({ config: { connectorType: 'pc-app', params: {}, ops: { buildRequests: '', parseResponse: '', discover: 'tg.discover' } } })
    const store = fakeStore(source)
    const executor = fakeExecutor({})
    const executeOp = vi.fn(async (_p, opId) =>
      opId === 'tg.discover'
        ? { drafts: [{ sourceUrl: 'tg://msg/1', tags: [], mediaUrls: [] }], nextWatermark: '100' }
        : undefined)
    const sink = { ingest: vi.fn(async () => 1) }
    const svc = new CrawlerService(buildDeps({
      sourceStore: store as any, executor: executor.instance as any, executeOp, sink,
    }))

    const res = await svc.runSource(1)
    expect(res).toMatchObject({ candidates: 1, ingested: 1, watermarkAdvanced: true })
    expect(executeOp).toHaveBeenCalledWith('builtin.demo', 'tg.discover', expect.objectContaining({ watermark: null }))
    expect(executor.instance.executePlan).not.toHaveBeenCalled()
  })

  it('pc-app 缺 discover 声明：结构性抛错', async () => {
    const source = makeSource({ config: { connectorType: 'pc-app', params: {}, ops: { buildRequests: '', parseResponse: '' } } })
    const svc = new CrawlerService(buildDeps({ sourceStore: fakeStore(source) as any }))
    await expect(svc.runSource(1)).rejects.toThrow('未声明 ops.discover')
  })

  it('needsBrowser 计划：走浏览器层 runPlan，浏览器缺失则失败不裸 fetch', async () => {
    const browser = { runPlan: vi.fn(async (plan: any) => ({ status: 200, url: plan.url, body: '<html></html>', headers: {} })) }
    const executor = fakeExecutor({})
    const executeOp = vi.fn(async (_p, opId) =>
      opId === 'demo.buildRequests' ? { plans: [{ url: 'https://a.com/b1', needsBrowser: true }] } : [])
    const svc = new CrawlerService(buildDeps({
      executor: executor.instance as any, browser: browser as any, executeOp,
    }))
    await svc.runSource(1)
    expect(browser.runPlan).toHaveBeenCalled()
    expect(executor.instance.executePlan).not.toHaveBeenCalled()

    // 无浏览器层：该计划报错，不调 HTTP
    const svc2 = new CrawlerService(buildDeps({ executor: executor.instance as any, executeOp, browser: null }))
    const res2 = await svc2.runSource(1)
    expect(res2.errors[0]).toContain('浏览器')
  })

  it('parseResponse 全非法（缺 sourceUrl）→ 0 候选，但计划算成功', async () => {
    const store = fakeStore(makeSource())
    const executor = fakeExecutor({})
    const executeOp = vi.fn(async (_p, opId) =>
      opId === 'demo.buildRequests'
        ? { plans: [{ url: 'https://a.com/p1' }] }
        : [{ nope: 1 }, { sourceUrl: '' }])
    const svc = new CrawlerService(buildDeps({ sourceStore: store as any, executor: executor.instance as any, executeOp }))
    const res = await svc.runSource(1)
    expect(res.candidates).toBe(0)
    expect(res.executed).toBe(1)
  })

  it('有候选但 sink 未接线：丢弃且不入库', async () => {
    const executor = fakeExecutor({})
    const executeOp = vi.fn(async (_p, opId) =>
      opId === 'demo.buildRequests'
        ? { plans: [{ url: 'https://a.com/p1' }] }
        : [{ sourceUrl: 'https://a.com/x', tags: [], mediaUrls: [] }])
    const svc = new CrawlerService(buildDeps({ executor: executor.instance as any, executeOp, sink: null }))
    const res = await svc.runSource(1)
    expect(res.candidates).toBe(1)
    expect(res.ingested).toBe(0)
  })

  it('注册进 JobRunner：degraded 轮次抛错（让作业可见失败）', async () => {
    const store = fakeStore(makeSource())
    const executor = fakeExecutor({ 'https://a.com/p1': { ok: false, antiBot: { kind: 'http-status', detail: 'HTTP 403' } } })
    const executeOp = vi.fn(async (_p, opId) => opId === 'demo.buildRequests' ? { plans: [{ url: 'https://a.com/p1' }] } : [])
    const svc = new CrawlerService(buildDeps({ sourceStore: store as any, executor: executor.instance as any, executeOp }))
    const handlers = new Map<string, (item: any) => Promise<void>>()
    svc.register({ registerHandler: (k: string, h: (item: any) => Promise<void>) => handlers.set(k, h) } as any)
    const handler = handlers.get('agent.crawler-discovery')!
    await expect(handler({ imageId: 1 })).rejects.toThrow('反爬退让')
    await expect(handler({ imageId: null })).rejects.toThrow('imageId 缺失')
  })
})
