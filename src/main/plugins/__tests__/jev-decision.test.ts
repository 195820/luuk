/**
 * T9 — builtin.jev-decision 单测
 * 覆盖：请求体构造、三类响应规范化与 noul 置信折算、退避/超时/鉴权、
 *       op 入口校验、activate() 约定、清单可被 PluginLoader 接受
 */
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect } from 'vitest'
import type { DecisionQuestion } from '../../../types/agent'
import {
  JEV_ENDPOINT,
  JEV_MODEL,
  JEV_OP_JUDGE,
  JEV_PARAMS,
  JEV_PLUGIN_ID,
  activate,
  buildRequestBody,
  callSystemOne,
  judge,
  normalizeAnswers,
  noulConfidence,
} from '../builtins/jev-decision'
import { PluginLoader } from '../plugin-loader'

const questions: Record<string, DecisionQuestion> = {
  pick: { type: 'choice', instructions: '选一个', criteria: { sunset: null, portrait: '人像' } },
  quality: { type: 'score', instructions: '打质量分', criteria: ['low', 'high'] },
  spam: { type: 'noul', instructions: '是否垃圾' },
}

const builtinsDir = path.resolve(__dirname, '../builtins')

/** 构造假 fetch Response（jsdom 下 Response 可用） */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function errorResponse(status: number, text = 'err'): Response {
  return new Response(text, { status })
}

/** 按序返回响应的假 fetch，同时记录每次调用 */
function fetchSequence(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit })
    const next = responses[Math.min(i, responses.length - 1)]
    i++
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  return { impl, calls }
}

/** 不真正等待的退避实现（避免单测耗时随退避基数增长） */
const noSleep = async () => {}

describe('buildRequestBody', () => {
  it('state/model/questions 三字段齐备，问题形态原样透传', () => {
    const body = buildRequestBody({ state: { tags: ['sunset'] }, questions, apiKey: 'k' })
    expect(body).toMatchObject({ model: JEV_MODEL, state: { tags: ['sunset'] } })
    expect((body.questions as Record<string, DecisionQuestion>).spam.type).toBe('noul')
  })
})

describe('normalizeAnswers（响应规范化）', () => {
  it('choice 命中选项：带出选中项与置信度', () => {
    const answers = normalizeAnswers(
      { pick: { choice: 'sunset', probabilities: { sunset: 0.8, portrait: 0.2 }, confidence: 0.85 } },
      questions,
    )
    expect(answers.pick).toEqual({
      choice: 'sunset',
      probabilities: { sunset: 0.8, portrait: 0.2 },
      confidence: 0.85,
    })
  })

  it('choice 返回越界选项 → 不可采信，置信度归 0 触发回落', () => {
    const answers = normalizeAnswers({ pick: { choice: 'anime', confidence: 0.99 } }, questions)
    expect(answers.pick.choice).toBeUndefined()
    expect(answers.pick.confidence).toBe(0)
  })

  it('score 透传分数', () => {
    const answers = normalizeAnswers({ quality: { score: 1.4, confidence: 0.7 } }, questions)
    expect(answers.quality).toMatchObject({ score: 1.4, confidence: 0.7 })
  })

  it('noul 无 confidence 字段 → 按 |noul-0.5|×2 折算到与本地同尺度', () => {
    const answers = normalizeAnswers({ spam: { noul: 0.95 } }, questions)
    expect(answers.spam.noul).toBe(0.95)
    expect(answers.spam.confidence).toBeCloseTo(0.9, 10)
    expect(noulConfidence(0.5)).toBe(0)
    expect(noulConfidence(0.05)).toBeCloseTo(0.9, 10)
    expect(noulConfidence(0)).toBeCloseTo(1, 10)
  })

  it('缺失答案 / 非法数值 → 置信度 0（答案不超出给定档位）', () => {
    const answers = normalizeAnswers({ quality: { score: Number.NaN } }, questions)
    expect(answers.quality.confidence).toBe(0)
    expect(answers.pick.confidence).toBe(0)
    expect(answers.spam.confidence).toBe(0)
  })

  it('置信度越界时钳位到 [0,1]', () => {
    const answers = normalizeAnswers({ quality: { score: 1, confidence: 3 } }, questions)
    expect(answers.quality.confidence).toBe(1)
  })
})

describe('callSystemOne（重试与失败路径）', () => {
  it('429 退避后成功', async () => {
    const { impl, calls } = fetchSequence([errorResponse(429), jsonResponse({ answers: { spam: { noul: 0.9 } } })])
    const res = await callSystemOne({ a: 1 }, 'key', { fetchImpl: impl, sleepImpl: noSleep })
    expect(res.answers?.spam.noul).toBe(0.9)
    expect(calls.length).toBe(2)
  })

  it('401 立即失败且不重试（配置错误重试无意义）', async () => {
    const { impl, calls } = fetchSequence([errorResponse(401, 'unauthorized')])
    await expect(callSystemOne({ a: 1 }, 'key', { fetchImpl: impl, sleepImpl: noSleep })).rejects.toThrow(/HTTP 401/)
    expect(calls.length).toBe(1)
  })

  it('持续 529 → 达到次数上限后失败', async () => {
    const { impl, calls } = fetchSequence([errorResponse(529)])
    await expect(callSystemOne({ a: 1 }, 'key', { fetchImpl: impl, sleepImpl: noSleep })).rejects.toThrow(/已重试/)
    expect(calls.length).toBe(JEV_PARAMS.MAX_ATTEMPTS)
  })

  it('退避序列为 1s → 2s（指数）', async () => {
    const { impl } = fetchSequence([errorResponse(429), errorResponse(429), jsonResponse({ answers: {} })])
    const sleeps: number[] = []
    await callSystemOne({ a: 1 }, 'key', {
      fetchImpl: impl,
      sleepImpl: async ms => {
        sleeps.push(ms)
      },
    })
    expect(sleeps).toEqual([JEV_PARAMS.BASE_BACKOFF_MS, JEV_PARAMS.BASE_BACKOFF_MS * 2])
  })

  it('请求悬挂 → 超时失败并带上超时预算', async () => {
    const hanging = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch
    await expect(
      callSystemOne({ a: 1 }, 'key', { fetchImpl: hanging, sleepImpl: noSleep, timeoutMs: 5, maxAttempts: 1 }),
    ).rejects.toThrow(/超时/)
  })

  it('端点与鉴权头按 API 约定构造', async () => {
    const { impl, calls } = fetchSequence([jsonResponse({ answers: { spam: { noul: 0.2 } } })])
    await callSystemOne({ state: {} }, 'secret-key', { fetchImpl: impl, sleepImpl: noSleep })
    expect(calls[0].url).toBe(JEV_ENDPOINT)
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer secret-key')
    expect(calls[0].init.method).toBe('POST')
  })
})

describe('judge（op 入口）', () => {
  it('端到端：三类问题各得合法答案', async () => {
    const { impl } = fetchSequence([
      jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          pick: { choice: 'portrait', probabilities: { portrait: 0.9 }, confidence: 0.9 },
          quality: { score: 1.8, confidence: 0.6 },
          spam: { noul: 0.02 },
        },
      }),
    ])
    const answers = await judge({ state: { tags: ['portrait'] }, questions, apiKey: 'k' }, { fetchImpl: impl, sleepImpl: noSleep })

    expect(answers.pick.choice).toBe('portrait')
    expect(answers.quality.score).toBe(1.8)
    expect(answers.spam).toEqual({ noul: 0.02, confidence: 0.96 })
  })

  it('无 Key / 无问题 / 非法输入 → 直接抛错（不触网）', async () => {
    let touched = 0
    const counting = (async () => {
      touched++
      return jsonResponse({ answers: {} })
    }) as unknown as typeof fetch

    await expect(judge({ state: {}, questions, apiKey: '' }, { fetchImpl: counting })).rejects.toThrow(/Key/)
    await expect(judge({ state: {}, questions: {}, apiKey: 'k' }, { fetchImpl: counting })).rejects.toThrow(/任何问题/)
    await expect(judge(null as never, { fetchImpl: counting })).rejects.toThrow(/输入非法/)
    expect(touched).toBe(0)
  })

  it('activate() 按 opId 暴露 jev.judge', () => {
    const ops = activate()
    expect(typeof ops[JEV_OP_JUDGE]).toBe('function')
    expect(Object.keys(ops)).toEqual([JEV_OP_JUDGE])
  })
})

describe('插件清单可被宿主接受（T9 验收项）', () => {
  it('builtin.jev-decision 通过 PluginLoader 校验，kind/权限/op 正确', async () => {
    const plugins = await new PluginLoader(builtinsDir).discover()
    const jev = plugins.find(p => p.manifest.id === JEV_PLUGIN_ID)

    expect(jev, `未发现在册的 ${JEV_PLUGIN_ID}`).toBeDefined()
    expect(jev?.state).toBe('valid')
    expect(jev?.manifest.kind).toBe('decision-provider')
    expect(jev?.manifest.permissions).toEqual(['fetch'])
    expect(jev?.manifest.capabilities).toContain('decision.jev')
    expect(jev?.manifest.contributes?.ops?.[0].id).toBe(JEV_OP_JUDGE)
    expect(jev?.isBuiltin).toBe(true)
  })

  it('清单文件本身可独立解析（无 BOM/注释），且 entry 实际存在', () => {
    const dir = path.join(builtinsDir, 'jev-decision')
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf-8'))
    expect(manifest.id).toBe(JEV_PLUGIN_ID)
    expect(fs.existsSync(path.join(dir, manifest.entry))).toBe(true)
  })
})
