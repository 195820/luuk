import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { VectorsDB } from '../../database'
import { getVectorIndexService, closeAllVectorIndexServices } from '../../vectors/vector-index-service'
import { FakeEmbeddingEngine, type EmbeddingEngine } from '../embedding-engine'
import {
  runAiIndexSession,
  embedAndPersistOne,
  registerAiIndexHandler,
  AI_INDEX_JOB_KIND,
  type IndexDeps,
} from '../index-session'

const DIM = 8

/** 在库中造一条"待索引"向量：先落一行（dirty=0）再标脏，模拟 scanner 检测到变动 */
function seedDirty(db: VectorsDB, imageId: number) {
  db.upsertEmbedding({ imageId, modelId: 'x', dim: DIM, quant: 'int8', vector: new Uint8Array(DIM) })
  db.markDirty(imageId)
}

describe('runAiIndexSession（Phase 9 M5 · T21 R2 会话分时索引编排）', () => {
  let tmpDir: string
  let db: VectorsDB

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-idxsess-'))
    db = new VectorsDB()
    db.initialize(tmpDir)
  })

  afterEach(() => {
    closeAllVectorIndexServices()
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function deps(engine: EmbeddingEngine, resolvePath: (id: number) => string | null): IndexDeps {
    return { vectorsDB: db, engine, ann: getVectorIndexService(tmpDir, DIM), resolvePath }
  }

  it('脏项 → 全部 embed 落库、清脏，引擎只 load/unload 各一次', async () => {
    seedDirty(db, 1); seedDirty(db, 2); seedDirty(db, 3)
    const engine = new FakeEmbeddingEngine('fake', DIM)
    const res = await runAiIndexSession(deps(engine, (id) => `/img/${id}`))
    expect(res).toEqual({ processed: 3, skipped: 0, failed: 0 })
    expect(db.countDirty()).toBe(0)
    expect(engine.loads).toBe(1)
    expect(engine.unloads).toBe(1)
    expect(engine.embedCalls).toBe(3)
    expect(db.getEmbedding(1)?.quant).toBe('int8')
    // 会话结束 ann.unload 落盘
    expect(fs.existsSync(path.join(tmpDir, '.ivlib', 'vectors.usearch'))).toBe(true)
  })

  it('embed 失败的项保留 dirty（可重试）且不会死循环', async () => {
    seedDirty(db, 1); seedDirty(db, 2)
    const engine = new FakeEmbeddingEngine('fake', DIM)
    const boom = new Set<number>()
    // 包一层：路径含 /bad 时抛错
    const failing: EmbeddingEngine = {
      modelId: engine.modelId,
      dim: DIM,
      load: () => engine.load(),
      unload: () => engine.unload(),
      isLoaded: () => engine.isLoaded(),
      embed: async (p: string) => { if (p.includes('/bad')) throw new Error('decode fail'); return engine.embed(p) },
    }
    const res = await runAiIndexSession({ ...deps(failing, (id) => (id === 2 ? '/bad/2' : `/img/${id}`)), batchSize: 1 })
    expect(res.processed).toBe(1)
    expect(res.failed).toBe(1)
    expect(boom.size).toBe(0)
    expect(db.countDirty()).toBe(1) // id2 仍脏
    expect(db.getDirtyImageIds(10)).toEqual([2])
  })

  it('路径解析不到 → skipped，不落库（保留 dirty）', async () => {
    seedDirty(db, 7)
    const engine = new FakeEmbeddingEngine('fake', DIM)
    const res = await runAiIndexSession(deps(engine, () => null))
    expect(res).toEqual({ processed: 0, skipped: 1, failed: 0 })
    expect(db.countDirty()).toBe(1)
    expect(engine.embedCalls).toBe(0)
  })

  it('无脏活 → 直接返回，不开推理会话', async () => {
    const engine = new FakeEmbeddingEngine('fake', DIM)
    const res = await runAiIndexSession(deps(engine, (id) => `/img/${id}`))
    expect(res).toEqual({ processed: 0, skipped: 0, failed: 0 })
    expect(engine.loads).toBe(0)
    expect(engine.unloads).toBe(0)
  })

  it('embedAndPersistOne：engine 未 load 时抛错被记为 failed', async () => {
    seedDirty(db, 9)
    const ann = getVectorIndexService(tmpDir, DIM)
    ann.load(db)
    const engine = new FakeEmbeddingEngine('fake', DIM) // 未 load
    const status = await embedAndPersistOne({ vectorsDB: db, engine, ann, resolvePath: () => '/x' }, 9)
    expect(status).toBe('failed')
    ann.close()
  })

  it('registerAiIndexHandler 注册 ai.clip-index 并处理单条', async () => {
    let handler: ((item: { imageId: number | null }) => Promise<void>) | null = null
    const runner = { registerHandler: (_k: string, h: (item: { imageId: number | null }) => Promise<void>) => { handler = h } }
    const engine = new FakeEmbeddingEngine('fake', DIM)
    const ann = getVectorIndexService(tmpDir, DIM)
    await engine.load()
    ann.load(db)
    registerAiIndexHandler(runner, { vectorsDB: db, engine, ann, resolvePath: (id: number) => `/img/${id}` })
    expect(handler).not.toBeNull()
    await handler!({ imageId: 5 })
    expect(db.getEmbedding(5)?.model_id).toBe('fake')
    await handler!({ imageId: null }) // 空 imageId：no-op
    await engine.unload()
    ann.close()
    void AI_INDEX_JOB_KIND
  })
})
