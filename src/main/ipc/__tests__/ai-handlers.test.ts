/**
 * Phase 9 M5 · T23 — AI 标签/质量分 IPC 处理器单测（不经真 DB/原生链）：
 *  - triggerAiTagging / triggerAiQuality：无效库 ID、ai.enabled 门禁、jobId 空值文案、透传 force
 *  - listTagSuggestions：纯 DB 无门禁；按库过滤 + payload 形状校验
 *  - adoptTagSuggestion：校验链（存在/quality/pending）→ getOrCreateTagByName('ai')+tagImageWithConfidence → resolve('accept')
 *  - dismissTagSuggestion → resolve('reject')；removeAiTag 参数校验
 *  - unregisterAiHandlers 移除全部 9 通道
 */
import os from 'os'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => { mocks.handlers.set(channel, fn) },
    removeHandler: (channel: string) => { mocks.handlers.delete(channel) },
  },
}))

vi.mock('../../../utils/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

const state = vi.hoisted(() => ({
  settings: { 'ai.enabled': true } as Record<string, unknown>,
  // ai-wiring 动态 import 面替身
  enqueueLabel: vi.fn(async (_libId: number, _runner: unknown) => 'job-label' as string | null),
  enqueueQuality: vi.fn(async (_libId: number, _runner: unknown, _force: boolean) => 'job-quality' as string | null),
  // 提案 store 替身
  listResult: { items: [], total: 0, page: 1, pageSize: 200 } as Record<string, unknown>,
  proposal: null as Record<string, unknown> | null,
  resolved: [] as Array<{ id: number; action: string }>,
  // MasterDB 标签方法替身
  createdTags: [] as Array<{ name: string; source: string }>,
  tagCalls: [] as Array<{ tagId: number; libId: number; rel: string; conf: number }>,
  removedAiTags: [] as Array<{ libId: number; rel: string; tag: string }>,
}))

vi.mock('../../services/settings-service', () => ({
  getSetting: (key: string) => state.settings[key],
  setSetting: (key: string, value: unknown) => { state.settings[key] = value },
}))

vi.mock('../../services/job-runner', () => ({
  getJobRunner: () => ({ registerHandler: () => {}, enqueue: async () => 'job', start: async () => {}, subscribeProgress: () => () => {} }),
}))

vi.mock('../../services/image-service', () => ({
  getImageService: () => ({ scanLibrary: async () => ({}) }),
}))

vi.mock('../../services/database', () => ({
  getMasterDB: () => ({
    getLibraries: () => [{ id: 7, status: 'online', rootPath: '/lib' }],
    getLibrary: (id: number) => (id === 7 ? { id: 7, rootPath: '/lib' } : null),
    getOrCreateTagByName: (name: string, source: string) => {
      state.createdTags.push({ name, source })
      return { id: 100 + state.createdTags.length, name, source }
    },
    tagImageWithConfidence: (tagId: number, libId: number, rel: string, conf: number) => {
      state.tagCalls.push({ tagId, libId, rel, conf })
    },
    removeAiTagFromImage: (libId: number, rel: string, tag: string) => {
      state.removedAiTags.push({ libId, rel, tag })
    },
  }),
  getVectorsDB: () => ({ listIndexedImageIds: () => [], countDirty: () => 0 }),
}))

vi.mock('../../services/agent/proposal-store', () => ({
  getProposalStore: () => ({
    list: () => state.listResult,
    get: (_id: number) => state.proposal,
    resolve: (id: number, action: string) => {
      state.resolved.push({ id, action })
      return { id, action }
    },
  }),
}))

// C1：ai-handlers 触发通道走动态 import 拉起 ai-wiring / vector-index-service，测试以替身拦截
vi.mock('../../services/ai/ai-wiring', () => ({
  enqueueLabelForLibrary: state.enqueueLabel,
  enqueueQualityForLibrary: state.enqueueQuality,
  ensureAiLayerOnBoot: vi.fn(async () => {}),
  disposeAiLayer: vi.fn(),
  runSemanticQuery: vi.fn(async () => []),
}))
vi.mock('../../services/vectors/vector-index-service', () => ({
  getVectorIndexService: () => null,
  closeAllVectorIndexServices: vi.fn(),
}))

import { registerAiHandlers, unregisterAiHandlers } from '../ai-handlers'

function call(channel: string, ...args: unknown[]) {
  const fn = mocks.handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn(null, ...args)
}

beforeEach(() => {
  registerAiHandlers() // handle 覆盖写入同一 Map，重复注册无副作用
  vi.clearAllMocks()
  state.settings['ai.enabled'] = true
  state.enqueueLabel.mockResolvedValue('job-label')
  state.enqueueQuality.mockResolvedValue('job-quality')
  state.listResult = { items: [], total: 0, page: 1, pageSize: 200 }
  state.proposal = null
  state.resolved = []
  state.createdTags = []
  state.tagCalls = []
  state.removedAiTags = []
})

describe('triggerAiTagging / triggerAiQuality（门禁 + 作业触发）', () => {
  it('无效库 ID → 拒绝，不触碰 ai-wiring', async () => {
    const res = await call('triggerAiTagging', 0)
    expect(res).toEqual({ success: false, error: '无效库 ID' })
    expect(state.enqueueLabel).not.toHaveBeenCalled()
  })

  it('ai.enabled=false → 门禁拒绝', async () => {
    state.settings['ai.enabled'] = false
    const res = await call('triggerAiTagging', 7)
    expect(res).toEqual({ success: false, error: 'AI 未启用' })
    const res2 = await call('triggerAiQuality', 7)
    expect(res2).toEqual({ success: false, error: 'AI 未启用' })
  })

  it('enqueue 返回 null → 无可处理提示', async () => {
    state.enqueueLabel.mockResolvedValue(null)
    const res = await call('triggerAiTagging', 7) as { success: boolean; error: string }
    expect(res.success).toBe(false)
    expect(res.error).toContain('无可处理图片')
  })

  it('正常触发 → 返回 jobId', async () => {
    const res = await call('triggerAiTagging', 7)
    expect(res).toEqual({ success: true, data: { jobId: 'job-label' } })
    expect(state.enqueueLabel).toHaveBeenCalledWith(7, expect.anything())
  })

  it('triggerAiQuality 透传 force（缺省归一为 false）', async () => {
    await call('triggerAiQuality', 7)
    expect(state.enqueueQuality).toHaveBeenLastCalledWith(7, expect.anything(), false)
    const res = await call('triggerAiQuality', 7, true)
    expect(state.enqueueQuality).toHaveBeenLastCalledWith(7, expect.anything(), true)
    expect(res).toEqual({ success: true, data: { jobId: 'job-quality' } })
  })

  it('enqueue 抛错 → 捕获为 success:false', async () => {
    state.enqueueQuality.mockRejectedValue(new Error('boom'))
    const res = await call('triggerAiQuality', 7)
    expect(res).toEqual({ success: false, error: 'boom' })
  })
})

describe('listTagSuggestions（按库过滤 + payload 形状校验）', () => {
  it('无效库 ID → 拒绝且 data 为空数组', async () => {
    const res = await call('listTagSuggestions', -1)
    expect(res).toEqual({ success: false, error: '无效库 ID', data: [] })
  })

  it('过滤他库提案与非法 payload，仅映射形状合法项', async () => {
    const good = {
      id: 1, libraryId: 7, confidence: 0.42, createdAt: '2026-10-01',
      payload: { libraryId: 7, imageId: 11, imageRelativePath: 'a.jpg', suggestions: [{ tagName: 'portrait', confidence: 0.42 }] },
    }
    state.listResult = {
      items: [
        good,
        { id: 2, libraryId: 8, confidence: 0.9, createdAt: '', payload: { libraryId: 8, imageId: 12, imageRelativePath: 'b.jpg', suggestions: [] } }, // 他库
        { id: 3, libraryId: 7, confidence: 0.5, createdAt: '', payload: { imageId: 'not-number' } }, // 形状非法
        { id: 4, libraryId: 7, confidence: 0.5, createdAt: '', payload: null }, // 空 payload
      ],
      total: 4, page: 1, pageSize: 200,
    }
    const res = await call('listTagSuggestions', 7) as { success: boolean; data: unknown[] }
    expect(res.success).toBe(true)
    expect(res.data).toEqual([{
      proposalId: 1, imageId: 11, imageRelativePath: 'a.jpg',
      suggestions: [{ tagName: 'portrait', confidence: 0.42 }], confidence: 0.42, createdAt: '2026-10-01',
    }])
  })
})

describe('adoptTagSuggestion（人在回路唯一落库点）', () => {
  const pendingQuality = (overrides?: Record<string, unknown>) => ({
    id: 1, agentKind: 'quality', state: 'pending', libraryId: 7,
    payload: {
      libraryId: 7, imageId: 11, imageRelativePath: 'a.jpg',
      suggestions: [{ tagName: 'portrait', confidence: 0.42 }, { tagName: 'sunset', confidence: 0.2 }],
    },
    ...overrides,
  })

  it('提案不存在 / 非 quality / 已终态 → 各自拒绝且不落标签', async () => {
    state.proposal = null
    expect(await call('adoptTagSuggestion', 1)).toMatchObject({ success: false, error: '提案不存在: 1' })
    state.proposal = pendingQuality({ agentKind: 'crawler' })
    expect(await call('adoptTagSuggestion', 1)).toMatchObject({ success: false, error: '非标签建议提案' })
    state.proposal = pendingQuality({ state: 'accepted' })
    expect(await call('adoptTagSuggestion', 1)).toMatchObject({ success: false, error: '提案已是终态 accepted' })
    expect(state.tagCalls).toHaveLength(0)
    expect(state.resolved).toHaveLength(0)
  })

  it('成功采纳：每条建议 source=ai 落库后才 resolve(accept)', async () => {
    state.proposal = pendingQuality()
    const res = await call('adoptTagSuggestion', 1)
    expect(res).toEqual({ success: true, data: { adopted: 2 } })
    expect(state.createdTags).toEqual([{ name: 'portrait', source: 'ai' }, { name: 'sunset', source: 'ai' }])
    expect(state.tagCalls).toEqual([
      { tagId: 101, libId: 7, rel: 'a.jpg', conf: 0.42 },
      { tagId: 102, libId: 7, rel: 'a.jpg', conf: 0.2 },
    ])
    expect(state.resolved).toEqual([{ id: 1, action: 'accept' }])
  })
})

describe('dismissTagSuggestion / removeAiTag', () => {
  it('dismiss：无效 ID 拒绝，合法 ID → resolve(reject)', async () => {
    expect(await call('dismissTagSuggestion', 0)).toMatchObject({ success: false, error: '无效提案 ID' })
    const res = await call('dismissTagSuggestion', 3)
    expect(res).toEqual({ success: true })
    expect(state.resolved).toEqual([{ id: 3, action: 'reject' }])
  })

  it('removeAiTag：参数不完整拒绝，合法则透传 MasterDB', async () => {
    expect(await call('removeAiTag', 7, '', 'portrait')).toMatchObject({ success: false, error: '参数不完整' })
    expect(await call('removeAiTag', 0, 'a.jpg', 'portrait')).toMatchObject({ success: false, error: '无效库 ID' })
    const res = await call('removeAiTag', 7, 'a.jpg', 'portrait')
    expect(res).toEqual({ success: true })
    expect(state.removedAiTags).toEqual([{ libId: 7, rel: 'a.jpg', tag: 'portrait' }])
  })
})

describe('unregisterAiHandlers', () => {
  it('移除全部 9 个 AI 通道', () => {
    unregisterAiHandlers()
    for (const ch of [
      'getAiStatus', 'setAiEnabled', 'semanticSearchImages',
      'triggerAiTagging', 'triggerAiQuality', 'listTagSuggestions',
      'adoptTagSuggestion', 'dismissTagSuggestion', 'removeAiTag',
    ]) {
      expect(mocks.handlers.has(ch)).toBe(false)
    }
  })
})
