import { describe, it, expect } from 'vitest'
import type { DecisionProvider, DecisionContext, DecisionAnswer, PreferenceProfile } from '../../../../../types/agent'
import { LocalRulesProvider, LOCAL_RULES_PARAMS, flattenStateTokens } from '../local-rules-provider'
import { DecisionRegistry, overallConfidence, DECISION_GATE } from '../decision-registry'

function profile(partial: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    libraryId: null,
    keywords: [],
    sourceAffinity: {},
    exclusions: { terms: [], sourceIds: [] },
    updatedAt: new Date().toISOString(),
    ...partial,
  }
}

const sunsetProfile = profile({
  keywords: [
    { term: 'sunset', weight: 6 },
    { term: 'beach', weight: 3 },
  ],
  exclusions: { terms: ['watermark'], sourceIds: [] },
})

function providerFor(p: PreferenceProfile): LocalRulesProvider {
  return new LocalRulesProvider(() => p)
}

describe('LocalRulesProvider（T4）', () => {
  it('isAvailable 恒为 true（无外部依赖）', async () => {
    const provider = providerFor(sunsetProfile)
    await expect(provider.isAvailable()).resolves.toBe(true)
    expect(provider.id).toBe('local-rules')
    expect(provider.isRemote).toBe(false)
  })

  describe('choice 问题', () => {
    const ctx: DecisionContext = {
      state: { tags: ['sunset', 'golden hour'], title: 'sunset beach photo' },
      questions: {
        pick: { type: 'choice', instructions: '选一个分类', criteria: { landscape: '风光', portrait: '人像', food: '美食' } },
      },
    }

    it('关键词命中 → 选中最匹配选项、高置信', async () => {
      // landscape 选项描述含"风光"，关键词经描述命中：构造描述直接含画像词
      const ctxHit: DecisionContext = {
        state: { tags: ['sunset'] },
        questions: { pick: { type: 'choice', instructions: '', criteria: { a: 'sunset scene', b: 'other', c: null } } },
      }
      const answers = await providerFor(sunsetProfile).judge(ctxHit)
      expect(answers.pick.choice).toBe('a')
      expect(answers.pick.confidence).toBeGreaterThanOrEqual(DECISION_GATE.MIN_CONFIDENCE)
    })

    it('答案不超出给定选项', async () => {
      const answers = await providerFor(sunsetProfile).judge(ctx)
      expect(['landscape', 'portrait', 'food']).toContain(answers.pick.choice!)
    })

    it('无命中 → 低置信', async () => {
      const ctxMiss: DecisionContext = {
        state: { tags: ['unknown-term-xyz'] },
        questions: { pick: { type: 'choice', instructions: '', criteria: { a: null, b: null } } },
      }
      const answers = await providerFor(sunsetProfile).judge(ctxMiss)
      expect(answers.pick.confidence).toBe(LOCAL_RULES_PARAMS.NO_HIT_CONFIDENCE)
    })

    it('单选项问题命中也不恒过门控（S9 封顶）', async () => {
      const ctxSingle: DecisionContext = {
        state: { tags: ['sunset'] },
        questions: { pick: { type: 'choice', instructions: '', criteria: { a: 'sunset scene' } } },
      }
      const answers = await providerFor(sunsetProfile).judge(ctxSingle)
      expect(answers.pick.choice).toBe('a')
      expect(answers.pick.confidence).toBeLessThanOrEqual(LOCAL_RULES_PARAMS.SINGLE_OPTION_CAP)
      expect(answers.pick.confidence).toBeLessThan(DECISION_GATE.MIN_CONFIDENCE)
    })
  })

  describe('score 问题', () => {
    it('命中数映射到有序等级 0-1', async () => {
      const ctx: DecisionContext = {
        state: { tags: ['sunset', 'beach', 'unrelated'] },
        questions: { q: { type: 'score', instructions: '', criteria: ['sunset', 'portrait'] } },
      }
      const answers = await providerFor(sunsetProfile).judge(ctx)
      expect(answers.q.score).toBeCloseTo(0.5) // sunset 命中、portrait 未命中
      expect(answers.q.confidence).toBeGreaterThan(LOCAL_RULES_PARAMS.NO_HIT_CONFIDENCE)
    })
  })

  describe('noul 问题', () => {
    it('命中排除词 → noul 接近 0', async () => {
      const ctx: DecisionContext = {
        state: { tags: ['watermark'] },
        questions: { keep: { type: 'noul', instructions: '' } },
      }
      const answers = await providerFor(sunsetProfile).judge(ctx)
      expect(answers.keep.noul).toBe(LOCAL_RULES_PARAMS.NOUL_NEGATIVE)
    })

    it('命中正向关键词 → noul 接近 1', async () => {
      const ctx: DecisionContext = {
        state: { tags: ['sunset'] },
        questions: { keep: { type: 'noul', instructions: '' } },
      }
      const answers = await providerFor(sunsetProfile).judge(ctx)
      expect(answers.keep.noul).toBe(LOCAL_RULES_PARAMS.NOUL_POSITIVE)
    })

    it('无命中 → 中性且低置信', async () => {
      const ctx: DecisionContext = {
        state: { tags: ['nothing'] },
        questions: { keep: { type: 'noul', instructions: '' } },
      }
      const answers = await providerFor(sunsetProfile).judge(ctx)
      expect(answers.keep.noul).toBe(LOCAL_RULES_PARAMS.NOUL_NEUTRAL)
      expect(answers.keep.confidence).toBe(LOCAL_RULES_PARAMS.NO_HIT_CONFIDENCE)
    })
  })

  it('三类问题混合回答，结构合法', async () => {
    const ctx: DecisionContext = {
      state: { tags: ['sunset'] },
      questions: {
        c: { type: 'choice', instructions: '', criteria: { a: 'sunset', b: null } },
        s: { type: 'score', instructions: '', criteria: ['sunset'] },
        n: { type: 'noul', instructions: '' },
      },
    }
    const answers = await providerFor(sunsetProfile).judge(ctx)
    expect(Object.keys(answers).sort()).toEqual(['c', 'n', 's'])
    for (const a of Object.values(answers) as DecisionAnswer[]) {
      expect(a.confidence).toBeGreaterThanOrEqual(0)
      expect(a.confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('flattenStateTokens', () => {
  it('嵌套对象/数组中的字符串全部展平分词', () => {
    const tokens = flattenStateTokens({ a: 'Sunset Beach', b: ['Portrait', { c: '2024 Year' }] })
    expect([...tokens].sort()).toEqual(['2024', 'beach', 'portrait', 'sunset', 'year'])
  })
})

/** 测试用桩 provider */
function stubProvider(
  id: string,
  opts: { available?: boolean; confidence: number; remote?: boolean; throws?: boolean },
): DecisionProvider {
  return {
    id,
    isRemote: opts.remote ?? false,
    isAvailable: async () => opts.available ?? true,
    judge: async (): Promise<Record<string, DecisionAnswer>> => {
      if (opts.throws) throw new Error('provider boom')
      return { q: { confidence: opts.confidence, noul: 0.5 } }
    },
  }
}

describe('DecisionRegistry（升级链骨架）', () => {
  const ctx: DecisionContext = { state: {}, questions: { q: { type: 'noul', instructions: '' } } }

  it('高置信 remote 优先命中，decisionSrc 正确', async () => {
    const registry = new DecisionRegistry()
    registry.register({ provider: stubProvider('local-rules', { confidence: 0.9 }), source: 'local', gate: 0.5 })
    registry.register({ provider: stubProvider('jev', { confidence: 0.95, remote: true }), source: 'jev', gate: 0.8 })
    const result = await registry.judge(ctx)
    expect(result!.decisionSrc).toBe('jev')
  })

  it('remote 低置信 → 回落本地', async () => {
    const registry = new DecisionRegistry()
    registry.register({ provider: stubProvider('jev', { confidence: 0.3, remote: true }), source: 'jev', gate: 0.8 })
    registry.register({ provider: stubProvider('local-rules', { confidence: 0.9 }), source: 'local', gate: 0.5 })
    const result = await registry.judge(ctx)
    expect(result!.decisionSrc).toBe('local')
  })

  it('remote 不可用/抛错 → 回落本地，不阻断（D6）', async () => {
    for (const stub of [
      stubProvider('jev', { confidence: 0.99, remote: true, available: false }),
      stubProvider('jev', { confidence: 0.99, remote: true, throws: true }),
    ]) {
      const registry = new DecisionRegistry()
      registry.register({ provider: stub, source: 'jev', gate: 0.5 })
      registry.register({ provider: stubProvider('local-rules', { confidence: 0.6 }), source: 'local', gate: 0.5 })
      const result = await registry.judge(ctx)
      expect(result!.decisionSrc).toBe('local')
    }
  })

  it('全部低于门控：返回回落候选并原样带出低置信（上层转人工）', async () => {
    const registry = new DecisionRegistry()
    registry.register({ provider: stubProvider('local-rules', { confidence: 0.2 }), source: 'local', gate: 0.5 })
    const result = await registry.judge(ctx)
    expect(result!.decisionSrc).toBe('local')
    expect(result!.confidence).toBe(0.2)
  })

  it('全部低于门控：回落链尾（本地）而非置信度最高者，归因保持真实（W7）', async () => {
    const registry = new DecisionRegistry()
    // jev 未达自身门控（0.6 < 0.8）但高于 local 结果（0.4）：不得冒用回落名义带出 jev
    registry.register({ provider: stubProvider('jev', { confidence: 0.6, remote: true }), source: 'jev', gate: 0.8 })
    registry.register({ provider: stubProvider('local-rules', { confidence: 0.4 }), source: 'local', gate: 0.5 })
    const result = await registry.judge(ctx)
    expect(result!.decisionSrc).toBe('local')
    expect(result!.confidence).toBe(0.4)
  })

  it('无可用 provider → null', async () => {
    const registry = new DecisionRegistry()
    registry.register({ provider: stubProvider('jev', { confidence: 0.9, available: false }), source: 'jev', gate: 0.5 })
    expect(await registry.judge(ctx)).toBeNull()
  })

  it('local-rules 恒排链尾；同名注册覆盖', async () => {
    const registry = new DecisionRegistry()
    registry.register({ provider: stubProvider('local-rules', { confidence: 0.9 }), source: 'local', gate: 0.5 })
    registry.register({ provider: stubProvider('jev', { confidence: 0.9, remote: true }), source: 'jev', gate: 0.5 })
    expect(registry.list().map(e => e.provider.id)).toEqual(['jev', 'local-rules'])
    registry.register({ provider: stubProvider('jev', { confidence: 0.1, remote: true }), source: 'jev', gate: 0.99 })
    expect(registry.list()).toHaveLength(2)
    expect(registry.unregister('jev')).toBe(true)
    expect(registry.unregister('jev')).toBe(false)
  })

  it('overallConfidence 取各题最小值（木桶原则）', () => {
    expect(overallConfidence({ a: { confidence: 0.9 }, b: { confidence: 0.3 } })).toBe(0.3)
    expect(overallConfidence({})).toBe(0)
  })
})
