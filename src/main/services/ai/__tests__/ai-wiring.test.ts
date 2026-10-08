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
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import type { JobRunner } from '../../job-runner'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

// 可配置的 getSetting（默认 ai.enabled=true，用例按需覆盖）
const getSettingMock = vi.fn((_key: string) => true)
vi.mock('../../settings-service', () => ({
  getSetting: (key: string) => getSettingMock(key),
  setSetting: vi.fn(),
}))

// ann 替身：load/unload/upsert/search/isOpen 记录调用
const annMock = {
  load: vi.fn(),
  unload: vi.fn(),
  upsert: vi.fn(),
  isOpen: vi.fn(() => true),
  search: vi.fn(() => [] as Array<{ id: number; distance: number }>),
  getModelId: vi.fn(() => 'clip-vit-b32-int8'),
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
  countIndexed: vi.fn(() => 5),
  getEmbedding: vi.fn(() => undefined as { model_id: string; vector: Uint8Array } | undefined),
}
const thumbsMock = {
  listIndexableImages: vi.fn(() => [
    { id: 1, relativePath: 'a.jpg' },
    { id: 2, relativePath: 'b.jpg' },
  ]),
  getImageRelativePath: vi.fn((id: number) => `${id}.jpg`),
  getImageByRelativePath: vi.fn((_rel: string) => null as { id: number } | null),
  listImageIdsWithoutQuality: vi.fn(() => [] as number[]),
  upsertQualityScore: vi.fn(),
}
const masterMock = {
  getLibrary: vi.fn((id: number) => ({ id, rootPath: '/tmp/ivlib-root', status: 'online' })),
  listTagNames: vi.fn(() => [] as string[]),
  listTagNamesForLibrary: vi.fn(() => [] as string[]),
  getFavorites: vi.fn(() => [] as Array<{ library_id: number; image_path: string; tags: string[]; rating: number }>),
}
// T23 提案存储替身（处理器落提案/防重查询不经真 MasterDB）
const storeMock = {
  create: vi.fn(),
  hasPendingForQualityImage: vi.fn(() => false),
}
vi.mock('../../agent/proposal-store', () => ({
  getProposalStore: () => storeMock as never,
}))
vi.mock('../../database', () => ({
  getVectorsDB: () => vectorsMock,
  getThumbnailsDB: () => thumbsMock,
  getMasterDB: () => masterMock,
}))

import { FakeEmbeddingEngine } from '../embedding-engine'
import { FakeTextEncoder } from '../text-encoder'
import { ensureAiLayer, resetAiLayer, getAiLayer } from '../ai-bootstrap'
import {
  enqueueIndexForLibrary, disposeAiLayer, runSemanticQuery, setQueryTextEncoder,
  setQueryImageResolver, loadTokenizerFromFile, enqueueLabelForLibrary, enqueueQualityForLibrary,
  firstLocalMedia, runVisualSimilarity,
} from '../ai-wiring'

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
  vectorsMock.countIndexed.mockReturnValue(5) // 默认本库已有干净索引行（查询守卫放行）
  vectorsMock.getEmbedding.mockReturnValue(undefined)
  annMock.isOpen.mockReturnValue(true)
  annMock.search.mockReturnValue([])
  annMock.getModelId.mockReturnValue('clip-vit-b32-int8')
  thumbsMock.listIndexableImages.mockReturnValue([
    { id: 1, relativePath: 'a.jpg' },
    { id: 2, relativePath: 'b.jpg' },
  ])
  thumbsMock.listImageIdsWithoutQuality.mockReturnValue([])
  thumbsMock.getImageByRelativePath.mockReturnValue(null)
  masterMock.listTagNames.mockReturnValue([])
  masterMock.listTagNamesForLibrary.mockReturnValue([])
  masterMock.getFavorites.mockReturnValue([])
  masterMock.getLibrary.mockImplementation((id: number) => ({ id, rootPath: '/tmp/ivlib-root', status: 'online' }))
  storeMock.hasPendingForQualityImage.mockReturnValue(false)
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

describe('ai-wiring 查询会话（T22 runSemanticQuery：文本引用计数 + idle TTL + 索引互斥）', () => {
  /** 装配图像层（使 getAiLayer 非空）+ 注入 FakeTextEncoder 与映射器（查询链不碰图像引擎） */
  function setupQuery(): { tenc: FakeTextEncoder } {
    buildLayer(new FakeEmbeddingEngine(MODEL, DIM))
    const tenc = new FakeTextEncoder('clip-text', DIM)
    setQueryTextEncoder(tenc)
    setQueryImageResolver((_lib, id) => ({ id, relative_path: `${id}.jpg` }))
    return { tenc }
  }

  it('无文本编码器 → [] 且零会话（不 load ANN）', async () => {
    buildLayer(new FakeEmbeddingEngine(MODEL, DIM))
    setQueryTextEncoder(null)
    setQueryImageResolver(() => null)
    expect(await runSemanticQuery(1, 'a cat', 5)).toEqual([])
    expect(annMock.load).not.toHaveBeenCalled()
  })

  it('无映射器 → []，不加载编码器', async () => {
    const { tenc } = setupQuery()
    setQueryImageResolver(null)
    expect(await runSemanticQuery(1, 'a cat', 5)).toEqual([])
    expect(tenc.loads).toBe(0)
  })

  it('空查询 → [] 且不加载编码器/不建会话', async () => {
    const { tenc } = setupQuery()
    expect(await runSemanticQuery(1, '   ', 5)).toEqual([])
    expect(tenc.loads).toBe(0)
    expect(annMock.load).not.toHaveBeenCalled()
  })

  it('正常：编码器 load + ANN 复用（isOpen）→ 组装 Image+similarity，不自卸载', async () => {
    const { tenc } = setupQuery()
    annMock.isOpen.mockReturnValue(true)
    annMock.search.mockReturnValue([{ id: 7, distance: 0.1 }, { id: 3, distance: 0.4 }])
    const res = await runSemanticQuery(1, 'a cat', 5)
    expect(tenc.loads).toBe(1)
    expect(annMock.load).not.toHaveBeenCalled()
    expect(res.map((r) => r.id)).toEqual([7, 3])
    expect(res[0].similarity).toBe(90)
    expect(annMock.unload).not.toHaveBeenCalled()
  })

  it('ANN 关闭且无索引 → 查询自加载并在结束后卸载', async () => {
    const { tenc } = setupQuery()
    annMock.isOpen.mockReturnValue(false)
    annMock.search.mockReturnValue([{ id: 1, distance: 0.2 }])
    const res = await runSemanticQuery(1, 'cat', 3)
    expect(tenc.loads).toBe(1)
    expect(annMock.load).toHaveBeenCalledTimes(1)
    expect(res[0].similarity).toBe(80)
    expect(annMock.unload).toHaveBeenCalledTimes(1)
  })

  it('只读守卫（#7）：本库无干净索引向量 → [] 且不 load ANN（不在未索引库落盘 sidecar）', async () => {
    const { tenc } = setupQuery()
    vectorsMock.countIndexed.mockReturnValue(0)
    annMock.isOpen.mockReturnValue(false)
    const res = await runSemanticQuery(1, 'cat', 3)
    expect(res).toEqual([])
    expect(tenc.loads).toBe(0)
    expect(annMock.load).not.toHaveBeenCalled()
    expect(annMock.unload).not.toHaveBeenCalled()
  })

  it('模型绑定守卫（#8 · §9.7）：ANN 模型 ≠ 查询模型 → [] 且不建会话', async () => {
    const { tenc } = setupQuery()
    annMock.getModelId.mockReturnValue('some-other-model')
    const res = await runSemanticQuery(1, 'cat', 3)
    expect(res).toEqual([])
    expect(tenc.loads).toBe(0)
    expect(annMock.load).not.toHaveBeenCalled()
  })

  it('索引会话活跃 → 查询即便自加载也绝不卸载其 ANN（不夺所有权）', async () => {
    buildLayer(new FakeEmbeddingEngine(MODEL, DIM))
    setQueryTextEncoder(new FakeTextEncoder('clip-text', DIM))
    setQueryImageResolver((_l, id) => ({ id }))
    const { runner, cap } = makeRunner()
    await enqueueIndexForLibrary(1, runner) // librarySessions.has(1)=true
    annMock.unload.mockClear()
    annMock.isOpen.mockReturnValue(false) // 逼查询走自加载分支
    annMock.search.mockReturnValue([{ id: 1, distance: 0.1 }])
    const res = await runSemanticQuery(1, 'cat', 3)
    expect(res.length).toBe(1)
    expect(annMock.unload).not.toHaveBeenCalled() // 索引接管 → 让位不卸载
    cap.emit!({ jobId: 'job-1', state: 'done' })
    expect(annMock.unload).toHaveBeenCalledTimes(1) // 由索引自己卸载
  })

  it('空闲 TTL：末次查询后驻留，60s 无新查询则卸载编码器', async () => {
    vi.useFakeTimers()
    try {
      const { tenc } = setupQuery()
      annMock.isOpen.mockReturnValue(true)
      annMock.search.mockReturnValue([{ id: 1, distance: 0.1 }])
      await runSemanticQuery(1, 'cat', 3)
      expect(tenc.unloads).toBe(0)
      vi.advanceTimersByTime(60_000)
      expect(tenc.unloads).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('TTL 内新查询取消卸载（复用驻留会话）', async () => {
    vi.useFakeTimers()
    try {
      const { tenc } = setupQuery()
      annMock.isOpen.mockReturnValue(true)
      annMock.search.mockReturnValue([{ id: 1, distance: 0.1 }])
      await runSemanticQuery(1, 'cat', 3)
      vi.advanceTimersByTime(30_000)
      await runSemanticQuery(1, 'dog', 3)
      vi.advanceTimersByTime(30_000) // 距上次仅 30s < TTL
      expect(tenc.unloads).toBe(0)
      vi.advanceTimersByTime(60_000) // 再满 TTL → 卸载
      expect(tenc.unloads).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('层未装配（disable）→ []', async () => {
    resetAiLayer()
    setQueryTextEncoder(new FakeTextEncoder('clip-text', DIM))
    setQueryImageResolver((_l, id) => ({ id }))
    expect(await runSemanticQuery(1, 'cat', 3)).toEqual([])
  })
})

describe('ai-wiring 资产载入（#9）', () => {
  it('loadTokenizerFromFile 路径不存在 → null（不抛，语义搜索退回空结果）', () => {
    expect(loadTokenizerFromFile('/no/such/clip-tokenizer.json')).toBeNull()
  })
  it('loadTokenizerFromFile 载入入库 fixture → 非空分词器', () => {
    const p = path.join(import.meta.dirname, '__fixtures__', 'clip-tokenizer.json')
    expect(loadTokenizerFromFile(p)).not.toBeNull()
  })
})

// ==================== T23 · 标签/质量作业接线 ====================

describe('ai-wiring T23 标签作业（enqueueLabelForLibrary）', () => {
  /** 装配带引擎层 + 注入文本编码器；返回编码器替身 */
  function setupLabelEncoder(): FakeTextEncoder {
    ensureAiLayer({
      isEnabled: () => true,
      engineFactory: () => new FakeEmbeddingEngine(MODEL, DIM),
      getVectorsDB: () => vectorsMock as never,
      getAnn: () => annMock as never,
      resolvePath: (_l, id) => `/tmp/ivlib-root/${id}.jpg`,
      modelId: MODEL,
      dim: DIM,
    })
    const tenc = new FakeTextEncoder('clip-text-b32', DIM)
    setQueryTextEncoder(tenc)
    return tenc
  }

  it('短路：门禁关 / 无编码器 / 无已索引图 → 全 null 且零会话', async () => {
    const tenc = setupLabelEncoder()
    getSettingMock.mockReturnValue(false)
    expect(await enqueueLabelForLibrary(1, makeRunner().runner)).toBeNull()
    getSettingMock.mockReturnValue(true)
    setQueryTextEncoder(null)
    expect(await enqueueLabelForLibrary(1, makeRunner().runner)).toBeNull()
    setQueryTextEncoder(tenc)
    vectorsMock.listIndexedImageIds.mockReturnValue([])
    expect(await enqueueLabelForLibrary(1, makeRunner().runner)).toBeNull()
    expect(annMock.load).not.toHaveBeenCalled()
    expect(tenc.encodeCalls).toBe(0)
  })

  it('正常：批量编码 prompt → handler 产 quality 提案；库守卫串行；done 收尾后可再次入队', async () => {
    const tenc = setupLabelEncoder()
    await tenc.load()
    const vec = await tenc.encode('a photo of a portrait') // 图像向量 == portrait prompt → 强命中
    vectorsMock.getEmbedding.mockReturnValue({ model_id: MODEL, vector: vec })
    vectorsMock.listIndexedImageIds.mockReturnValue([1])

    const { runner, cap } = makeRunner()
    expect(await enqueueLabelForLibrary(1, runner)).toBe('job-1')
    // 同库活跃守卫：索引/标签共享 librarySessions → 第二次直接 null
    expect(await enqueueLabelForLibrary(1, makeRunner().runner)).toBeNull()
    // 标签链不碰 ANN（只读 vectors.db 行，规避查询互斥）
    expect(annMock.load).not.toHaveBeenCalled()

    await cap.handler!({ libraryId: 1, imageId: 1 })
    expect(tenc.encodeCalls).toBeGreaterThan(40) // 首条懒构建：内置 ~40 项 prompt 批量编码（含事前 1 次单条）
    expect(storeMock.create).toHaveBeenCalledTimes(1)
    const input = storeMock.create.mock.calls[0][0] as never as { agentKind: string; payload: { imageRelativePath: string; suggestions: Array<{ tagName: string }> } }
    expect(input.agentKind).toBe('quality')
    expect(input.payload.imageRelativePath).toBe('1.jpg')
    expect(input.payload.suggestions[0].tagName).toBe('portrait')

    // done → 退订 + 释放库守卫 → 可再次入队
    cap.emit!({ jobId: 'job-1', state: 'done' })
    expect(cap.unsubscribed).toBe(1)
    expect(await enqueueLabelForLibrary(1, makeRunner().runner)).toBe('job-1')
  })

  it('候选取本库标签（D-2）且标签集变化触发 prompt 重建', async () => {
    const tenc = setupLabelEncoder()
    await tenc.load()
    // 'cat' 非内置类，仅当候选来自本库标签才会命中（验证口径为本库而非全局 listTagNames）
    const vec = await tenc.encode('a photo of a cat')
    vectorsMock.getEmbedding.mockReturnValue({ model_id: MODEL, vector: vec })
    vectorsMock.listIndexedImageIds.mockReturnValue([1])
    masterMock.listTagNamesForLibrary.mockReturnValue(['Cat'])
    const { runner, cap } = makeRunner()
    await enqueueLabelForLibrary(1, runner)
    await cap.handler!({ libraryId: 1, imageId: 1 })
    expect(masterMock.listTagNames).not.toHaveBeenCalled()
    expect(masterMock.listTagNamesForLibrary).toHaveBeenCalledWith(1)
    expect(storeMock.create.mock.calls[0][0].payload.suggestions[0].tagName).toBe('Cat')
    // 标签集变化 → signature 变 → 重建 prompt 向量（同编码器实例下仍重编）
    const callsAfterFirst = tenc.encodeCalls
    masterMock.listTagNamesForLibrary.mockReturnValue(['Cat', 'Dog'])
    await cap.handler!({ libraryId: 1, imageId: 1 })
    expect(tenc.encodeCalls).toBeGreaterThan(callsAfterFirst)
  })

  it('handler 幂等：同图已有 pending 提案 → done 不重复产提案', async () => {
    const tenc = setupLabelEncoder()
    await tenc.load()
    const vec = await tenc.encode('a photo of a portrait')
    vectorsMock.getEmbedding.mockReturnValue({ model_id: MODEL, vector: vec })
    vectorsMock.listIndexedImageIds.mockReturnValue([1])
    storeMock.hasPendingForQualityImage.mockReturnValue(true)
    const { runner, cap } = makeRunner()
    await enqueueLabelForLibrary(1, runner)
    await cap.handler!({ libraryId: 1, imageId: 1 })
    expect(storeMock.create).not.toHaveBeenCalled()
  })

  it('模型绑定不符（§9.7）/缺行 → skipped 不抛不产提案', async () => {
    const tenc = setupLabelEncoder()
    await tenc.load()
    const vec = await tenc.encode('a photo of a portrait')
    vectorsMock.getEmbedding.mockReturnValue({ model_id: 'other-model', vector: vec })
    vectorsMock.listIndexedImageIds.mockReturnValue([1])
    const { runner, cap } = makeRunner()
    await enqueueLabelForLibrary(1, runner)
    await expect(cap.handler!({ libraryId: 1, imageId: 1 })).resolves.toBeUndefined()
    expect(storeMock.create).not.toHaveBeenCalled()
  })

  it('入队异常 → finish 清守卫，不阻塞后续入队', async () => {
    setupLabelEncoder()
    vectorsMock.getEmbedding.mockReturnValue({ model_id: MODEL, vector: new Uint8Array(DIM).fill(10) })
    vectorsMock.listIndexedImageIds.mockReturnValue([1])
    const { runner } = makeRunner({ enqueue: async () => { throw new Error('boom') } })
    expect(await enqueueLabelForLibrary(1, runner)).toBeNull()
    expect(await enqueueLabelForLibrary(1, makeRunner().runner)).toBe('job-1')
  })
})

describe('ai-wiring T23 质量作业（enqueueQualityForLibrary）', () => {
  let qDir: string

  beforeAll(async () => {
    qDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-q-'))
    const px = new Uint8Array(60 * 40 * 3).fill(128)
    await sharp(Buffer.from(px), { raw: { width: 60, height: 40, channels: 3 } }).png().toFile(path.join(qDir, 'q.png'))
  })
  afterAll(() => {
    fs.rmSync(qDir, { recursive: true, force: true })
  })

  it('门禁关 → null；项集：增量=listImageIdsWithoutQuality，force=全量 listIndexableImages', async () => {
    getSettingMock.mockReturnValue(false)
    expect(await enqueueQualityForLibrary(1, makeRunner().runner)).toBeNull()
    getSettingMock.mockReturnValue(true)

    thumbsMock.listImageIdsWithoutQuality.mockReturnValue([1, 2])
    const a = makeRunner()
    expect(await enqueueQualityForLibrary(1, a.runner)).toBe('job-1')
    const callA = vi.mocked(a.runner.enqueue).mock.calls[0] as never as [string, unknown, { items: unknown[] }]
    expect(callA[0]).toBe('ai.quality')
    expect(callA[1]).toEqual({ libraryId: 1, force: false })
    expect(callA[2].items).toHaveLength(2)

    const b = makeRunner()
    expect(await enqueueQualityForLibrary(1, b.runner, true)).toBe('job-1')
    const callB = vi.mocked(b.runner.enqueue).mock.calls[0] as never as [string, unknown, { items: unknown[] }]
    expect(callB[1]).toEqual({ libraryId: 1, force: true })
    expect(callB[2].items).toHaveLength(2)
  })

  it('无待处理图 → null 不入队', async () => {
    const r = makeRunner()
    expect(await enqueueQualityForLibrary(1, r.runner)).toBeNull()
    expect(r.runner.enqueue).not.toHaveBeenCalled()
  })

  it('handler：真图打分 → upsertQualityScore(heuristic-v1)；缺文件 → 抛错记 failed', async () => {
    masterMock.getLibrary.mockImplementation((id: number) => ({ id, rootPath: qDir, status: 'online' }))
    thumbsMock.getImageRelativePath.mockReturnValue('q.png')
    thumbsMock.listImageIdsWithoutQuality.mockReturnValue([7])
    const { runner, cap } = makeRunner()
    expect(await enqueueQualityForLibrary(1, runner)).toBe('job-1')
    expect(runner.registerHandler).toHaveBeenCalledWith('ai.quality', expect.any(Function))

    await cap.handler!({ libraryId: 1, imageId: 7 })
    expect(thumbsMock.upsertQualityScore).toHaveBeenCalledTimes(1)
    const input = thumbsMock.upsertQualityScore.mock.calls[0][0] as never as { imageId: number; modelId: string; total: number }
    expect(input).toMatchObject({ imageId: 7, modelId: 'heuristic-v1' })
    expect(typeof input.total).toBe('number')

    thumbsMock.getImageRelativePath.mockReturnValue('missing.png')
    await expect(cap.handler!({ libraryId: 1, imageId: 8 })).rejects.toThrow(/ai-quality/)
  })
})

// ── T24 视觉相似度：firstLocalMedia 纯函数 + runVisualSimilarity 会话/回退 ──

describe('T24 firstLocalMedia（候选本地媒体识别）', () => {
  it('file:// 转绝对路径；win/posix 绝对路径直收', () => {
    expect(firstLocalMedia({ mediaUrls: ['file:///C:/media/a.jpg'] })).toBe('C:\\media\\a.jpg')
    expect(firstLocalMedia({ mediaUrls: ['C:\\media\\a.jpg'] })).toBe('C:\\media\\a.jpg')
    expect(firstLocalMedia({ mediaUrls: ['/mnt/a.jpg'] })).toBe('/mnt/a.jpg')
    expect(firstLocalMedia({ mediaUrls: ['\\\\srv\\share\\a.jpg'] })).toBe('\\\\srv\\share\\a.jpg')
  })

  it('纯远端 URL/协议相对 URL/空集 → null（打分期不拉网络）', () => {
    expect(firstLocalMedia({ mediaUrls: [] })).toBeNull()
    expect(firstLocalMedia({ mediaUrls: ['https://cdn/1.jpg', 'http://cdn/2.jpg'] })).toBeNull()
    expect(firstLocalMedia({ mediaUrls: ['//cdn/1.jpg'] })).toBeNull()
    expect(firstLocalMedia({ mediaUrls: ['relative/a.jpg'] })).toBeNull()
  })

  it('混合媒体取首个本地项', () => {
    expect(firstLocalMedia({ mediaUrls: ['https://cdn/x.jpg', '/data/a.jpg', '/data/b.jpg'] })).toBe('/data/a.jpg')
  })
})

describe('T24 runVisualSimilarity（图像-图像相似度，零 ANN 零文本塔）', () => {
  it('前置不满足一律 null：门禁关/无库/无引擎/无收藏/收藏未索引', async () => {
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    // 门禁关
    getSettingMock.mockReturnValue(false)
    expect(await runVisualSimilarity(1, '/tmp/x.jpg')).toBeNull()
    getSettingMock.mockReturnValue(true)
    // 无库
    masterMock.getLibrary.mockReturnValue(null as never)
    expect(await runVisualSimilarity(1, '/tmp/x.jpg')).toBeNull()
    masterMock.getLibrary.mockImplementation((id: number) => ({ id, rootPath: '/tmp/ivlib-root', status: 'online' }))
    // 无收藏
    expect(await runVisualSimilarity(1, '/tmp/x.jpg')).toBeNull()
    // 收藏未索引（getEmbedding undefined / image 反查不到）
    masterMock.getFavorites.mockReturnValue([{ library_id: 1, image_path: 'fav.jpg', tags: [], rating: 0 }])
    expect(await runVisualSimilarity(1, '/tmp/x.jpg')).toBeNull()
    thumbsMock.getImageByRelativePath.mockReturnValue({ id: 5 })
    expect(await runVisualSimilarity(1, '/tmp/x.jpg')).toBeNull()
    expect(engine.embedCalls).toBe(0) // 收藏集空 → 不碰引擎
  })

  it('命中：收藏向量 ≡ 候选嵌入 → cos=1 → sim=1；会话分时 load/release 成对', async () => {
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    const candPath = '/tmp/ivlib-root/7.jpg'
    await engine.load() // 预热取确定性伪向量（测试用，不计数断言）
    const vec = await engine.embed(candPath)
    engine.loads = 0; engine.unloads = 0; engine.embedCalls = 0

    masterMock.getFavorites.mockReturnValue([
      { library_id: 1, image_path: 'a.jpg', tags: [], rating: 0 },
      { library_id: 9, image_path: 'other.jpg', tags: [], rating: 0 }, // 他库收藏被过滤
    ])
    thumbsMock.getImageByRelativePath.mockImplementation((rel: string) => (rel === 'a.jpg' ? { id: 7 } : null))
    vectorsMock.getEmbedding.mockReturnValue({ model_id: MODEL, vector: vec } as never)

    const sim = await runVisualSimilarity(1, candPath)
    expect(sim).toBeCloseTo(1, 6)
    expect(engine.embedCalls).toBe(1)
    expect(engine.loads).toBe(1)
    expect(engine.unloads).toBe(1) // 引用计数归零即卸载（R2 会话分时）
  })

  it('模型不符/占位行（长度≠dim）全被剔除 → null，不碰引擎；异库收藏 → null', async () => {
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    masterMock.getFavorites.mockReturnValue([{ library_id: 1, image_path: 'a.jpg', tags: [], rating: 0 }])
    thumbsMock.getImageByRelativePath.mockReturnValue({ id: 7 })
    vectorsMock.getEmbedding.mockReturnValue({ model_id: 'other-model', vector: new Uint8Array(DIM) } as never)
    expect(await runVisualSimilarity(1, '/tmp/x.jpg')).toBeNull()
    vectorsMock.getEmbedding.mockReturnValue({ model_id: MODEL, vector: new Uint8Array(0) } as never) // 脏占位行
    expect(await runVisualSimilarity(1, '/tmp/x.jpg')).toBeNull()
    expect(engine.embedCalls).toBe(0)
  })

  it('embed 抛错 → 静默回退 null（不阻断提案链），引用计数仍归零', async () => {
    const engine = new FakeEmbeddingEngine(MODEL, DIM)
    buildLayer(engine)
    const candPath = '/tmp/ivlib-root/7.jpg'
    await engine.load()
    const vec = await engine.embed(candPath)
    masterMock.getFavorites.mockReturnValue([{ library_id: 1, image_path: 'a.jpg', tags: [], rating: 0 }])
    thumbsMock.getImageByRelativePath.mockReturnValue({ id: 7 })
    vectorsMock.getEmbedding.mockReturnValue({ model_id: MODEL, vector: vec } as never)
    engine.unload() // 回到未加载态；内部会再 load（FakeEngine load 幂等），改用 spy 制造失败
    const spy = vi.spyOn(engine, 'embed').mockRejectedValue(new Error('ort boom'))
    expect(await runVisualSimilarity(1, candPath)).toBeNull()
    spy.mockRestore()
    // 失败路径释放后计数归零（不泄漏会话）
    engine.loads = 0; engine.unloads = 0
    expect(await runVisualSimilarity(1, candPath)).toBeCloseTo(1, 6)
    expect(engine.unloads).toBe(1)
  })
})
