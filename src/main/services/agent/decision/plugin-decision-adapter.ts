/**
 * T8 — Jev 决策适配器（DecisionProvider ↔ decision-provider 插件的桥）
 *
 * 实现与 LocalRulesProvider 相同的 DecisionProvider 接口，供升级链无差别调用（D6）：
 * - isRemote = true：受隐私护栏（T10）与开关约束
 * - judge() 前强制过滤 state/questions，敏感内容不出境（D9）
 * - 任何失败（未启用/无 Key/RPC 超时/插件崩溃）都抛错，由 DecisionRegistry 捕获后
 *   按「链尾优先」回落本地规则（W7），本适配器不自定义回落候选挑选规则
 */
import type {
  DecisionAnswer,
  DecisionContext,
  DecisionProvider,
  JevStatsSnapshot,
} from '../../../../types/agent'
import { logger } from '../../../../utils/logger'
import { JEV_OP_JUDGE, JEV_PLUGIN_ID } from '../../../plugins/builtins/jev-decision'
import { filterDecisionContextForRemote, type RejectedField } from './privacy-guard'

const LOG_KEY = 'JevDecisionAdapter'

/** Jev provider 在升级链中的标识（DecisionProvider.id，与插件 id 区分） */
export const JEV_PROVIDER_ID = 'jev'

/** 插件执行器：解耦 PluginManager（便于单测与 T16 无副作用接线） */
export type ExecuteOp = (pluginId: string, opId: string, input: unknown) => Promise<unknown>

export interface JevAdapterDeps {
  executeOp: ExecuteOp
  /** 插件是否已在插件管理器中启用 */
  isPluginEnabled: () => boolean
  /** feature flag jev.enabled */
  isFlagEnabled: () => boolean
  /** API Key 读取（仅主进程内存/electron-store，不下发渲染进程） */
  getApiKey: () => string
  /** 插件 id（测试可替换） */
  pluginId?: string
}

/** Jev 调用可观测计数（T20 设置页展示；内存态，重启归零） */
export type JevStats = JevStatsSnapshot

let stats: JevStats = { calls: 0, successes: 0, skipped: 0, failures: 0, filteredFields: 0 }

export function getJevStats(): JevStats {
  return { ...stats }
}

/** 重置计数（测试隔离用） */
export function resetJevStats(): void {
  stats = { calls: 0, successes: 0, skipped: 0, failures: 0, filteredFields: 0 }
}

function logRejected(rejected: RejectedField[]): void {
  if (rejected.length === 0) return
  const summary = rejected.map(r => `${r.path}(${r.reason})`).join('; ')
  logger.warn(LOG_KEY, `隐私护栏剔除 ${rejected.length} 个出站字段: ${summary}`)
}

export class JevDecisionAdapter implements DecisionProvider {
  readonly id = JEV_PROVIDER_ID
  readonly isRemote = true
  private readonly pluginId: string

  constructor(private deps: JevAdapterDeps) {
    this.pluginId = deps.pluginId ?? JEV_PLUGIN_ID
  }

  /** 三重开关：flag 开 && Key 非空 && 插件已启用 —— 任一不满足即不可用，升级链直接走本地 */
  async isAvailable(): Promise<boolean> {
    if (!this.deps.isFlagEnabled()) return false
    if (!this.deps.getApiKey()) return false
    return this.deps.isPluginEnabled()
  }

  async judge(ctx: DecisionContext): Promise<Record<string, DecisionAnswer>> {
    stats.calls++

    // isAvailable() 已过滤不可用场景，此处再兜一层：并发下开关可能被中途关掉
    if (!(await this.isAvailable())) {
      stats.skipped++
      throw new Error('Jev 未启用（开关/Key/插件任一未就绪）')
    }

    const { state, questions, rejected } = filterDecisionContextForRemote(ctx)
    stats.filteredFields += rejected.length
    logRejected(rejected)

    // 过滤后无可用内容：发出去的请求只会得到无意义判断，直接判不可用回落本地
    if (Object.keys(state).length === 0 || Object.keys(questions).length === 0) {
      stats.skipped++
      throw new Error('隐私护栏过滤后无可出站内容，回落本地规则')
    }

    try {
      const raw = await this.deps.executeOp(this.pluginId, JEV_OP_JUDGE, {
        state,
        questions,
        apiKey: this.deps.getApiKey(),
      })
      const answers = normalizeRpcResult(raw, questions)
      stats.successes++
      return answers
    } catch (err) {
      stats.failures++
      logger.warn(LOG_KEY, `Jev 判断失败，回落升级链下一环节: ${err}`)
      throw err
    }
  }
}

/**
 * RPC 返回值校验：必须是与 questions 同键的 DecisionAnswer 映射
 * 插件侧已完成规范化（choice/score/noul + confidence），此处只做结构兜底
 */
function normalizeRpcResult(
  raw: unknown,
  questions: DecisionContext['questions'],
): Record<string, DecisionAnswer> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Jev 插件返回非法（非对象）')
  }
  const map = raw as Record<string, unknown>
  const result: Record<string, DecisionAnswer> = {}
  for (const key of Object.keys(questions)) {
    const answer = map[key] as DecisionAnswer | undefined
    if (!answer || typeof answer !== 'object' || typeof answer.confidence !== 'number') {
      // 缺题即"这题 Jev 没把握"：0 置信触发门控回落，不放行半成品答案
      result[key] = { confidence: 0 }
    } else {
      result[key] = answer
    }
  }
  return result
}
