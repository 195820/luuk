/**
 * T10 — Agent/Jev 相关 IPC 处理器与决策层装配入口
 *
 * 隐私约束（D9）：API Key 只写不读 —— 回给渲染进程的响应仅含 `hasKey: boolean`，
 * 明文 Key 不出主进程（发往插件的注入走主进程 → Worker RPC 的内部通路）。
 *
 * 本文件是决策层装配的**生产接线**（真实 PluginManager + settings），
 * 纯逻辑与可测部分在 jev-bootstrap.ts（依赖注入版）中。
 */
import { ipcMain } from 'electron'
import { logger } from '../../utils/logger'
import { getSetting, setSetting } from '../services/settings-service'
import { getPluginManager } from '../services/plugin-manager'
import { getMasterDB } from '../services/database'
import { PreferenceProfiler } from '../services/agent/preference-profiler'
import { AgentScheduler } from '../services/agent/agent-scheduler'
import { RecommendScorer } from '../services/agent/recommend-scorer'
import { getProposalStore } from '../services/agent/proposal-store'
import { FeedbackAggregator } from '../services/agent/feedback-aggregator'
import { importAcceptedCrawlerProposal } from '../services/agent/proposal-import'
import { getDecisionRegistry } from '../services/agent/decision/decision-registry'
import { bootstrapDecisionLayer } from '../services/agent/decision/jev-bootstrap'
import { getJevStats } from '../services/agent/decision/plugin-decision-adapter'
import { ensureCrawlerLayer, getCrawlerLayer, type CrawlerLayerDeps } from '../services/crawler/crawler-bootstrap'
import { getCrawlSourceStore, parseCrawlSourceConfig } from '../services/crawler/source-store'
import { getCrawlItemStore } from '../services/crawler/crawl-item-store'
import type { ProposalStage } from '../services/crawler/crawler-service'
import { getJobRunner } from '../services/job-runner'
import { getImageService } from '../services/image-service'
import { JEV_PLUGIN_ID } from '../plugins/builtins/jev-decision'
import { MIN_INTERVAL_MS } from '../services/agent/agent-scheduler'
import type { ProposalQuery, ProposalPage } from '../services/agent/proposal-store'
import type {
  AgentStatus,
  CandidateItem,
  CreateCrawlSourceInput,
  FeedbackAction,
  JevStatus,
  JevToggleResult,
  Proposal,
  AgentKind,
  CrawlSourceRecord,
} from '../../types/agent'

/** 画像重建节流（W8 生产接线口径：5 分钟） */
const PROFILE_REBUILD_THROTTLE_MS = 5 * 60 * 1000

/** 采集间隔上界（30 天）：与 MIN_INTERVAL_MS 配对钳制，防超大值触发 Node 定时器溢出（M5） */
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

let profiler: PreferenceProfiler | null = null

/** profiler 单例（T16 打分与全局画像共用同一节流/脏检查） */
function getProfiler(): PreferenceProfiler {
  if (!profiler) {
    profiler = new PreferenceProfiler(getMasterDB(), PROFILE_REBUILD_THROTTLE_MS)
  }
  return profiler
}

/** 全局画像惰性提供器（本地规则决策的判断依据） */
function getGlobalProfile() {
  return getProfiler().getProfile(null)
}

/** Jev 当前状态（不含任何 Key 明文） */
function jevStatus(): JevStatus {
  const pm = getPluginManager()
  const info = pm.getPluginInfo(JEV_PLUGIN_ID)
  return {
    enabled: getSetting('jev.enabled'),
    hasKey: getSetting('jev.apiKey').length > 0,
    pluginsEnabled: getSetting('plugins.enabled'),
    pluginEnabled: pm.isPluginEnabled(JEV_PLUGIN_ID),
    pluginState: info?.state ?? 'not-discovered',
    stats: getJevStats(),
  }
}

/** 用真实单例重新装配升级链（幂等；Jev 失败时本地规则仍在链尾兜底） */
async function reinitDecisionLayer(): Promise<JevToggleResult> {
  const pm = getPluginManager()
  const result = await bootstrapDecisionLayer({
    getProfile: getGlobalProfile,
    plugin: {
      setEnabled: (id, enabled) => pm.setEnabled(id, enabled),
      isEnabled: id => pm.isPluginEnabled(id),
      executeOp: (id, op, input) => pm.executeOp(id, op, input),
    },
    settings: {
      jevEnabled: () => getSetting('jev.enabled'),
      jevApiKey: () => getSetting('jev.apiKey'),
    },
  })
  return { ...jevStatus(), jevRegistered: result.jevRegistered, jevError: result.jevError }
}

/**
 * 启动时装配升级链（仅当 jev.enabled 为真才尝试入链 Jev，默认关 → 零网络请求）
 * 失败不阻断启动：错误仅记日志，本地规则照常工作
 */
export async function ensureAgentDecisionLayer(): Promise<void> {
  if (!getSetting('jev.enabled')) return
  const result = await reinitDecisionLayer()
  if (!result.jevRegistered) {
    logger.warn('AgentHandlers', `Jev 未入链：${result.jevError ?? '条件未齐备'}`)
  } else {
    logger.info('AgentHandlers', 'Jev 决策提供者已入链')
  }
}

/**
 * T11 — 爬虫层启动装配（crawler.enabled 默认关闭 → 零对象构造零窗口零网络）
 * T16 起同时接上调度侧：planner 注册 + agent.enabled 控制定时开关。
 */
export function ensureCrawlerLayerOnBoot(): void {
  if (!getSetting('crawler.enabled')) return
  ensureCrawlerLayer(crawlerLayerDeps())
  wireCrawlerScheduler()
}

// ── T16 采集主循环生产接线：调度器单例 + 下载根/提案段解析 ──

let scheduler: AgentScheduler | null = null

function getAgentScheduler(): AgentScheduler {
  if (!scheduler) {
    scheduler = new AgentScheduler({
      getRunner: getJobRunner,
      isEnabled: () => getSetting('agent.enabled'),
      getIntervalMs: () => getSetting('agent.intervalMs'),
    })
  }
  return scheduler
}

/** 当前在线库：下载落盘根与提案归属（无在线库 → 流水线各环节自行安全降级） */
function onlineLibrary(): { id: number; rootPath: string } | null {
  return getMasterDB().getLibraries().find(l => l.status === 'online') ?? null
}

/** 打分提案段：画像一律经 profiler（含 learnedDeltas，不绕过）、决策走 Registry 统一入口 */
function buildProposalStage(): ProposalStage {
  const scorer = new RecommendScorer({
    getProfile: libraryId => getProfiler().getProfile(libraryId),
    registry: getDecisionRegistry(),
    proposals: getProposalStore(getMasterDB()),
    hasPendingProposal: sourceUrl => getProposalStore(getMasterDB()).hasPendingForSourceUrl(sourceUrl),
  })
  return { propose: (source, drafts, libraryId) => scorer.propose(source, drafts, libraryId) }
}

function crawlerLayerDeps(): CrawlerLayerDeps {
  return {
    masterDb: getMasterDB(),
    getRunner: getJobRunner,
    pluginManager: getPluginManager(),
    isEnabled: () => getSetting('crawler.enabled'),
    getDownloadRoot: () => onlineLibrary()?.rootPath ?? null,
    getLibraryId: () => onlineLibrary()?.id ?? null,
    getProposalStage: buildProposalStage,
  }
}

/** 层装配后接调度：planner 读可调度来源出计划；agent.enabled 控定时，间隔变更经 reschedule 即读 */
function wireCrawlerScheduler(): void {
  const layer = getCrawlerLayer()
  const sp = getAgentScheduler()
  if (!layer?.sourceStore) {
    sp.stop()
    return
  }
  sp.registerPlanner(() => {
    const lib = onlineLibrary()
    if (!lib) return []
    const pm = getPluginManager()
    // 自动调度只跑"健康且适配器已启用"的来源：
    //  - 排除 degraded（§12.10 停跑：否则重启后每周期重复硬闯，health 标记沦为展示）；
    //  - 排除插件未启用（否则 executeOp 抛"插件未启用"，job item 静默失败拉低 successRate）。
    // degraded 恢复走用户显式 triggerCrawlDiscovery（绕过 planner，干净轮次会擦回 ok）。
    const ids = layer.sourceStore!
      .listEnabled()
      .filter(s => s.health === 'ok' && pm.isPluginEnabled(s.pluginId))
      .map(s => s.id)
    return ids.length > 0 ? [{ libraryId: lib.id, sourceIds: ids }] : []
  })
  if (getSetting('agent.enabled')) {
    sp.start()
    sp.reschedule()
  } else {
    sp.stop()
  }
}

/** web 适配器的登录态探测站点（persist:luuk-crawler 分区 cookie）；pc-app Telegram 两通道不走浏览器登录 */
const SITE_LOGIN_PROBE: Record<string, string> = {
  'builtin.bili-web': 'https://www.bilibili.com/',
  'builtin.xhs-web': 'https://www.xiaohongshu.com/',
}

/**
 * 各站登录态特征 cookie（存在且非空才算已登录）——避免匿名 cookie 误报 loggedIn:true。
 * bili：SESSDATA/DedeUserID；xhs：web_session（登录后写入）。
 */
const SITE_LOGIN_COOKIES: Record<string, string[]> = {
  'builtin.bili-web': ['SESSDATA', 'DedeUserID'],
  'builtin.xhs-web': ['web_session'],
}

// ── T18 反馈链路 & accept 落地入库（M4 人在回路下游接线） ──

let feedbackAggregator: FeedbackAggregator | null = null
let feedbackAggregatorDb: ReturnType<typeof getMasterDB> | null = null

/** FeedbackAggregator 单例（db 实例变更自动重建，与 profiler 同一节流/脏检查口径） */
function getFeedbackAggregator(): FeedbackAggregator {
  const db = getMasterDB()
  if (!feedbackAggregator || feedbackAggregatorDb !== db) {
    feedbackAggregator = new FeedbackAggregator(db, getProfiler())
    feedbackAggregatorDb = db
  }
  return feedbackAggregator
}

/**
 * 注册 accept 下游钩子：采集提案确认后把 `_downloads` 媒体迁入主库并触发扫描登记。
 * 沿 M1 修正口径：不直读写画像、不持裸连接，一律经 store/profiler/imageService 单例。
 * fire-and-forget（store.resolve 内吞异步）：提案终态先行，物理入库失败不回滚。
 */
function wireAcceptDownstream(): void {
  try {
    getProposalStore(getMasterDB()).onAccept(async (proposal: Proposal) => {
      if (proposal.agentKind !== 'crawler' || proposal.libraryId == null) return
      const payload = proposal.payload as CandidateItem
      const items = getCrawlItemStore(getMasterDB())
      const result = await importAcceptedCrawlerProposal(payload, proposal.libraryId, {
        listMedia: (sourceId, sourceUrl) => items.listMediaBySourceUrl(sourceId, sourceUrl),
        updateImagePath: (id, newPath) => items.updateImagePath(id, newPath),
        getLibraryRootPath: libraryId => getMasterDB().getLibrary(libraryId)?.rootPath ?? null,
        scanLibrary: libraryId => getImageService().scanLibrary(libraryId),
      })
      if (result.errors.length > 0) {
        logger.warn('AgentHandlers', `提案 ${proposal.id} 落地有 ${result.errors.length} 项失败: ${result.errors[0]}`)
      }
    })
  } catch (err) {
    // 注册期 MasterDB 未就绪（如单测替身）不应中断 IPC 面装配；accept 时再兜底
    logger.warn('AgentHandlers', `accept 下游钩子注册延迟: ${err}`)
  }
}

/** 采集 Agent 总览状态（不含任何 Key/明文，仅开关与计数） */
function agentStatus(): AgentStatus {
  const counts = getProposalStore(getMasterDB()).countByState('crawler')
  return {
    enabled: getSetting('agent.enabled'),
    intervalMs: getSetting('agent.intervalMs'),
    crawlerEnabled: getSetting('crawler.enabled'),
    scheduled: getAgentScheduler().isScheduled,
    pendingProposals: counts.pending,
  }
}

export function registerAgentHandlers(): void {
  ipcMain.handle('getJevStatus', async (): Promise<{ success: boolean; data?: JevStatus; error?: string }> => {
    try {
      return { success: true, data: jevStatus() }
    } catch (err) {
      logger.error('AgentHandlers', 'getJevStatus 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 开关变更后重新装配升级链（幂等）
  ipcMain.handle('setJevEnabled', async (_e, enabled: boolean) => {
    try {
      setSetting('jev.enabled', Boolean(enabled))
      return { success: true, data: await reinitDecisionLayer() }
    } catch (err) {
      logger.error('AgentHandlers', 'setJevEnabled 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // Key 只写不读：响应仅含 hasKey
  ipcMain.handle('setJevApiKey', async (_e, apiKey: string) => {
    try {
      setSetting('jev.apiKey', typeof apiKey === 'string' ? apiKey.trim() : '')
      return { success: true, data: await reinitDecisionLayer() }
    } catch (err) {
      logger.error('AgentHandlers', 'setJevApiKey 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // T11 — 爬虫层开关（装配/拆除幂等；关闭即 dispose 隐藏窗口；T16 同步接/拆调度）
  ipcMain.handle('setCrawlerEnabled', async (_e, enabled: boolean) => {
    try {
      setSetting('crawler.enabled', Boolean(enabled))
      const layer = ensureCrawlerLayer(crawlerLayerDeps())
      wireCrawlerScheduler()
      return { success: true, data: { enabled: layer !== null } }
    } catch (err) {
      logger.error('AgentHandlers', 'setCrawlerEnabled 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // T16 — 手动触发一轮发现（sourceIds 省略 = 全部启用来源；agent.enabled 关闭时返回空不报错，与调度双闸一致）
  ipcMain.handle('triggerCrawlDiscovery', async (_e, sourceIds?: number[]) => {
    try {
      const layer = getCrawlerLayer()
      if (!layer?.sourceStore) return { success: false, error: '爬虫层未装配（crawler.enabled 关闭）' }
      const lib = onlineLibrary()
      if (!lib) return { success: false, error: '无在线图库，下载与提案无处承接' }
      const ids = Array.isArray(sourceIds) && sourceIds.length > 0
        ? sourceIds
        : layer.sourceStore.listEnabled().map(s => s.id)
      if (ids.length === 0) return { success: true, data: { jobIds: [] } }
      const jobIds = await getAgentScheduler().triggerNow(lib.id, ids)
      return { success: true, data: { jobIds } }
    } catch (err) {
      logger.error('AgentHandlers', 'triggerCrawlDiscovery 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // T16 — 来源登录态（cookie 粗判；tg 系 pc-app 通道无需浏览器登录，回 loggedIn:true）
  ipcMain.handle('getSourceLoginStatus', async (_e, sourceId: number) => {
    try {
      const layer = getCrawlerLayer()
      const source = layer?.sourceStore?.get(Number(sourceId))
      if (!source) return { success: false, error: `信息源不存在: ${sourceId}` }
      const probe = SITE_LOGIN_PROBE[source.pluginId]
      if (!probe) return { success: true, data: { needsLogin: false, loggedIn: true } }
      const loggedIn = (await layer?.browser?.hasCookiesFor(probe, SITE_LOGIN_COOKIES[source.pluginId])) ?? false
      return { success: true, data: { needsLogin: true, loggedIn, probeUrl: probe } }
    } catch (err) {
      logger.error('AgentHandlers', 'getSourceLoginStatus 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // T16 — 打开可见登录窗口（D11：用户本人扫码/登录，凭证只落 persist 分区，不下发渲染进程）
  ipcMain.handle('startSourceLogin', async (_e, sourceId: number) => {
    try {
      const layer = getCrawlerLayer()
      const source = layer?.sourceStore?.get(Number(sourceId))
      if (!source) return { success: false, error: `信息源不存在: ${sourceId}` }
      const probe = SITE_LOGIN_PROBE[source.pluginId]
      if (!probe) return { success: false, error: '该连接器不使用浏览器登录态' }
      if (!layer?.browser) return { success: false, error: '浏览器层未装配（crawler.enabled 关闭）' }
      await layer.browser.showLoginWindow(probe)
      const loggedIn = await layer.browser.hasCookiesFor(probe, SITE_LOGIN_COOKIES[source.pluginId])
      return { success: true, data: { loggedIn } }
    } catch (err) {
      logger.error('AgentHandlers', 'startSourceLogin 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // T18 — accept 下游钩子注册（幂等；覆盖式注册，热重启安全）
  wireAcceptDownstream()

  // ── T17/T18 提案查询与反馈决策 ──

  // 提案列表：score 降序分页（DiscoverPanel 消费，ProposalStore.list 原形透传）
  ipcMain.handle('listProposals', async (_e, query?: ProposalQuery) => {
    try {
      const page: ProposalPage = getProposalStore(getMasterDB()).list(query ?? {})
      return { success: true, data: page }
    } catch (err) {
      logger.error('AgentHandlers', 'listProposals 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('countProposalsByState', async (_e, agentKind?: AgentKind) => {
    try {
      return { success: true, data: getProposalStore(getMasterDB()).countByState(agentKind) }
    } catch (err) {
      logger.error('AgentHandlers', 'countProposalsByState 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  /**
   * 提案终态流转 + 反馈联动（T18 人在回路核心）：
   * 先 store.resolve（写 proposals 终态 + feedback_log，accept 时经 onAccept 异步落地入库），
   * 再 FeedbackAggregator.applyFeedback（回写画像权重，必经 profiler 脏检查，不绕过）。
   * 顺序不可颠倒：applyFeedback 的 reject 计数依赖 resolve 已写入的 feedback_log 行。
   */
  ipcMain.handle('resolveProposal', async (_e, id: number, action: FeedbackAction) => {
    try {
      const proposal: Proposal = getProposalStore(getMasterDB()).resolve(Number(id), action)
      getFeedbackAggregator().applyFeedback(proposal, action)
      return { success: true, data: proposal }
    } catch (err) {
      logger.error('AgentHandlers', 'resolveProposal 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // ── T20 采集 Agent 开关 / 间隔 ──

  ipcMain.handle('getAgentStatus', async () => {
    try {
      return { success: true, data: agentStatus() }
    } catch (err) {
      logger.error('AgentHandlers', 'getAgentStatus 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 调度总开关变更：写入后重接调度（双闸：agent.enabled 控定时启停）
  ipcMain.handle('setAgentEnabled', async (_e, enabled: boolean) => {
    try {
      setSetting('agent.enabled', Boolean(enabled))
      wireCrawlerScheduler()
      return { success: true, data: agentStatus() }
    } catch (err) {
      logger.error('AgentHandlers', 'setAgentEnabled 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 定时间隔变更：钳制上下限后必须 reschedule()（M1 修正口径，否则新间隔到下个周期才生效）
  // M5：仅钳下限会放过 Infinity/超 2^31-1（Node 会钳成 1ms 调度风暴），故补上界与 isFinite 守卫
  ipcMain.handle('setAgentIntervalMs', async (_e, intervalMs: number) => {
    try {
      const n = Number(intervalMs)
      const clamped = Number.isFinite(n)
        ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, n))
        : MIN_INTERVAL_MS
      setSetting('agent.intervalMs', clamped)
      getAgentScheduler().reschedule()
      return { success: true, data: agentStatus() }
    } catch (err) {
      logger.error('AgentHandlers', 'setAgentIntervalMs 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // ── T19 信息源 CRUD（消费 crawl_sources） ──

  ipcMain.handle('listCrawlSources', async () => {
    try {
      const sources: CrawlSourceRecord[] = getCrawlSourceStore(getMasterDB()).list()
      return { success: true, data: sources }
    } catch (err) {
      logger.error('AgentHandlers', 'listCrawlSources 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 建源：config 经 parseCrawlSourceConfig 校验（app-bridge/非法 op 名在主进程抛错，UI 得到明确原因）
  ipcMain.handle('createCrawlSource', async (_e, input: CreateCrawlSourceInput) => {
    try {
      const store = getCrawlSourceStore(getMasterDB())
      const created = store.create({
        pluginId: input.pluginId,
        name: input.name,
        config: parseCrawlSourceConfig(input.config),
        enabled: input.enabled,
      })
      return { success: true, data: created }
    } catch (err) {
      logger.error('AgentHandlers', 'createCrawlSource 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('deleteCrawlSource', async (_e, id: number) => {
    try {
      return { success: true, data: getCrawlSourceStore(getMasterDB()).delete(Number(id)) }
    } catch (err) {
      logger.error('AgentHandlers', 'deleteCrawlSource 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('setCrawlSourceEnabled', async (_e, id: number, enabled: boolean) => {
    try {
      getCrawlSourceStore(getMasterDB()).setEnabled(Number(id), Boolean(enabled))
      return { success: true, data: getCrawlSourceStore(getMasterDB()).get(Number(id)) }
    } catch (err) {
      logger.error('AgentHandlers', 'setCrawlSourceEnabled 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info('AgentHandlers', 'Agent IPC 处理器已注册')
}

export function unregisterAgentHandlers(): void {
  const channels = [
    'getJevStatus', 'setJevEnabled', 'setJevApiKey', 'setCrawlerEnabled',
    'triggerCrawlDiscovery', 'getSourceLoginStatus', 'startSourceLogin',
    'listProposals', 'countProposalsByState', 'resolveProposal',
    'getAgentStatus', 'setAgentEnabled', 'setAgentIntervalMs',
    'listCrawlSources', 'createCrawlSource', 'deleteCrawlSource', 'setCrawlSourceEnabled',
  ]
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }
  scheduler?.stop()
  getCrawlerLayer()?.disable()
  // 热重启清洁：复位单例使下次 register 重建全新调度器/profiler（不沿用旧闭包）；
  // JobRunner handler 经 registerHandler 的 Map.set 覆盖，重新 ensureCrawlerLayer 时自然替换
  scheduler = null
  profiler = null
  feedbackAggregator = null
  feedbackAggregatorDb = null
}
