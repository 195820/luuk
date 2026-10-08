/**
 * T8/T10 — Jev 决策适配器单测
 * 覆盖：三重开关、隐私护栏前置、RPC 结果结构兜底、可观测计数、
 *       以及升级链回归（Jev 低置信 → decisionSrc 仍归因 local；开关关闭零网络）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { DecisionAnswer, DecisionContext, PreferenceProfile } from '../../../../../types/agent'
import { JEV_OP_JUDGE } from '../../../../plugins/builtins/jev-decision'
import {
  JEV_PROVIDER_ID,
  JevDecisionAdapter,
  getJevStats,
  resetJevStats,
  type ExecuteOp,
} from '../plugin-decision-adapter'
import { DECISION_GATE, DecisionRegistry } from '../decision-registry'
import { LocalRulesProvider } from '../local-rules-provider'

const profile: PreferenceProfile = {
  libraryId: null,
  keywords: [
    { term: 'sunset', weight: 6 },
    { term: 'beach', weight: 3 },
  ],
  sourceAffinity: {},
  exclusions: { terms: [], sourceIds: [] },
  updatedAt: new Date().toISOString(),
}

const ctx: DecisionContext = {
  state: { tags: ['sunset', 'beach'], title: '金色时刻' },
  questions: {
    pick: { type: 'choice', instructions: '选一张', criteria: { sunset: '黄昏', portrait: '人像' } },
  },
}

interface OpCall {
  pluginId: string
  opId: string
  input: Record<string, unknown>
}

function makeAdapter(options: {
  flag?: boolean
  key?: string
  pluginEnabled?: boolean
  impl?: (input: unknown) => Promise<unknown>
}) {
  const calls: OpCall[] = []
  const executeOp: ExecuteOp = async (pluginId, opId, input) => {
    calls.push({ pluginId, opId, input: input as Record<string, unknown> })
    return options.impl ? options.impl(input) : Promise.reject(new Error('未提供实现'))
  }
  const adapter = new JevDecisionAdapter({
    executeOp,
    isFlagEnabled: () => options.flag ?? false,
    getApiKey: () => options.key ?? '',
    isPluginEnabled: () => options.pluginEnabled ?? false,
  })
  return { adapter, calls }
}

function jevAnswers(confidence: number): Record<string, DecisionAnswer> {
  return { pick: { choice: 'sunset', probabilities: { sunset: 0.9, portrait: 0.1 }, confidence } }
}

beforeEach(() => {
  resetJevStats()
})

describe('isAvailable（三重开关）', () => {
  it('flag / Key / 插件启用任一缺失即不可用', async () => {
    const cases = [
      { flag: true, key: 'k', pluginEnabled: true, expected: true },
      { flag: false, key: 'k', pluginEnabled: true, expected: false },
      { flag: true, key: '', pluginEnabled: true, expected: false },
      { flag: true, key: 'k', pluginEnabled: false, expected: false },
    ]
    for (const c of cases) {
      const { adapter } = makeAdapter(c)
      await expect(adapter.isAvailable()).resolves.toBe(c.expected)
    }
  })

  it('标识为远端 provider（受护栏与开关约束）', () => {
    const { adapter } = makeAdapter({})
    expect(adapter.id).toBe(JEV_PROVIDER_ID)
    expect(adapter.isRemote).toBe(true)
  })
})

describe('judge（出站与计数）', () => {
  it('开关关闭 → 直接抛错回落，executeOp 零调用（默认全关零网络）', async () => {
    const { adapter, calls } = makeAdapter({ flag: false, key: 'k', pluginEnabled: true })
    await expect(adapter.judge(ctx)).rejects.toThrow(/未启用/)
    expect(calls).toHaveLength(0)
    expect(getJevStats()).toMatchObject({ calls: 1, skipped: 1, successes: 0, failures: 0 })
  })

  it('出站前过滤敏感字段：插件只收到白名单元数据', async () => {
    const { adapter, calls } = makeAdapter({
      flag: true,
      key: 'secret-key',
      pluginEnabled: true,
      impl: async () => jevAnswers(0.9),
    })
    await adapter.judge({
      state: { tags: ['sunset'], filePath: 'E:\\lib\\a.jpg' },
      questions: ctx.questions,
    })

    const input = calls[0].input
    expect(calls[0].pluginId).toBe('builtin.jev-decision')
    expect(calls[0].opId).toBe(JEV_OP_JUDGE)
    expect(input.state).toEqual({ tags: ['sunset'] })
    expect(input.apiKey).toBe('secret-key')
    expect(getJevStats().filteredFields).toBe(1)
    expect(getJevStats().successes).toBe(1)
  })

  it('过滤后无可用内容 → 判不可用，不发请求', async () => {
    const { adapter, calls } = makeAdapter({ flag: true, key: 'k', pluginEnabled: true })
    await expect(
      adapter.judge({ state: { filePath: 'E:\\a.jpg' }, questions: ctx.questions }),
    ).rejects.toThrow(/无可出站内容/)
    expect(calls).toHaveLength(0)
    expect(getJevStats().skipped).toBe(1)
  })

  it('RPC 缺题 / 返回非法 → 置信度归 0 或抛错，交由升级链回落', async () => {
    const missing = makeAdapter({ flag: true, key: 'k', pluginEnabled: true, impl: async () => ({}) })
    await expect(missing.adapter.judge(ctx)).resolves.toEqual({ pick: { confidence: 0 } })

    const bad = makeAdapter({ flag: true, key: 'k', pluginEnabled: true, impl: async () => 'nope' })
    await expect(bad.adapter.judge(ctx)).rejects.toThrow(/返回非法/)
    expect(getJevStats()).toMatchObject({ failures: 1, successes: 1 })
  })

  it('插件抛错 → 计数 failures 并原样上抛（不自定义回落）', async () => {
    const boom = makeAdapter({
      flag: true,
      key: 'k',
      pluginEnabled: true,
      impl: () => Promise.reject(new Error('worker 已退出')),
    })
    await expect(boom.adapter.judge(ctx)).rejects.toThrow(/worker 已退出/)
    expect(getJevStats()).toMatchObject({ calls: 1, failures: 1 })
  })
})

describe('升级链集成回归（D6/W7/S9 归因真实）', () => {
  function registryWith(adapter: JevDecisionAdapter): DecisionRegistry {
    const registry = new DecisionRegistry()
    registry.register({ provider: adapter, source: 'jev', gate: DECISION_GATE.MIN_CONFIDENCE })
    registry.register({
      provider: new LocalRulesProvider(() => profile),
      source: 'local',
      gate: DECISION_GATE.MIN_CONFIDENCE,
    })
    return registry
  }

  it('Jev 高置信 → 采用 Jev 结果，decisionSrc = jev', async () => {
    const { adapter } = makeAdapter({
      flag: true,
      key: 'k',
      pluginEnabled: true,
      impl: async () => jevAnswers(0.92),
    })
    const res = await registryWith(adapter).judge(ctx)
    expect(res?.decisionSrc).toBe('jev')
    expect(res?.confidence).toBe(0.92)
  })

  it('Jev 低于门控 → 回落本地，decisionSrc 归因保持 local', async () => {
    const { adapter, calls } = makeAdapter({
      flag: true,
      key: 'k',
      pluginEnabled: true,
      impl: async () => jevAnswers(0.2),
    })
    const res = await registryWith(adapter).judge(ctx)
    expect(calls).toHaveLength(1)
    expect(res?.decisionSrc).toBe('local')
    expect(res?.answers.pick.choice).toBe('sunset')
    expect((res?.confidence ?? 0) >= DECISION_GATE.MIN_CONFIDENCE).toBe(true)
  })

  it('Jev 调用失败 → 本地兜底，链不阻断', async () => {
    const { adapter } = makeAdapter({ flag: true, key: 'k', pluginEnabled: true, impl: () => Promise.reject(new Error('529')) })
    const res = await registryWith(adapter).judge(ctx)
    expect(res?.decisionSrc).toBe('local')
  })

  it('Jev 未启用 → 升级链直接走本地，零网络', async () => {
    const { adapter, calls } = makeAdapter({ flag: false })
    const registry = new DecisionRegistry()
    registry.register({ provider: adapter, source: 'jev', gate: DECISION_GATE.MIN_CONFIDENCE })
    registry.register({
      provider: new LocalRulesProvider(() => profile),
      source: 'local',
      gate: DECISION_GATE.MIN_CONFIDENCE,
    })

    const res = await registry.judge(ctx)
    expect(calls).toHaveLength(0)
    expect(res?.decisionSrc).toBe('local')
  })
})
