/**
 * T8/T10 — 决策层装配单测
 * 覆盖：本地规则恒注册、Jev 三条件齐备才入链、入链失败静默降级、
 *       重复装配幂等、链上顺序（本地恒为链尾）
 */
import { describe, it, expect } from 'vitest'
import type { PreferenceProfile } from '../../../../../types/agent'
import { JEV_PLUGIN_ID } from '../../../../plugins/builtins/jev-decision'
import { bootstrapDecisionLayer, type JevBootstrapDeps } from '../jev-bootstrap'
import { DECISION_GATE, DecisionRegistry } from '../decision-registry'
import { JEV_PROVIDER_ID } from '../plugin-decision-adapter'

const profile: PreferenceProfile = {
  libraryId: null,
  keywords: [{ term: 'sunset', weight: 6 }],
  sourceAffinity: {},
  exclusions: { terms: [], sourceIds: [] },
  updatedAt: new Date().toISOString(),
}

function makeDeps(options: {
  registry?: DecisionRegistry
  enabled?: boolean
  apiKey?: string
  setEnabledError?: Error
  executeResult?: unknown
}) {
  const calls: Array<{ pluginId: string; opId: string; enabled?: boolean }> = []
  const deps: JevBootstrapDeps = {
    registry: options.registry ?? new DecisionRegistry(),
    getProfile: () => profile,
    plugin: {
      setEnabled: async (pluginId, enabled) => {
        calls.push({ pluginId, opId: 'setEnabled', enabled })
        if (options.setEnabledError) throw options.setEnabledError
      },
      isEnabled: () => true,
      executeOp: async (pluginId, opId) => {
        calls.push({ pluginId, opId })
        return options.executeResult ?? { pick: { choice: 'sunset', confidence: 0.9 } }
      },
    },
    settings: {
      jevEnabled: () => options.enabled ?? false,
      jevApiKey: () => options.apiKey ?? '',
    },
  }
  return { deps, calls }
}

describe('bootstrapDecisionLayer', () => {
  it('开关关闭：本地规则恒在链上，Jev 不入链且不改动插件状态（零网络）', async () => {
    const { deps, calls } = makeDeps({ enabled: false, apiKey: 'k' })
    const res = await bootstrapDecisionLayer(deps)

    expect(res).toEqual({ localRegistered: true, jevRegistered: false })
    expect(calls).toHaveLength(0)
    expect(deps.registry?.get(JEV_PROVIDER_ID)).toBeUndefined()
    expect(deps.registry?.get('local-rules')?.source).toBe('local')
  })

  it('有开关无 Key：同样静默缺席（配置不完整不触网）', async () => {
    const { deps, calls } = makeDeps({ enabled: true, apiKey: '' })
    expect((await bootstrapDecisionLayer(deps)).jevRegistered).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('三条件齐备：启用插件并把 Jev 挂到本地规则之前', async () => {
    const { deps, calls } = makeDeps({ enabled: true, apiKey: 'k' })
    const res = await bootstrapDecisionLayer(deps)

    expect(res).toEqual({ localRegistered: true, jevRegistered: true })
    expect(calls).toEqual([{ pluginId: JEV_PLUGIN_ID, opId: 'setEnabled', enabled: true }])

    const list = deps.registry?.list() ?? []
    expect(list.map(e => e.provider.id)).toEqual([JEV_PROVIDER_ID, 'local-rules'])
    expect(list.map(e => e.source)).toEqual(['jev', 'local'])
    expect(list.every(e => e.gate === DECISION_GATE.MIN_CONFIDENCE)).toBe(true)
  })

  it('插件启用失败：降级为仅本地规则，并回传原因', async () => {
    const { deps } = makeDeps({
      enabled: true,
      apiKey: 'k',
      setEnabledError: new Error('插件系统未启用'),
    })
    const res = await bootstrapDecisionLayer(deps)

    expect(res.jevRegistered).toBe(false)
    expect(res.jevError).toBe('插件系统未启用')
    expect(deps.registry?.get(JEV_PROVIDER_ID)).toBeUndefined()
    expect(deps.registry?.get('local-rules')).toBeDefined()
  })

  it('重复装配幂等，且关闭开关后重新装配会摘除 Jev', async () => {
    const registry = new DecisionRegistry()
    const on = makeDeps({ registry, enabled: true, apiKey: 'k' })
    await bootstrapDecisionLayer(on.deps)
    await bootstrapDecisionLayer(on.deps)
    expect(registry.list().map(e => e.provider.id)).toEqual([JEV_PROVIDER_ID, 'local-rules'])

    const off = makeDeps({ registry, enabled: false, apiKey: 'k' })
    await bootstrapDecisionLayer(off.deps)
    expect(registry.get(JEV_PROVIDER_ID)).toBeUndefined()
    expect(registry.get('local-rules')).toBeDefined()
  })

  it('入链后的 Jev provider 确实经插件 executeOp 走 RPC', async () => {
    const { deps } = makeDeps({ enabled: true, apiKey: 'k' })
    await bootstrapDecisionLayer(deps)

    const entry = deps.registry?.get(JEV_PROVIDER_ID)
    const answers = await entry?.provider.judge({
      state: { tags: ['sunset'] },
      questions: { pick: { type: 'noul', instructions: '是否推荐' } },
    })
    expect(answers).toEqual({ pick: { choice: 'sunset', confidence: 0.9 } })
  })
})
