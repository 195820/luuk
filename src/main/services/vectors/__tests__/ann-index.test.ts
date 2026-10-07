import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { AnnIndex } from '../ann-index'

// 真实 usearch（原生 HNSW），本地、无网络、无模型；数值均 ≤127 保证 int8 有符号解释为正
const DIM = 4
const v = (a: number[]) => Uint8Array.from(a)

describe('AnnIndex（Phase 9 M5 · USearch HNSW 薄封装）', () => {
  const tmpFiles: string[] = []
  const tmp = (name: string): string => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-ann-')), name)
    tmpFiles.push(path.dirname(p))
    return p
  }
  afterEach(() => {
    for (const d of tmpFiles) fs.rmSync(d, { recursive: true, force: true })
    tmpFiles.length = 0
  })

  it('add + size + contains', () => {
    const idx = new AnnIndex(DIM)
    idx.add(1, v([100, 0, 0, 0]))
    idx.add(2, v([0, 100, 0, 0]))
    expect(idx.size()).toBe(2)
    expect(idx.has(1)).toBe(true)
    expect(idx.has(99)).toBe(false)
  })

  it('search 按余弦距离升序返回最近邻', () => {
    const idx = new AnnIndex(DIM)
    idx.add(1, v([100, 0, 0, 0]))
    idx.add(2, v([0, 100, 0, 0]))
    idx.add(3, v([98, 5, 0, 0]))
    const hits = idx.search(v([100, 0, 0, 0]), 2)
    expect(hits.length).toBe(2)
    // 完全相同的向量距离最小、排首位
    expect(hits[0].id).toBe(1)
    expect(hits[0].distance).toBeLessThanOrEqual(hits[1].distance)
    expect(hits[1].id).toBe(3)
  })

  it('命中不足 k 时裁剪 NaN 填充位', () => {
    const idx = new AnnIndex(DIM)
    idx.add(1, v([100, 0, 0, 0]))
    const hits = idx.search(v([100, 0, 0, 0]), 5)
    expect(hits.length).toBe(1)
    expect(hits[0].id).toBe(1)
  })

  it('空索引 / k<=0 返回空数组', () => {
    const idx = new AnnIndex(DIM)
    expect(idx.search(v([100, 0, 0, 0]), 3)).toEqual([])
    idx.add(1, v([100, 0, 0, 0]))
    expect(idx.search(v([100, 0, 0, 0]), 0)).toEqual([])
  })

  it('remove 后规模递减且不再命中', () => {
    const idx = new AnnIndex(DIM)
    idx.add(1, v([100, 0, 0, 0]))
    idx.add(2, v([0, 100, 0, 0]))
    idx.remove(1)
    expect(idx.size()).toBe(1)
    expect(idx.has(1)).toBe(false)
    expect(idx.search(v([100, 0, 0, 0]), 3).every(h => h.id !== 1)).toBe(true)
  })

  it('save/load 往返：磁盘索引可继续检索', () => {
    const file = tmp('idx.usearch')
    const idx = new AnnIndex(DIM)
    idx.add(1, v([100, 0, 0, 0]))
    idx.add(2, v([0, 100, 0, 0]))
    idx.save(file)
    expect(fs.existsSync(file)).toBe(true)

    const reloaded = AnnIndex.load(file, DIM)
    expect(reloaded.size()).toBe(2)
    const hits = reloaded.search(v([0, 100, 0, 0]), 1)
    expect(hits[0].id).toBe(2)
  })
})
