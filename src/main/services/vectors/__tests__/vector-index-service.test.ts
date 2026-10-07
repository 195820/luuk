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

  it('unload 落盘 sidecar；新会话 load 从 sidecar 恢复（非重建）', () => {
    svc.load(db)
    svc.upsert(4, v([0, 0, 100, 0])) // 仅进内存索引，未写 vectors.db
    svc.unload()
    const sidecar = path.join(tmpDir, '.ivlib', 'vectors.usearch')
    expect(fs.existsSync(sidecar)).toBe(true)
    expect(svc.isOpen()).toBe(false)

    // 新 service 复用同一 sidecar：应含 id=4（内存增量已落盘），而非从 vectors.db（无 id=4）重建
    closeVectorIndexService(tmpDir)
    const svc2 = getVectorIndexService(tmpDir, DIM)
    svc2.load(db)
    expect(svc2.size()).toBe(4)
    expect(svc2.search(v([0, 0, 100, 0]), 1)[0].id).toBe(4)
  })
})

// VectorIndexService 是普通类；导出确保 tsc 不因未用类型告警
void (VectorIndexService)
