// @vitest-environment node
/**
 * Phase 9 M5 · T21 — ai-wiring 生命周期单测（W12）。
 *
 * 目标：脱离真原生/DB，验证 R2 会话分时的关键不变量：
 * - 无引擎 → 零会话（不加载 usearch/引擎、不入队）
 * - 同库活跃作业守卫（并发重复触发只跑一个）
 * - 正常完成 → 落盘 ANN + 引用计数归零才卸载引擎 + 复位活跃集（可再次触发）
 * - 入队/启动异常 → 统一 finish 释放（引擎不泄漏、计数不归负）
 *
 * 用 FakeEmbeddingEngine + runner 替身；mock 掉 database / vector-index-service / settings-service
 * 三个重依赖模块（其顶层会链入 usearch 原生与 electron-store）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import type { JobRunner } from '../../job-runner'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

// 可配置的 getSetting（默认 ai.enabled=true，用例按需覆盖）
const getSettingMock = vi.fn((_key: string) => true)
vi.mock('../../settings-service', () => ({
  getSetting: (key: string) => getSettingMock(key),
  setSetting: vi.fn(),
}))

// ann 替身：load/unload/upsert 记录调用
const annMock = {
  load: vi.fn(),
  unload: vi.fn(),
  upsert: vi.fn(),
  isOpen: vi.fn(() => true),
}
const getVectorIndexServiceMock = vi.fn(() => annMock as never)
vi.mock('../../vectors/vector-index-service', () => ({
  getVectorIndexService: (..._a: unknown[]) => getVectorIndexServiceMock(),
}))

// vectors / thumbnails / master 替身
const vectorsMock = {
  listIndexedImageIds: vi.fn(() => [] as number[]),
  markPending: vi.fn(),
  upsertEmbedding: vi.fn(),
  countDirty: vi.fn(() => 0),
}
const thumbsMock = {
  listIndexableImages: vi.fn(() => [
    { id: 1, relativePath: 'a.jpg' },
    { id: 2, relativePath: 'b.jpg' },
  ]),
  getImageRelativePath: vi.fn((id: number) => `${id}.jpg`),
}
const masterMock = {
  getLibrary: vi.fn((id: number) => ({ id, rootPath: '/tmp/ivlib-root', status: 'online' })),
}
vi.mock('../../database', () => ({
  getVectorsDB: () => vectorsMock,
  getThumbnailsDB: () => thumbsMock,
  getMasterDB: () => masterMock,
}))

import { FakeEmbeddingEngine } from '../embedding-engine'
import { ensureAiLayer, resetAiLayer, getAiLayer } from '../ai-bootstrap'
import { enqueueIndexForLibrary, disposeAiLayer } from '../ai-wiring'

const MODEL = 'clip-vit-b32-int8'
const DIM = 512

/** 构造一个记录 handler/emit 的 runner 替身 */
function makeRunner(opts?: { enqueue?: () => Promise<string>; start?: () => Promise<void> }) {
  const cap: { handler: ((item: { libraryId: number; imageId: number | null }) => Promise<void>) | null; emit: ((p: unknown) => void) | null; unsubscribed: number } = {
    handler: null,
    emit: null,
    unsubscribed: 0,
  }
  const runner = {
    registerHandler: vi.fn((_kind: string, h: never) => { cap.handler = h as never }),
    enqueue: vi.fn(opts?.enqueue ?? (async () => 'job-1')),
    subscribeProgress: vi.fn((cb: (p: unknown) => void) => {
      cap.emit = cb
      return () => { cap.unsubscribed++ }
    }),
    start: vi.fn(opts?.start ?? (async () => {})),
  }
  return { runner: runner as unknown as JobRunner, cap }
}

/** 用 FakeEngine + 注入解析器装配 AI 层（不经 ensureAiLayerOnBoot，避开真模型/原生） */
function buildLayer(engine: FakeEmbeddingEngine): void {
  ensureAiLayer({
    isEnabled: () => true,
    engineFactory: () => engine,
    getVectorsDB: () => vectorsMock as never,
    getAnn: () => annMock as never,
    resolvePath: (_lib, imageId) => `/tmp/ivlib-root/${imageId}.jpg`,
    modelId: MODEL,
    dim: DIM,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettingMock.mockReturnValue(true)
  vectorsMock.listIndexedImageIds.mockReturnValue([])
  thumbsMock.listIndexableImages.mockReturnValue([
    { id: 1, relativePath: 'a.jpg' },
    { id: 2, relativePath: 'b.jpg' },
  ])
})

afterEach(() => {
  disposeAiLayer()
  resetAiLayer()
})

describe('ai-wiring 生命周期（R2 会话分时 + 引擎引用计数）', () => {
  it('层未装配引擎 → 零会话：不加载引擎、不入队', async () => {
    ensureAiLayer({ isEnabled: () => true }) // 无 engineFactory → layer.engine=null
    const { runner, cap } = makeRunner()
    const id = await enqueueIndexForLibrary(1, runner)
    expect(id).toBeNull()
    expect(runner.registerHandler).not.toHaveBeenCalled()
    expect(annMock.load).not.toHaveBeenCalled()
    expect(cap.handler).toBeNull()
  })

  it('无待嵌图片（全部已索引）→ 返回 null，不加载引擎', async () => {
    vectorsMock.listIndexedImageIds.mockReturnValue([1, 2]) // 都已索引
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    const { runner } = makeRunner()
    const id = await enqueueIndexForLibrary(1, runner)
    expect(id).toBeNull()
    expect(engine.loads).toBe(0)
    expect(annMock.load).not.toHaveBeenCalled()
  })

  it('正常路径：load 一次 → 入队返回 jobId；完成事件后落盘 ANN 并卸载引擎', async () => {
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    const { runner, cap } = makeRunner()

    const jobId = await enqueueIndexForLibrary(1, runner)
    expect(jobId).toBe('job-1')
    expect(engine.loads).toBe(1)
    expect(annMock.load).toHaveBeenCalledTimes(1)
    expect(vectorsMock.markPending).toHaveBeenCalledTimes(2) // 两张待嵌置脏

    // 处理器按单条 embed+persist（会话已 load）
    expect(cap.handler).not.toBeNull()
    await cap.handler!({ libraryId: 1, imageId: 1 })
    expect(vectorsMock.upsertEmbedding).toHaveBeenCalledTimes(1)
    expect(annMock.upsert).toHaveBeenCalledTimes(1)

    // 作业完成 → finish：落盘 ANN、引用计数归零卸载引擎、解除订阅
    expect(engine.unloads).toBe(0)
    cap.emit!({ jobId: 'job-1', state: 'done' })
    expect(annMock.unload).toHaveBeenCalledTimes(1)
    expect(engine.unloads).toBe(1)
    expect(cap.unsubscribed).toBe(1)

    // 活跃集复位：同库可再次触发
    const { runner: r2 } = makeRunner()
    const id2 = await enqueueIndexForLibrary(1, r2)
    expect(id2).toBe('job-1')
  })

  it('同库已有活跃作业 → 第二次调用直接返回 null（共享单例不被挤出）', async () => {
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    const { runner } = makeRunner()
    const first = await enqueueIndexForLibrary(1, runner)
    expect(first).toBe('job-1')

    const { runner: r2 } = makeRunner()
    const second = await enqueueIndexForLibrary(1, r2)
    expect(second).toBeNull()
    expect(r2.enqueue).not.toHaveBeenCalled()
    // 仅第一次的会话在跑：引擎只 load 一次
    expect(engine.loads).toBe(1)
  })

  it('入队异常 → 统一 finish 释放：引擎卸载、引用计数不为负、活跃集清空', async () => {
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    const { runner } = makeRunner({ enqueue: async () => { throw new Error('enqueue boom') } })
    const id = await enqueueIndexForLibrary(1, runner)
    expect(id).toBeNull()
    expect(annMock.unload).toHaveBeenCalledTimes(1)
    expect(engine.unloads).toBe(1) // 归零释放，不外泄会话

    // 计数复位后同库可再次触发
    const { runner: r2 } = makeRunner()
    const id2 = await enqueueIndexForLibrary(1, r2)
    expect(id2).toBe('job-1')
  })

  it('disposeAiLayer → 对存活会话补 finish（落盘 ANN + 卸载引擎），无需等待 done 事件', async () => {
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    const { runner } = makeRunner()
    await enqueueIndexForLibrary(1, runner)
    expect(engine.unloads).toBe(0)

    disposeAiLayer()
    expect(annMock.unload).toHaveBeenCalledTimes(1)
    expect(engine.unloads).toBe(1)
    resetAiLayer()
    expect(getAiLayer()).toBeNull()
  })
})
