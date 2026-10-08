/**
 * Phase 9 M5 · T22 — 语义搜索编排测（全替身：FakeTextEncoder + 替身 search/getImage，零模型零原生）。
 *
 * semanticSearch 只吃「已就绪」依赖（load 生命周期归 wiring），故各用例先手动 load FakeTextEncoder。
 */
import { describe, it, expect, vi } from 'vitest'
import { semanticSearch, cosDistanceToSimilarity, type SemanticQueryDeps } from '../semantic-search'
import { FakeTextEncoder } from '../text-encoder'

function makeDeps() {
  const enc = new FakeTextEncoder('fake-text', 16)
  const search = vi.fn<SemanticQueryDeps['search']>(() => [])
  const getImage = vi.fn<SemanticQueryDeps['getImage']>((id) => ({ id, relative_path: `p${id}.jpg` }))
  const deps: SemanticQueryDeps = { encode: (t) => enc.encode(t), search, getImage }
  return { enc, search, getImage, deps }
}

describe('cosDistanceToSimilarity（Cos 距离 → 相似度%）', () => {
  it('0 距离=100%，distance=1→0%，0.2→80%，越界夹到 [0,100]', () => {
    expect(cosDistanceToSimilarity(0)).toBe(100)
    expect(cosDistanceToSimilarity(1)).toBe(0)
    expect(cosDistanceToSimilarity(0.2)).toBe(80)
    expect(cosDistanceToSimilarity(2)).toBe(0)
    expect(cosDistanceToSimilarity(-0.5)).toBe(100)
  })
})

describe('semanticSearch（编排全链）', () => {
  it('空/全空白查询：返回 []，且不触发 encode', async () => {
    const { deps, enc } = makeDeps()
    const spy = vi.spyOn(enc, 'encode')
    expect(await semanticSearch(deps, '', 10)).toEqual([])
    expect(await semanticSearch(deps, '   ', 10)).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('命中映射为 Image+similarity，保持 ANN 返回序（距离升序）', async () => {
    const { deps, search, enc } = makeDeps()
    await enc.load()
    search.mockReturnValue([{ id: 7, distance: 0.1 }, { id: 3, distance: 0.4 }])
    const res = await semanticSearch(deps, 'a cat', 5)
    expect(res.map((r) => r.id)).toEqual([7, 3])
    expect(res[0].similarity).toBe(90)
    expect(res[1].similarity).toBe(60)
    expect(res[0].relative_path).toBe('p7.jpg')
  })

  it('缺行（getImage 返回 null）跳过', async () => {
    const { deps, search, getImage, enc } = makeDeps()
    await enc.load()
    search.mockReturnValue([{ id: 1, distance: 0.1 }, { id: 2, distance: 0.2 }, { id: 3, distance: 0.3 }])
    getImage.mockImplementation((id) => (id === 2 ? null : { id }))
    const res = await semanticSearch(deps, 'q', 5)
    expect(res.map((r) => r.id)).toEqual([1, 3])
  })

  it('limit 透传给 search（且下限 1）', async () => {
    const { deps, search, enc } = makeDeps()
    await enc.load()
    await semanticSearch(deps, 'q', 0)
    expect(search).toHaveBeenLastCalledWith(expect.any(Uint8Array), 1)
    await semanticSearch(deps, 'q', 12)
    expect(search).toHaveBeenLastCalledWith(expect.any(Uint8Array), 12)
  })

  it('查询向量来自 encode（int8，长度 = dim）', async () => {
    const { deps, search, enc } = makeDeps()
    await enc.load()
    let seen: Uint8Array | undefined
    search.mockImplementation((v) => { seen = v; return [] })
    await semanticSearch(deps, 'a bee on a flower', 3)
    expect(seen).toBeInstanceOf(Uint8Array)
    expect(seen!.length).toBe(16)
  })
})
