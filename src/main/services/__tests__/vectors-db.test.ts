import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// database.ts 顶部 import electron（MasterDB 用 app.getPath），VectorsDB 不用，但整模块加载需占位
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { VectorsDB, getVectorsDB, closeVectorsDB, closeAllDatabases } from '../database'

/** 创建临时库目录并初始化一个 VectorsDB */
function createTestVectorsDB(): { db: VectorsDB; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-vectors-test-'))
  const db = new VectorsDB()
  db.initialize(tmpDir)
  return { db, tmpDir }
}

const MODEL = 'clip-vit-b32-int8'
const vec = (n: number, fill: number): Uint8Array => new Uint8Array(n).fill(fill)

describe('VectorsDB（Phase 9 M5 · vectors.db 独立分库）', () => {
  let db: VectorsDB
  let tmpDir: string

  beforeEach(() => {
    const t = createTestVectorsDB()
    db = t.db
    tmpDir = t.tmpDir
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('落点在 .ivlib/vectors.db（独立于 thumbs.db）', () => {
    expect(db.getDbPath()).toBe(path.join(tmpDir, '.ivlib', 'vectors.db'))
    expect(fs.existsSync(db.getDbPath())).toBe(true)
    // 不应创建 thumbs.db —— 两库物理隔离（R5：不抢缩略图页缓存）
    expect(fs.existsSync(path.join(tmpDir, '.ivlib', 'thumbs.db'))).toBe(false)
  })

  it('库路径不存在时 initialize 抛错', () => {
    const v = new VectorsDB()
    expect(() => v.initialize(path.join(os.tmpdir(), 'iv-vectors-no-such-' + Date.now()))).toThrow(/库路径不存在/)
  })

  it('createTables 幂等（重复 initialize 不报错、不丢数据）', () => {
    db.upsertEmbedding({ imageId: 1, modelId: MODEL, dim: 4, quant: 'int8', vector: vec(4, 7) })
    const p = db.getDbPath()
    db.close()
    const reopened = new VectorsDB()
    reopened.initialize(tmpDir)
    expect(reopened.countByModel(MODEL)).toBe(1)
    expect(reopened.getEmbedding(1)?.vector).toEqual(vec(4, 7))
    reopened.close()
    // 让 afterEach 的 db.close() 成为 no-op（已关）
    db = reopened
    void p
  })

  it('upsertEmbedding 幂等且写后 dirty=0', () => {
    db.upsertEmbedding({ imageId: 10, modelId: MODEL, dim: 3, quant: 'int8', vector: vec(3, 1) })
    db.upsertEmbedding({ imageId: 10, modelId: MODEL, dim: 3, quant: 'int8', vector: vec(3, 2) })
    expect(db.countByModel(MODEL)).toBe(1)
    expect(db.getEmbedding(10)?.vector).toEqual(vec(3, 2))
    expect(db.countDirty()).toBe(0)
  })

  it('markDirty / getDirtyImageIds / countDirty 协同（索引作业取待处理）', () => {
    for (const id of [1, 2, 3]) {
      db.upsertEmbedding({ imageId: id, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, id) })
    }
    db.markDirty(2)
    db.markDirty(3)
    expect(db.countDirty()).toBe(2)
    expect(db.getDirtyImageIds(10)).toEqual([2, 3])
    // limit 分批
    expect(db.getDirtyImageIds(1)).toEqual([2])
  })

  it('重新 upsert 会清除 dirty 位', () => {
    db.upsertEmbedding({ imageId: 5, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 9) })
    db.markDirty(5)
    expect(db.countDirty()).toBe(1)
    db.upsertEmbedding({ imageId: 5, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 9) })
    expect(db.countDirty()).toBe(0)
  })

  it('markPending：无行插占位脏行、有行标脏（新图片可入队）', () => {
    db.markPending(20, MODEL, 4) // 无行 → 零向量占位脏行
    expect(db.countDirty()).toBe(1)
    expect(db.getDirtyImageIds(10)).toEqual([20])
    expect(db.getEmbedding(20)?.vector).toEqual(vec(4, 0))
    expect(db.getEmbedding(20)?.dim).toBe(4)
    db.markPending(20, MODEL, 4) // 幂等仍脏
    expect(db.countDirty()).toBe(1)
    db.upsertEmbedding({ imageId: 21, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 5) })
    db.markPending(21, MODEL, 2) // 有干净行 → 标脏
    expect(db.countDirty()).toBe(2) // 20 + 21
  })

  it('listIndexedImageIds：仅返回该模型且 dirty=0 的 id', () => {
    db.upsertEmbedding({ imageId: 1, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 1) })
    db.upsertEmbedding({ imageId: 2, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 2) })
    db.upsertEmbedding({ imageId: 3, modelId: 'chinese-clip', dim: 2, quant: 'int8', vector: vec(2, 3) })
    db.markPending(4, MODEL, 2) // 占位脏行，不计入
    db.markDirty(2) // 变脏，应被排除
    expect(db.listIndexedImageIds(MODEL)).toEqual([1])
  })

  it('countByModel 按 model_id 隔离（§9.7 模型绑定）', () => {
    db.upsertEmbedding({ imageId: 1, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 1) })
    db.upsertEmbedding({ imageId: 2, modelId: 'chinese-clip', dim: 2, quant: 'int8', vector: vec(2, 1) })
    expect(db.countByModel(MODEL)).toBe(1)
    expect(db.countByModel('chinese-clip')).toBe(1)
    expect(db.countByModel('nonexistent')).toBe(0)
  })

  it('getEmbedding 返回 quant/dim/vector，缺失返回 undefined', () => {
    db.upsertEmbedding({ imageId: 42, modelId: MODEL, dim: 5, quant: 'int8', vector: vec(5, 3) })
    const got = db.getEmbedding(42)
    expect(got?.dim).toBe(5)
    expect(got?.quant).toBe('int8')
    expect(got?.model_id).toBe(MODEL)
    expect(got?.vector).toEqual(vec(5, 3))
    expect(db.getEmbedding(999)).toBeUndefined()
  })

  it('deleteEmbedding 移除单条', () => {
    db.upsertEmbedding({ imageId: 7, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 1) })
    db.deleteEmbedding(7)
    expect(db.getEmbedding(7)).toBeUndefined()
    expect(db.countByModel(MODEL)).toBe(0)
  })

  it('getRawDb 暴露连接（供 vec0/HNSW 建索引与 ANN 查询）', () => {
    const raw = db.getRawDb()
    expect(raw).toBeTruthy()
    const row = raw!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_embeddings'").get() as { name: string } | undefined
    expect(row?.name).toBe('image_embeddings')
  })
})

describe('vectors.db 生命周期管理（getVectorsDB / closeVectorsDB / closeAllDatabases）', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-vectors-mgr-'))
  })

  afterEach(() => {
    closeAllDatabases()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('getVectorsDB 按库懒开并复用同一实例', () => {
    const a = getVectorsDB(tmpDir)
    const b = getVectorsDB(tmpDir)
    expect(a).toBe(b)
    a.upsertEmbedding({ imageId: 1, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 1) })
    expect(b.countByModel(MODEL)).toBe(1)
  })

  it('closeVectorsDB 移除实例，下次重开为新实例但数据仍在', () => {
    const a = getVectorsDB(tmpDir)
    a.upsertEmbedding({ imageId: 1, modelId: MODEL, dim: 2, quant: 'int8', vector: vec(2, 5) })
    closeVectorsDB(tmpDir)
    const c = getVectorsDB(tmpDir)
    expect(c).not.toBe(a)
    expect(c.countByModel(MODEL)).toBe(1)
  })

  it('closeAllDatabases 关闭所有 vectors.db 实例', () => {
    const a = getVectorsDB(tmpDir)
    closeAllDatabases()
    // 关闭后原实例连接失效，重新获取会新建
    const b = getVectorsDB(tmpDir)
    expect(b).not.toBe(a)
    expect(fs.existsSync(b.getDbPath())).toBe(true)
  })
})
