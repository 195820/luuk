import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// database.ts 顶部 import electron（MasterDB 用 app.getPath），VectorsDB 不用但整模块加载需占位
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { VectorsDB } from '../../database'
import {
  VectorIndexService,
  getVectorIndexService,
  closeVectorIndexService,
  closeAllVectorIndexServices,
} from '../vector-index-service'

const DIM = 4
const MODEL = 'clip-vit-b32-int8'
const v = (a: number[]) => Uint8Array.from(a)

describe('VectorIndexService（Phase 9 M5 · 每库 HNSW sidecar，R2 会话分时 load/unload）', () => {
  let tmpDir: string
  let db: VectorsDB
  let svc: VectorIndexService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-vecsvc-'))
    db = new VectorsDB()
    db.initialize(tmpDir)
    db.upsertEmbedding({ imageId: 1, modelId: MODEL, dim: DIM, quant: 'int8', vector: v([100, 0, 0, 0]) })
    db.upsertEmbedding({ imageId: 2, modelId: MODEL, dim: DIM, quant: 'int8', vector: v([0, 100, 0, 0]) })
    db.upsertEmbedding({ imageId: 3, modelId: MODEL, dim: DIM, quant: 'int8', vector: v([98, 5, 0, 0]) })
    svc = getVectorIndexService(tmpDir, DIM)
  })

  afterEach(() => {
    closeAllVectorIndexServices()
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('未 load 时不隐式建索引：isOpen=false、search 返回空、upsert 抛错', () => {
    expect(svc.isOpen()).toBe(false)
    expect(svc.size()).toBe(0)
    expect(svc.search(v([100, 0, 0, 0]), 3)).toEqual([])
    expect(() => svc.upsert(9, v([1, 2, 3, 4]))).toThrow(/未打开/)
  })

  it('load() 无 sidecar 时从 vectors.db 全量重建', () => {
    const n = svc.rebuild(db)
    expect(n).toBe(3)
    expect(svc.size()).toBe(3)
  })

  it('load() 后按余弦检索最近邻', () => {
    svc.load(db)
    const hits = svc.search(v([100, 0, 0, 0]), 2)
    expect(hits[0].id).toBe(1)
    expect(hits[1].id).toBe(3)
  })

  it('upsert 同步新向量进内存索引并可检索', () => {
    svc.load(db)
    svc.upsert(4, v([0, 0, 100, 0]))
    expect(svc.size()).toBe(4)
    expect(svc.search(v([0, 0, 100, 0]), 1)[0].id).toBe(4)
  })

  it('remove 后从内存索引剔除', () => {
    svc.load(db)
    svc.remove(1)
    expect(svc.size()).toBe(2)
    expect(svc.search(v([100, 0, 0, 0]), 3).every(h => h.id !== 1)).toBe(true)
  })

  it('sidecar 与 vectors.db 一致（生产 upsert 成对写库）→ load 从 sidecar 恢复（非重建）', () => {
    svc.load(db)
    // 生产语义：upsertEmbedding 写 vectors.db 与 ann.upsert 写内存索引成对发生
    db.upsertEmbedding({ imageId: 4, modelId: MODEL, dim: DIM, quant: 'int8', vector: v([0, 0, 100, 0]) })
    svc.upsert(4, v([0, 0, 100, 0]))
    svc.unload()
    const sidecar = path.join(tmpDir, '.ivlib', 'vectors.usearch')
    expect(fs.existsSync(sidecar)).toBe(true)
    expect(svc.isOpen()).toBe(false)

    closeVectorIndexService(tmpDir)
    const svc2 = getVectorIndexService(tmpDir, DIM)
    const spy = vi.spyOn(svc2, 'rebuild')
    svc2.load(db)
    expect(spy).not.toHaveBeenCalled() // size 与 countIndexed 一致 → 直接恢复
    expect(svc2.size()).toBe(4)
    expect(svc2.search(v([0, 0, 100, 0]), 1)[0].id).toBe(4)
  })

  it('sidecar 陈旧（与 vectors.db 干净行数不符）→ load 全量重建，丢弃幽灵条目', () => {
    svc.load(db)
    svc.upsert(4, v([0, 0, 100, 0])) // 仅进内存索引/sidecar，未写 vectors.db → 制造不一致
    svc.unload()
    expect(fs.existsSync(path.join(tmpDir, '.ivlib', 'vectors.usearch'))).toBe(true)

    closeVectorIndexService(tmpDir)
    const svc2 = getVectorIndexService(tmpDir, DIM)
    const spy = vi.spyOn(svc2, 'rebuild')
    svc2.load(db)
    expect(spy).toHaveBeenCalledTimes(1) // 检测到陈旧 → 从源真相重建
    expect(svc2.size()).toBe(3) // 丢弃 vectors.db 中不存在的幽灵 id=4
  })
})

describe('A-3 换模型删除 stale sidecar（跨模型污染防线，§9.7）', () => {
  let tmpDir: string
  let db: VectorsDB
  const sidecarOf = (p: string) => path.join(p, '.ivlib', 'vectors.usearch')
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-vecswitch-'))
    db = new VectorsDB()
    db.initialize(tmpDir)
    db.upsertEmbedding({ imageId: 1, modelId: 'M1', dim: DIM, quant: 'int8', vector: v([100, 0, 0, 0]) })
    db.upsertEmbedding({ imageId: 2, modelId: 'M1', dim: DIM, quant: 'int8', vector: v([0, 100, 0, 0]) })
  })
  afterEach(() => {
    closeAllVectorIndexServices()
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('换模型（M1→M2）→ 删除旧 sidecar，新会话从 vectors.db 重建（不把 M1 图当 M2 用）', () => {
    const svcM1 = getVectorIndexService(tmpDir, DIM, 'M1')
    svcM1.load(db)
    svcM1.unload() // 落盘 M1 sidecar
    expect(fs.existsSync(sidecarOf(tmpDir))).toBe(true)

    const svcM2 = getVectorIndexService(tmpDir, DIM, 'M2') // 换模型
    expect(svcM2.getModelId()).toBe('M2')
    expect(svcM2).not.toBe(svcM1)
    expect(fs.existsSync(sidecarOf(tmpDir))).toBe(false) // A-3：旧 sidecar 被删（修复前仍存在）

    const spy = vi.spyOn(svcM2, 'rebuild')
    svcM2.load(db) // M2 无自己行 → 走重建而非载入 stale sidecar
    expect(spy).toHaveBeenCalledTimes(1)
    expect(svcM2.size()).toBe(0)
  })

  it('同模型复用 → 返回同一实例，不删 sidecar、不重建', () => {
    const svcA = getVectorIndexService(tmpDir, DIM, 'M1')
    svcA.load(db)
    svcA.unload()
    expect(fs.existsSync(sidecarOf(tmpDir))).toBe(true)
    const svcB = getVectorIndexService(tmpDir, DIM, 'M1')
    expect(svcB).toBe(svcA) // 同 dim+modelId → 复用
    expect(fs.existsSync(sidecarOf(tmpDir))).toBe(true) // 未删
  })

  it('Warn#4 进程重启换模型：旧模型 sidecar 残留 + 新模型行数相同（countIndexed 无法区分）→ 元数据守卫拦截跨模型污染', () => {
    // 给 M1、M2 各写 3 行（同 imageId，但向量不同）：两模型索引进度相同 → countIndexed 相等
    const dbAny = db as unknown as { upsertEmbedding: (i: unknown) => void }
    dbAny.upsertEmbedding({ imageId: 1, modelId: 'M2', dim: DIM, quant: 'int8', vector: v([0, 0, 0, 100]) })
    dbAny.upsertEmbedding({ imageId: 2, modelId: 'M2', dim: DIM, quant: 'int8', vector: v([0, 0, 100, 0]) })
    dbAny.upsertEmbedding({ imageId: 3, modelId: 'M2', dim: DIM, quant: 'int8', vector: v([0, 100, 0, 0]) })

    // 1) M1 会话落盘旧模型 sidecar + 元数据
    const svcM1 = getVectorIndexService(tmpDir, DIM, 'M1')
    svcM1.load(db)
    svcM1.unload()
    // 2) 模拟进程重启：清空内存实例（磁盘 sidecar/meta 保留），工厂走 created 分支→不删文件
    closeAllVectorIndexServices()
    const svcM2 = getVectorIndexService(tmpDir, DIM, 'M2')
    const spy = vi.spyOn(svcM2, 'rebuild')
    svcM2.load(db)
    // 元数据守卫：M2 与磁盘 M1 meta 不符 → 删陈旧 sidecar → 重建（若无守卫，size 3===countIndexed(M2)3 会误载 M1 图）
    expect(spy).toHaveBeenCalledTimes(1)
    // 检索口径属 M2 向量空间：query [0,0,0,100] 最近为 M2 id1（而非 M1 图会返回的 id3）
    expect(svcM2.search(v([0, 0, 0, 100]), 1)[0].id).toBe(1)
  })
})

// VectorIndexService 是普通类；导出确保 tsc 不因未用类型告警
void (VectorIndexService)
