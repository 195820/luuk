/**
 * T11 — RequestExecutor 单测：§12.10 只识别与退让（403/429/503/验证页/challenge 特征），
 * 退避重试 ≤1 轮、robots 阻断、Cookie 注入、零抽取 streak。全注入 fake fetch，零真实网络。
 */
import { describe, it, expect } from 'vitest'
import { RequestExecutor, EMPTY_STREAK_THRESHOLD, type ExecutorFetch, type ExecutorFetchResponse } from '../request-executor'
import type { RequestPlan } from '../../../../types/agent'

function res(status: number, body = '{}', url?: string, contentType = 'application/json'): ExecutorFetchResponse {
  return { status, url: url ?? 'https://example.com/api', headers: { get: (n: string) => (n === 'content-type' ? contentType : null) }, text: async () => body }
}

function makeFetch(handler: (url: string, init?: any) => Promise<ExecutorFetchResponse>) {
  const calls: Array<{ url: string; init?: any }> = []
  const fetchImpl: ExecutorFetch = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { fetchImpl, calls }
}

const neverSleep = async () => {}
const plan = (url: string, over: Partial<RequestPlan> = {}): RequestPlan => ({ url, ...over })

function buildExecutor(handler: any, over: any = {}) {
  const { fetchImpl, calls } = makeFetch(handler)
  const exec = new RequestExecutor({
    fetchImpl,
    sleepImpl: over.sleepImpl ?? neverSleep,
    random: () => 0.5,
    respectRobots: over.respectRobots ?? false,
    getCookies: over.getCookies,
    limits: { perHost: 2, global: 4, delayMinMs: 0, delayMaxMs: 0, backoffMs: 0, ...over.limits },
  })
  return { exec, calls }
}

describe('RequestExecutor', () => {
  it('正常 200：返回响应文本（body 只传文本）', async () => {
    const { exec } = buildExecutor(async () => res(200, '{"ok":1}'))
    const out = await exec.executePlan(plan('https://example.com/api'))
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.response.body).toBe('{"ok":1}')
  })

  it('needsBrowser 计划被拒（应走浏览器层）', async () => {
    const { exec, calls } = buildExecutor(async () => res(200))
    const out = await exec.executePlan(plan('https://example.com/api', { needsBrowser: true }))
    expect(out.ok).toBe(false)
    expect(!out.ok && out.blocked).toContain('浏览器')
    expect(calls).toHaveLength(0)
  })

  it('403 即停：antiBot 且主机进入 degraded，后续计划直接挡下', async () => {
    const { exec, calls } = buildExecutor(async () => res(403))
    const first = await exec.executePlan(plan('https://example.com/a'))
    expect(!first.ok && first.antiBot?.kind).toBe('http-status')
    const second = await exec.executePlan(plan('https://example.com/b'))
    expect(!second.ok && second.antiBot?.kind).toBe('degraded-host')
    expect(calls.filter(c => !c.url.includes('robots'))).toHaveLength(1) // 第二次未发网络请求
  })

  it('429 退避后重试一次；仍 429 则 degraded（重试 ≤1 轮）', async () => {
    let n = 0
    const { exec } = buildExecutor(async () => { n++; return res(429) })
    const out = await exec.executePlan(plan('https://example.com/a'))
    expect(out.ok).toBe(false)
    expect(n).toBe(2) // 原始 + 一轮退避重试
    expect(exec.isDegraded('example.com')).toBeTruthy()
    // 重试后仍失败：不再给第三轮
    await exec.executePlan(plan('https://example.com/a'))
    expect(n).toBe(2)
  })

  it('429 重试成功：正常返回', async () => {
    let n = 0
    const { exec } = buildExecutor(async () => { n++; return n === 1 ? res(429) : res(200, 'fine') })
    const out = await exec.executePlan(plan('https://example.com/a'))
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.response.body).toBe('fine')
  })

  it('重定向到验证页 → redirect-challenge', async () => {
    const { exec } = buildExecutor(async () => res(200, '<html>…</html>', 'https://example.com/captcha?next=1'))
    const out = await exec.executePlan(plan('https://example.com/api'))
    expect(!out.ok && out.antiBot?.kind).toBe('redirect-challenge')
  })

  it('响应体含 challenge 特征 → challenge-body（不尝试求解）', async () => {
    const { exec } = buildExecutor(async () => res(200, '<html>Just a moment... checking your browser</html>', undefined, 'text/html'))
    const out = await exec.executePlan(plan('https://example.com/page'))
    expect(!out.ok && out.antiBot?.kind).toBe('challenge-body')
  })

  it('HTTP 412（bili 风控）→ http-status 退让', async () => {
    const { exec } = buildExecutor(async () => res(412, '', undefined, 'text/html'))
    const out = await exec.executePlan(plan('https://example.com/a'))
    expect(!out.ok && out.antiBot?.kind).toBe('http-status')
    expect(exec.isDegraded('example.com')).toBeTruthy()
  })

  it('HTTP 200 + JSON code=-352 → json-risk-code 退让（不硬闯）', async () => {
    const { exec } = buildExecutor(async () => res(200, '{"code":-352,"message":"risk control"}'))
    const out = await exec.executePlan(plan('https://example.com/wbi'))
    expect(!out.ok && out.antiBot?.kind).toBe('json-risk-code')
  })

  it('JSON code 正常（0/正数）或非 json 体不误判为反爬', async () => {
    const { exec } = buildExecutor(async () => res(200, '{"code":0,"data":[1,2]}'))
    const out = await exec.executePlan(plan('https://example.com/ok'))
    expect(out.ok).toBe(true)
  })

  it('连续零抽取达到阈值 → noteExtraction 触发退让', () => {
    const { exec } = buildExecutor(async () => res(200))
    for (let i = 0; i < EMPTY_STREAK_THRESHOLD - 1; i++) {
      expect(exec.noteExtraction('https://example.com/p', 0)).toBe(false)
    }
    expect(exec.noteExtraction('https://example.com/p', 0)).toBe(true)
    expect(exec.isDegraded('example.com')).toContain('零抽取')
    exec.noteExtraction('https://example.com/p', 5) // 有抽取即清零
    expect(exec.noteExtraction('https://example.com/p', 0)).toBe(false)
  })

  it('robots.txt Disallow 命中 → 不出网络请求直接 blocked', async () => {
    const clean = buildExecutor(async (url: string) =>
      url.endsWith('robots.txt')
        ? res(200, 'User-agent: *\nDisallow: /private', 'https://example.com/robots.txt')
        : res(200, 'x', url),
      { respectRobots: true })
    const out2 = await clean.exec.executePlan(plan('https://example.com/private/item'))
    expect(!out2.ok && out2.blocked).toContain('robots.txt')
    expect(clean.calls.filter(c => !c.url.endsWith('robots.txt'))).toHaveLength(0)
    // 允许路径照常出去
    const out3 = await clean.exec.executePlan(plan('https://example.com/public/item'))
    expect(out3.ok).toBe(true)
  })

  it('getCookies 注入 Cookie 头；plan 自带 Cookie 优先', async () => {
    const { exec, calls } = buildExecutor(async () => res(200), { getCookies: async () => 'sid=42' })
    await exec.executePlan(plan('https://example.com/a'))
    expect(calls[0].init.headers.Cookie).toBe('sid=42')

    const { exec: exec2, calls: calls2 } = buildExecutor(async () => res(200), { getCookies: async () => 'sid=42' })
    await exec2.executePlan(plan('https://example.com/a', { headers: { Cookie: 'mine=1' } }))
    expect(calls2[0].init.headers.Cookie).toBe('mine=1')
  })

  it('fetch 抛错 → error 结局（非 antiBot，不退让）', async () => {
    const { exec } = buildExecutor(async () => { throw new Error('ECONNRESET') })
    const out = await exec.executePlan(plan('https://example.com/a'))
    expect(!out.ok && out.error).toContain('ECONNRESET')
    expect(exec.isDegraded('example.com')).toBeNull()
  })
})
