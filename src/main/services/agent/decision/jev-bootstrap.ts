/**
 * T8/T10 — 决策层装配（Agent 启动时把 provider 挂进升级链）
 *
 * 升级链形态（D6）：Jev（远端，可选）→ LocalRules（本地，链尾兜底）。
 * 装配原则：
 * - 本地规则恒注册，与 Jev 是否可用无关；
 * - Jev 只在「flag 开 + Key 已填 + 插件可启用」三者齐备时入链，任一缺失即静默缺席
 *   （全链路零网络请求），不阻断 Agent；
 * - 门控沿用 DECISION_GATE.MIN_CONFIDENCE，回落挑选规则由 Registry 统一持有（W7），
 *   本模块不自定义任何回落逻辑。
 */
import type { PreferenceProfile } from '../../../../types/agent'
import { logger } from '../../../../utils/logger'
import { JEV_PLUGIN_ID } from '../../../plugins/builtins/jev-decision'
import { LocalRulesProvider } from './local-rules-provider'
import { DecisionRegistry, DECISION_GATE, getDecisionRegistry } from './decision-registry'
import { JevDecisionAdapter, JEV_PROVIDER_ID, type ExecuteOp } from './plugin-decision-adapter'

const LOG_KEY = 'JevBootstrap'

/** 插件能力接口（由 PluginManager 实现，经上层注入：本模块不直接依赖 electron） */
export interface JevBootstrapPlugin {
  setEnabled: (pluginId: string, enabled: boolean) => Promise<void>
  isEnabled: (pluginId: string) => boolean
  executeOp: ExecuteOp
}

export interface JevBootstrapSettings {
  jevEnabled: () => boolean
  jevApiKey: () => string
}

export interface JevBootstrapDeps {
  registry?: DecisionRegistry
  getProfile: () => PreferenceProfile
  plugin: JevBootstrapPlugin
  settings: JevBootstrapSettings
}

export interface JevBootstrapResult {
  /** 本地规则是否在链上（恒 true） */
  localRegistered: true
  /** Jev 是否成功入链 */
  jevRegistered: boolean
  /** Jev 未入链的原因（开关关闭时为 undefined，属正常态） */
  jevError?: string
}

/**
 * 装配升级链（幂等：可反复调用，同名 provider 覆盖注册）
 * T20 设置页改动 jev.enabled / apiKey 后重新调用即可生效
 */
export async function bootstrapDecisionLayer(deps: JevBootstrapDeps): Promise<JevBootstrapResult> {
  const registry = deps.registry ?? getDecisionRegistry()

  registry.register({
    provider: new LocalRulesProvider(deps.getProfile),
    source: 'local',
    gate: DECISION_GATE.MIN_CONFIDENCE,
  })

  if (!deps.settings.jevEnabled() || !deps.settings.jevApiKey()) {
    registry.unregister(JEV_PROVIDER_ID)
    return { localRegistered: true, jevRegistered: false }
  }

  try {
    await deps.plugin.setEnabled(JEV_PLUGIN_ID, true)
    registry.register({
      provider: new JevDecisionAdapter({
        executeOp: deps.plugin.executeOp,
        isPluginEnabled: () => deps.plugin.isEnabled(JEV_PLUGIN_ID),
        isFlagEnabled: deps.settings.jevEnabled,
        getApiKey: deps.settings.jevApiKey,
      }),
      source: 'jev',
      gate: DECISION_GATE.MIN_CONFIDENCE,
    })
    logger.info(LOG_KEY, `Jev 决策提供者已入链（门控 ${DECISION_GATE.MIN_CONFIDENCE}）`)
    return { localRegistered: true, jevRegistered: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(LOG_KEY, `Jev 入链失败，仅本地规则工作: ${message}`)
    registry.unregister(JEV_PROVIDER_ID)
    return { localRegistered: true, jevRegistered: false, jevError: message }
  }
}
