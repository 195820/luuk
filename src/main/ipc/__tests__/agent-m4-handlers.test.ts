/**
 * T17-T20 — M4 Agent IPC 处理器边界单测
 * 覆盖人在回路下游的关键接线语义（不触碰真实 DB/网络）：
 *  - resolveProposal：先 store.resolve 再 FeedbackAggregator.applyFeedback（顺序不可颠倒，reject 计数依赖 feedback_log 已写）
 *  - setAgentIntervalMs：低于 MIN_INTERVAL_MS 钳制后落盘
 *  - setAgentEnabled：写 agent.enabled 并重接调度（crawler 层为 null 时不抛）
 *  - 信息源 CRUD / 提案分页透传
 */
import os from 'os'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  calls: [] as string[],
}))

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  ipcMain: {
    handle: (channel: string, fn: unknown) => { mocks.handlers.set(channel, fn) },
    removeHandler: (channel: string) => { mocks.handlers.delete(channel) },
  },
}))

const state = vi.hoisted(() => ({
  settings: {
    'agent.enabled': false, 'agent.intervalMs': 6 * 60 * 60 * 1000,
    'crawler.enabled': false, 'jev.enabled': false, 'jev.apiKey': '', 'plugins.enabled': true,
  } as Record<string, unknown>,
  // 提案 store 替身
  listResult: { items: [], total: 0, page: 1, pageSize: 20 } as unknown,
  counts: { pending: 3, accepted: 1, skipped: 0, rejected: 0 } as Record<string, number>,
  resolveReturn: { id: 42, agentKind: 'crawler', libraryId: 7, payload: {}, state: 'accepted' } as Record<string, unknown>,
  resolveError: null as Error | null,
  createdSource: null as unknown,
  sourceList: [{ id: 1, name: 'bili' }] as unknown[],
  deleted: true,
  enabledSource: { id: 5, enabled: true } as unknown,
}))

vi.mock('../../services/settings-service', () => ({
  getSetting: (key: string) => state.settings[key],
  setSetting: (key: string, value: unknown) => { state.settings[key] = value },
}))

vi.mock('../../services/database', () => ({
  getMasterDB: () => ({
    getLibraries: () => [{ id: 7, status: 'online', rootPath: '/lib' }],
    getLibrary: (id: number) => (id === 7 ? { id: 7, rootPath: '/lib' } : null),
  }),
}))

vi.mock('../../services/plugin-manager', () => ({
  getPluginManager: () => ({
    isPluginEnabled: () => false,
    getPluginInfo: () => null,
    setEnabled: async () => {},
    executeOp: async () => ({}),
  }),
}))

vi.mock('../../services/image-service', () => ({
  getImageService: () => ({ scanLibrary: async () => ({}) }),
}))

vi.mock('../../services/job-runner', () => ({
  getJobRunner: () => ({ subscribeProgress: () => () => {}, enqueue: async () => 'job', start: async () => {}, cancel: async () => {} }),
}))

vi.mock('../../services/agent/preference-profiler', () => ({
  PreferenceProfiler: class { getProfile() { return { libraryId: null, keywords: [], sourceAffinity: {}, exclusions: { terms: [], sourceIds: [] }, updatedAt: '' } } },
}))

vi.mock('../../services/agent/feedback-aggregator', () => ({
  FeedbackAggregator: class {
    applyFeedback(_proposal: unknown, _action: string) { mocks.calls.push('applyFeedback'); return {} }
  },
}))

vi.mock('../../services/agent/proposal-store', () => ({
  getProposalStore: () => ({
    onAccept: () => {},
    list: () => { mocks.calls.push('list'); return state.listResult },
    countByState: () => state.counts,
    get: (id: number) => ({ id }),
    resolve: (id: number, action: string) => {
      mocks.calls.push('resolve')
      if (state.resolveError) throw state.resolveError
      return { ...state.resolveReturn, id, action }
    },
  }),
}))

vi.mock('../../services/crawler/crawler-bootstrap', () => ({
  ensureCrawlerLayer: () => null,
  getCrawlerLayer: () => null,
}))

vi.mock('../../services/crawler/source-store', () => ({
  getCrawlSourceStore: () => ({
    list: () => { mocks.calls.push('sourceList'); return state.sourceList },
    create: (input: unknown) => { mocks.calls.push('sourceCreate'); state.createdSource = input; return { id: 9, ...input as object } },
    delete: (id: number) => { mocks.calls.push('sourceDelete'); void id; return state.deleted },
    setEnabled: (id: number, enabled: boolean) => { mocks.calls.push('setEnabled'); void id; void enabled },
    get: (id: number) => state.enabledSource && { ...(state.enabledSource as object), id },
  }),
  parseCrawlSourceConfig: (raw: unknown) => raw,
}))

vi.mock('../../services/crawler/crawl-item-store', () => ({
  getCrawlItemStore: () => ({ listMediaBySourceUrl: () => [], updateImagePath: () => {} }),
}))

vi.mock('../../services/agent/decision/decision-registry', () => ({
  getDecisionRegistry: () => ({ decide: async () => ({}) }),
}))
vi.mock('../../services/agent/decision/jev-bootstrap', () => ({
  bootstrapDecisionLayer: async () => ({ jevRegistered: false }),
}))
vi.mock('../../services/agent/decision/plugin-decision-adapter', () => ({
  getJevStats: () => ({ calls: 0, successes: 0, skipped: 0, failures: 0, filteredFields: 0 }),
}))

import { registerAgentHandlers } from '../agent-handlers'

interface IpcResult<T> { success: boolean; data?: T; error?: string }

function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const fn = mocks.handlers.get(channel) as ((...a: unknown[]) => Promise<IpcResult<T>>) | undefined
  if (!fn) throw new Error(`未注册的 IPC channel: ${channel}`)
  return fn({} as unknown, ...args)
}

beforeEach(() => {
  mocks.calls = []
  state.settings = {
    'agent.enabled': false, 'agent.intervalMs': 6 * 60 * 60 * 1000,
    'crawler.enabled': false, 'jev.enabled': false, 'jev.apiKey': '', 'plugins.enabled': true,
  }
  state.resolveError = null
  state.createdSource = null
  mocks.handlers.clear()
  registerAgentHandlers()
})

describe('resolveProposal（人在回路反馈联动，T18）', () => {
  it('先 store.resolve 再 FeedbackAggregator.applyFeedback（顺序保证 reject 计数正确）', async () => {
    const res = await invoke<{ id: number }>('resolveProposal', 42, 'reject')
    expect(res.success).toBe(true)
    expect(res.data?.id).toBe(42)
    expect(mocks.calls).toEqual(['resolve', 'applyFeedback'])
  })

  it('resolve 抛非法流转 → 不透传给 aggregator，返回 success:false', async () => {
    state.resolveError = new Error('非法状态流转: 42 已是终态 accepted')
    const res = await invoke('resolveProposal', 42, 'accept')
    expect(res.success).toBe(false)
    expect(res.error).toContain('非法状态流转')
    expect(mocks.calls).toEqual(['resolve']) // 无 applyFeedback
  })
})

describe('提案分页与计数透传（T17）', () => {
  it('listProposals 透传 ProposalStore.list', async () => {
    state.listResult = { items: [{ id: 1 }], total: 1, page: 1, pageSize: 20 }
    const res = await invoke<{ total: number }>('listProposals', { state: 'pending', page: 1 })
    expect(res.data?.total).toBe(1)
    expect(mocks.calls).toContain('list')
  })

  it('countProposalsByState 返回各状态计数', async () => {
    const res = await invoke<Record<string, number>>('countProposalsByState', 'crawler')
    expect(res.data?.pending).toBe(3)
  })
})

describe('getAgentStatus（T20）', () => {
  it('聚合开关/间隔/待确认数', async () => {
    state.settings['agent.enabled'] = true
    const res = await invoke<{ enabled: boolean; pendingProposals: number; scheduled: boolean }>('getAgentStatus')
    expect(res.data?.enabled).toBe(true)
    expect(res.data?.pendingProposals).toBe(3)
    expect(res.data?.scheduled).toBe(false) // 未 start
  })
})

describe('setAgentEnabled（T20 双闸调度重接）', () => {
  it('写入 agent.enabled 且 crawler 层缺失时不抛', async () => {
    const res = await invoke<{ enabled: boolean }>('setAgentEnabled', true)
    expect(state.settings['agent.enabled']).toBe(true)
    expect(res.success).toBe(true)
    expect(res.data?.enabled).toBe(true)
  })
})

describe('setAgentIntervalMs（T20 钳制 + reschedule）', () => {
  it('低于下限钳制为 60s', async () => {
    const res = await invoke<{ intervalMs: number }>('setAgentIntervalMs', 1000)
    expect(state.settings['agent.intervalMs']).toBe(60_000)
    expect(res.data?.intervalMs).toBe(60_000)
  })

  it('合法间隔原样落盘', async () => {
    await invoke('setAgentIntervalMs', 30 * 60 * 1000)
    expect(state.settings['agent.intervalMs']).toBe(30 * 60 * 1000)
  })

  it('M5：超大间隔钳制为上限 30 天', async () => {
    await invoke('setAgentIntervalMs', Number.MAX_SAFE_INTEGER)
    expect(state.settings['agent.intervalMs']).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('M5：Infinity/非有限值回退为下限', async () => {
    await invoke('setAgentIntervalMs', Infinity)
    expect(state.settings['agent.intervalMs']).toBe(60_000)
  })
})

describe('信息源 CRUD（T19）', () => {
  it('listCrawlSources 透传', async () => {
    const res = await invoke<unknown[]>('listCrawlSources')
    expect(res.data).toHaveLength(1)
    expect(mocks.calls).toContain('sourceList')
  })

  it('createCrawlSource 携 config/enabled 入 store.create', async () => {
    const input = { pluginId: 'builtin.bili-web', name: 'B站', config: { connectorType: 'web-http' }, enabled: true }
    const res = await invoke<{ id: number }>('createCrawlSource', input)
    expect(mocks.calls).toContain('sourceCreate')
    expect(state.createdSource).toMatchObject({ pluginId: 'builtin.bili-web', name: 'B站' })
    expect(res.data?.id).toBe(9)
  })

  it('deleteCrawlSource 返回布尔', async () => {
    const res = await invoke<boolean>('deleteCrawlSource', 3)
    expect(res.data).toBe(true)
  })

  it('setCrawlSourceEnabled 回写后返回最新记录', async () => {
    state.enabledSource = { id: 5, name: 'x', enabled: true }
    const res = await invoke<{ enabled: boolean }>('setCrawlSourceEnabled', 5, true)
    expect(mocks.calls).toContain('setEnabled')
    expect(res.data?.enabled).toBe(true)
  })
})
