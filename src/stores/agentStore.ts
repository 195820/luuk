/**
 * T17 — agentStore（采集 Agent 渲染层数据骨干）
 * 全部数据访问经 window.electronAPI（主进程 ProposalStore/AgentScheduler/CrawlSourceStore 单例），
 * 渲染层绝不直连 DB/画像（M1 修正口径）。feature flag 默认全关 → bootstrap 只探状态，零网络。
 */
import { create } from 'zustand'
import type {
  AgentStatus,
  CreateCrawlSourceInput,
  CrawlSourceRecord,
  FeedbackAction,
  JevStatus,
  Proposal,
  ProposalState,
} from '../types'
import { logger } from '../utils/logger'

const PAGE_SIZE = 50

/** 反馈动作 → 面向用户的提示语（toast 文案，T18） */
const ACTION_MESSAGE: Record<FeedbackAction, string> = {
  accept: '已确认，媒体正在入库',
  skip: '已跳过',
  reject: '已拒绝，已回写偏好画像',
}

interface ResolveResult {
  ok: boolean
  message: string
}

interface AgentState {
  /** 采集 Agent 状态（null = 尚未探测；决定入口是否渲染） */
  status: AgentStatus | null
  /** 状态探测过且总闸/执行闸任一开启 → 入口可见 */
  entryVisible: boolean
  jev: JevStatus | null

  proposals: Proposal[]
  proposalsTotal: number
  proposalsPage: number
  filterState: ProposalState | 'all'
  loadingProposals: boolean

  sources: CrawlSourceRecord[]
  loadingSources: boolean

  error: string | null

  /** 面板打开时探测状态；开启态顺带拉计数与列表 */
  bootstrap: () => Promise<void>
  refreshStatus: () => Promise<void>
  loadProposals: (page?: number, filter?: ProposalState | 'all') => Promise<void>
  resolveProposal: (id: number, action: FeedbackAction) => Promise<ResolveResult>

  refreshSources: () => Promise<void>
  createSource: (input: CreateCrawlSourceInput) => Promise<ResolveResult>
  deleteSource: (id: number) => Promise<ResolveResult>
  toggleSource: (id: number, enabled: boolean) => Promise<ResolveResult>

  setAgentEnabled: (enabled: boolean) => Promise<void>
  setAgentIntervalMs: (ms: number) => Promise<void>
  setCrawlerEnabled: (enabled: boolean) => Promise<void>
  triggerDiscovery: (sourceIds?: number[]) => Promise<ResolveResult>

  setJevEnabled: (enabled: boolean) => Promise<void>
  setJevApiKey: (key: string) => Promise<void>
}

const api = () => window.electronAPI

export const useAgentStore = create<AgentState>((set, get) => ({
  status: null,
  entryVisible: false,
  jev: null,

  proposals: [],
  proposalsTotal: 0,
  proposalsPage: 1,
  filterState: 'pending',
  loadingProposals: false,

  sources: [],
  loadingSources: false,

  error: null,

  bootstrap: async () => {
    await get().refreshStatus()
    const s = get().status
    if (s && (s.enabled || s.crawlerEnabled)) {
      void get().loadProposals(1, get().filterState)
    }
  },

  refreshStatus: async () => {
    try {
      const res = await api().getAgentStatus()
      if (res.success && res.data) {
        set({ status: res.data, entryVisible: res.data.enabled || res.data.crawlerEnabled, error: null })
      } else {
        set({ error: res.error ?? '获取 Agent 状态失败' })
      }
    } catch (err) {
      logger.error('AgentStore', 'getAgentStatus 失败', err)
      set({ status: null, entryVisible: false })
    }
  },

  loadProposals: async (page, filter) => {
    const nextPage = page ?? get().proposalsPage
    const nextFilter = filter ?? get().filterState
    set({ loadingProposals: true })
    try {
      const res = await api().listProposals({
        agentKind: 'crawler',
        state: nextFilter === 'all' ? undefined : nextFilter,
        page: nextPage,
        pageSize: PAGE_SIZE,
      })
      if (res.success && res.data) {
        set({ proposals: res.data.items, proposalsTotal: res.data.total, proposalsPage: nextPage, filterState: nextFilter })
      } else {
        set({ error: res.error ?? '加载提案失败' })
      }
    } catch (err) {
      logger.error('AgentStore', 'listProposals 失败', err)
    } finally {
      set({ loadingProposals: false })
      // 计数角标随列表刷新
      void api().countProposalsByState('crawler').then(r => {
        if (r.success && r.data && get().status) {
          set({ status: { ...get().status!, pendingProposals: r.data.pending } })
        }
      }).catch(() => {})
    }
  },

  resolveProposal: async (id, action) => {
    try {
      const res = await api().resolveProposal(id, action)
      if (!res.success) return { ok: false, message: res.error ?? '操作失败' }
      // 本地即时移除该提案（列表按 pending 过滤时终态应消失）
      set({ proposals: get().proposals.filter(p => p.id !== id), proposalsTotal: Math.max(0, get().proposalsTotal - 1) })
      const cur = get().status
      if (cur) set({ status: { ...cur, pendingProposals: Math.max(0, cur.pendingProposals - 1) } })
      return { ok: true, message: ACTION_MESSAGE[action] }
    } catch (err) {
      logger.error('AgentStore', 'resolveProposal 失败', err)
      return { ok: false, message: (err as Error).message }
    }
  },

  refreshSources: async () => {
    set({ loadingSources: true })
    try {
      const res = await api().listCrawlSources()
      if (res.success) set({ sources: res.data ?? [] })
    } catch (err) {
      logger.error('AgentStore', 'listCrawlSources 失败', err)
    } finally {
      set({ loadingSources: false })
    }
  },

  createSource: async (input) => {
    try {
      const res = await api().createCrawlSource(input)
      if (!res.success) return { ok: false, message: res.error ?? '建源失败' }
      await get().refreshSources()
      return { ok: true, message: '信息源已创建' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  },

  deleteSource: async (id) => {
    try {
      const res = await api().deleteCrawlSource(id)
      if (!res.success) return { ok: false, message: res.error ?? '删除失败' }
      await get().refreshSources()
      return { ok: true, message: '信息源已删除' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  },

  toggleSource: async (id, enabled) => {
    try {
      const res = await api().setCrawlSourceEnabled(id, enabled)
      if (!res.success) return { ok: false, message: res.error ?? '切换失败' }
      await get().refreshSources()
      return { ok: true, message: enabled ? '已启用' : '已停用' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  },

  setAgentEnabled: async (enabled) => {
    try {
      const res = await api().setAgentEnabled(enabled)
      if (res.success && res.data) set({ status: res.data, entryVisible: res.data.enabled || res.data.crawlerEnabled })
    } catch (err) {
      logger.error('AgentStore', 'setAgentEnabled 失败', err)
    }
  },

  setAgentIntervalMs: async (ms) => {
    try {
      const res = await api().setAgentIntervalMs(ms)
      if (res.success && res.data) set({ status: res.data })
    } catch (err) {
      logger.error('AgentStore', 'setAgentIntervalMs 失败', err)
    }
  },

  setCrawlerEnabled: async (enabled) => {
    try {
      const res = await api().setCrawlerEnabled(enabled)
      if (res.success) await get().refreshStatus()
      logger.info('AgentStore', `crawler.enabled=${res.data?.enabled ?? enabled}`)
    } catch (err) {
      logger.error('AgentStore', 'setCrawlerEnabled 失败', err)
    }
  },

  triggerDiscovery: async (sourceIds) => {
    try {
      const res = await api().triggerCrawlDiscovery(sourceIds)
      if (!res.success) return { ok: false, message: res.error ?? '触发发现失败' }
      return { ok: true, message: `已排队 ${(res.data?.jobIds.length ?? 0)} 个发现作业` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  },

  setJevEnabled: async (enabled) => {
    try {
      const res = await api().setJevEnabled(enabled)
      if (res.success && res.data) set({ jev: res.data })
    } catch (err) {
      logger.error('AgentStore', 'setJevEnabled 失败', err)
    }
  },

  setJevApiKey: async (key) => {
    try {
      const res = await api().setJevApiKey(key)
      if (res.success && res.data) set({ jev: res.data })
    } catch (err) {
      logger.error('AgentStore', 'setJevApiKey 失败', err)
    }
  },
}))
