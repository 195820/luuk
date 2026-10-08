/**
 * T9 — builtin.jev-decision（Jev 云端决策插件）
 *
 * 职责：把宿主的 DecisionContext 翻译成 TypeSafe Jev（System One）请求，
 * 并把响应规范化回 DecisionAnswer。插件本身不含隐私过滤逻辑（D9 护栏在宿主侧 T10 强制）。
 *
 * API 事实（2026-09 调研）：
 *   POST https://api.typesafe.ai/v1/systemone，Authorization: Bearer <key>
 *   body 必填 state / model / questions；响应 answers 按问题回
 *   choice（choice+probabilities+confidence）/ score（score+confidence）/ noul（noul，**无 confidence**）
 */
import type { DecisionAnswer, DecisionQuestion } from '../../../../types/agent'

/** 插件与 op 标识（宿主适配器、Worker 注册表与 manifest 共用同一事实源） */
export const JEV_PLUGIN_ID = 'builtin.jev-decision'
export const JEV_OP_JUDGE = 'jev.judge'

/** System One 端点与模型名（导出以便单测断言请求形态） */
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'

/** Jev 调用超参：集中定义便于调参 */
export const JEV_PARAMS = {
  /** 含首次在内的总请求次数上限（429/529/5xx/网络错误才重试） */
  MAX_ATTEMPTS: 3,
  /** 指数退避基数：1s → 2s → 4s */
  BASE_BACKOFF_MS: 1000,
  /** 单次 HTTP 请求超时，超时即失败回落本地规则（D6 升级链不阻断） */
  TIMEOUT_MS: 5000,
} as const

/** 宿主经 executeOp 传入的判断请求（apiKey 由宿主注入，插件不落盘） */
export interface JevJudgeInput {
  state: Record<string, unknown>
  questions: Record<string, DecisionQuestion>
  apiKey: string
}

/** Jev 原始答案形态（不同问题类型字段各异，全部可选） */
export interface JevRawAnswer {
  type?: string
  choice?: string
  score?: number
  noul?: number
  probabilities?: Record<string, number>
  confidence?: number
}

/** Jev 原始响应 */
export interface JevRawResponse {
  model?: string
  answers?: Record<string, JevRawAnswer>
}

/** 可注入依赖（测试替换 fetch、退避等待与超时预算，避免单测真实等待） */
export interface JevDeps {
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  /** 单次请求超时（毫秒），默认 JEV_PARAMS.TIMEOUT_MS */
  timeoutMs?: number
  /** 总请求次数上限，默认 JEV_PARAMS.MAX_ATTEMPTS */
  maxAttempts?: number
  /** 退避基数（毫秒），默认 JEV_PARAMS.BASE_BACKOFF_MS */
  backoffMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** 数值钳位到 [0,1]，非法值返回 null */
function clamp01(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

/**
 * noul 置信折算：Jev 的 noul 不返回 confidence，
 * 以 |noul - 0.5| × 2 映射到与本地 provider 同尺度的置信度
 * （0.5 = 最不确定 → 0；0 或 1 = 最确定 → 1）
 */
export function noulConfidence(noul: number): number {
  return Math.abs(noul - 0.5) * 2
}

/** 构造 System One 请求体：三类问题形态与 DecisionQuestion 一一对应，直接透传 */
export function buildRequestBody(input: JevJudgeInput): Record<string, unknown> {
  return {
    state: input.state,
    model: JEV_MODEL,
    questions: input.questions,
  }
}

/**
 * 响应规范化：逐题对齐回 DecisionAnswer
 * - 缺失答案 / 选项越界 / 数值非法 → confidence 0（必然低于门控，由 Registry 回落链尾）
 * - 答案绝不超出给定选项或档位（D6 契约）
 */
export function normalizeAnswers(
  answers: Record<string, JevRawAnswer> | undefined,
  questions: Record<string, DecisionQuestion>,
): Record<string, DecisionAnswer> {
  const result: Record<string, DecisionAnswer> = {}
  for (const [key, question] of Object.entries(questions)) {
    const raw = answers?.[key]
    result[key] = raw ? normalizeOne(question, raw) : { confidence: 0 }
  }
  return result
}

function normalizeOne(question: DecisionQuestion, raw: JevRawAnswer): DecisionAnswer {
  switch (question.type) {
    case 'choice': {
      const options = Object.keys(question.criteria)
      const choice = raw.choice !== undefined && options.includes(raw.choice) ? raw.choice : undefined
      if (choice === undefined) {
        // 越界选项（或无选项集合）不可采信：置 0 置信触发回落
        return { probabilities: raw.probabilities, confidence: 0 }
      }
      return { choice, probabilities: raw.probabilities, confidence: clamp01(raw.confidence) ?? 0 }
    }
    case 'score': {
      const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : undefined
      if (score === undefined) return { confidence: 0 }
      return { score, probabilities: raw.probabilities, confidence: clamp01(raw.confidence) ?? 0 }
    }
    case 'noul': {
      const noul = clamp01(raw.noul)
      if (noul === null) return { confidence: 0 }
      return { noul, confidence: noulConfidence(noul) }
    }
  }
}

/** 可重试状态码：限流 / 过载 / 服务端错误 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 529 || status >= 500
}

/** 带超时的单次请求：超时主动 abort，不让悬挂的连接吃掉后续重试预算 */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fetchImpl(JEV_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error(`Jev 请求超时（${timeoutMs}ms）`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 调用 System One
 * - 401/422：配置/契约错误，立即失败（重试无意义）
 * - 429/529/5xx/网络错误：指数退避（1s → 2s → 4s），总次数受 maxAttempts 约束
 * - 单次请求 timeoutMs 超时：中断请求并直接失败，交上层回落本地规则
 */
export async function callSystemOne(
  body: Record<string, unknown>,
  apiKey: string,
  deps: JevDeps = {},
): Promise<JevRawResponse> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const sleep = deps.sleepImpl ?? defaultSleep
  const timeoutMs = deps.timeoutMs ?? JEV_PARAMS.TIMEOUT_MS
  const maxAttempts = deps.maxAttempts ?? JEV_PARAMS.MAX_ATTEMPTS
  const backoffMs = deps.backoffMs ?? JEV_PARAMS.BASE_BACKOFF_MS

  let lastError = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(fetchImpl, body, apiKey, timeoutMs)

      if (res.ok) {
        return (await res.json()) as JevRawResponse
      }
      if (!isRetryableStatus(res.status)) {
        // 不可重试：加前缀标记，供下面的分支判断直接上抛
        throw new Error(`Jev 请求失败（HTTP ${res.status}）：${await safeText(res)}`)
      }
      lastError = `HTTP ${res.status}`
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Jev 请求失败')) throw err
      lastError = err instanceof Error ? err.message : String(err)
    }

    if (attempt < maxAttempts) {
      await sleep(backoffMs * 2 ** (attempt - 1))
    }
  }
  throw new Error(`Jev 调用失败（已重试 ${maxAttempts} 次）：${lastError}`)
}

/** 错误正文可能回显请求内容，截断后再上抛，避免日志外泄 */
async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200)
  } catch {
    return ''
  }
}

/** op 入口：宿主经 plugin.execute('jev.judge') 调用 */
export async function judge(
  input: JevJudgeInput,
  deps: JevDeps = {},
): Promise<Record<string, DecisionAnswer>> {
  if (!input || typeof input !== 'object') throw new Error('jev.judge 输入非法')
  if (!input.apiKey) throw new Error('Jev API Key 未配置')
  const questionCount = Object.keys(input.questions ?? {}).length
  if (questionCount === 0) throw new Error('jev.judge 未提供任何问题')

  const response = await callSystemOne(buildRequestBody(input), input.apiKey, deps)
  return normalizeAnswers(response.answers, input.questions)
}

/** 插件激活：返回 op 注册表（约定见 plugin-registry.ts） */
export function activate(): Record<string, (input: unknown) => Promise<Record<string, DecisionAnswer>>> {
  return {
    [JEV_OP_JUDGE]: raw => judge(raw as JevJudgeInput),
  }
}
