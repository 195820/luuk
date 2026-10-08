/**
 * T4 — DecisionRegistry（决策提供者注册与选择）
 * 升级链骨架（D6）：按注册顺序尝试 provider，置信度低于门控值时回落下一个；
 * LocalRulesProvider 恒可用，作为链尾兜底。Jev 的隐私护栏与开关在 T10 接入。
 */
import type {
  DecisionProvider,
  DecisionContext,
  DecisionAnswer,
  DecisionSource,
} from '../../../../types/agent'
import { logger } from '../../../../utils/logger'

const LOG_KEY = 'DecisionRegistry'

/** 单题最低可接受置信度：低于该值回落下一个 provider */
export const DECISION_GATE = {
  MIN_CONFIDENCE: 0.5,
} as const

export interface RegistryEntry {
  provider: DecisionProvider
  /** 该 provider 的答案映射到 Proposal.decisionSrc */
  source: DecisionSource
  /** 置信度门控，低于此值视为不可用并回落 */
  gate: number
}

/** provider 整体判断的置信度 = 各题置信度的最小值（木桶原则：任一题没把握就升级/回落） */
export function overallConfidence(answers: Record<string, DecisionAnswer>): number {
  const list = Object.values(answers)
  if (list.length === 0) return 0
  return Math.min(...list.map(a => a.confidence))
}

export class DecisionRegistry {
  private entries: RegistryEntry[] = []

  /** 注册 provider；同名 id 覆盖。remote provider 插到 local 之前（优先尝试） */
  register(entry: RegistryEntry): void {
    const existing = this.entries.findIndex(e => e.provider.id === entry.provider.id)
    if (existing >= 0) this.entries.splice(existing, 1, entry)
    else this.entries.push(entry)
    // 本地规则恒为链尾兜底，其余按注册顺序在前
    this.entries.sort((a, b) => Number(a.provider.id === 'local-rules') - Number(b.provider.id === 'local-rules'))
  }

  unregister(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter(e => e.provider.id !== id)
    return this.entries.length < before
  }

  list(): RegistryEntry[] {
    return [...this.entries]
  }

  get(id: string): RegistryEntry | undefined {
    return this.entries.find(e => e.provider.id === id)
  }

  /**
   * 沿升级链判断：Jev 高置信 → 本地规则回落。
   * 全部低于门控时回落链尾（层级最深，即本地规则）而非置信度最高者（W7）：
   * 未达自身门控的 Jev 结果不得冒用回落名义带出，decisionSrc 归因保持真实（D6/D9）。
   */
  async judge(
    ctx: DecisionContext,
  ): Promise<{ answers: Record<string, DecisionAnswer>; decisionSrc: DecisionSource; confidence: number } | null> {
    let fallback: { entry: RegistryEntry; answers: Record<string, DecisionAnswer>; confidence: number } | null = null
    for (const entry of this.entries) {
      try {
        if (!(await entry.provider.isAvailable())) continue
        const answers = await entry.provider.judge(ctx)
        const confidence = overallConfidence(answers)
        if (confidence >= entry.gate) {
          return { answers, decisionSrc: entry.source, confidence }
        }
        // 记录链上最后一个未达标结果：循环沿升级链向链尾推进，后到者层级更深、回落优先级更高
        fallback = { entry, answers, confidence }
      } catch (err) {
        logger.warn(LOG_KEY, `provider ${entry.provider.id} 判断失败，回落下一环节: ${err}`)
      }
    }
    if (fallback) {
      return { answers: fallback.answers, decisionSrc: fallback.entry.source, confidence: fallback.confidence }
    }
    return null // 无任何可用 provider：上层转人工
  }
}

/** 主进程共享单例：T16 主循环与 T10 升级链共用 */
let registryInstance: DecisionRegistry | null = null

export function getDecisionRegistry(): DecisionRegistry {
  if (!registryInstance) {
    registryInstance = new DecisionRegistry()
  }
  return registryInstance
}

/** 测试用：重置单例 */
export function resetDecisionRegistry(): void {
  registryInstance = null
}
