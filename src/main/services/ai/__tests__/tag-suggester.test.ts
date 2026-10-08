/**
 * T23 · AI 标签零样本建议单测 — 纯函数喂合成 int8 向量，零模型零网络。
 */
import { describe, it, expect } from 'vitest'
import {
  TAG_PARAMS,
  BUILTIN_LABELS,
  buildLabelPrompt,
  buildTagCandidates,
  int8Cosine,
  suggestTags,
  type TagCandidate,
} from '../tag-suggester'

/** 用有符号 int8 数组构造字节视图（测试侧小维度向量） */
const i8 = (vals: number[]) => {
  const a = Int8Array.from(vals)
  return new Uint8Array(a.buffer, a.byteOffset, a.length)
}

describe('int8Cosine', () => {
  it('同向 → 1；反向 → -1；正交 → 0', () => {
    expect(int8Cosine(i8([10, 20, 30]), i8([10, 20, 30]))).toBeCloseTo(1, 6)
    expect(int8Cosine(i8([10, 20, 30]), i8([-10, -20, -30]))).toBeCloseTo(-1, 6)
    expect(int8Cosine(i8([10, 0]), i8([0, -25]))).toBeCloseTo(0, 6)
  })

  it('二补码负值参与运算（0xF6 = -10）', () => {
    // [-10, 0] · [-10, 0] 同向 → 1
    expect(int8Cosine(new Uint8Array([0xf6, 0x00]), new Uint8Array([0xf6, 0x00]))).toBeCloseTo(1, 6)
  })

  it('零向量返回 0 不 NaN', () => {
    expect(int8Cosine(i8([0, 0, 0]), i8([1, 2, 3]))).toBe(0)
  })

  it('长度不符抛错', () => {
    expect(() => int8Cosine(i8([1, 2]), i8([1, 2, 3]))).toThrow(/维度不符/)
  })
})

describe('buildTagCandidates', () => {
  it('已有标签 ∪ 内置类别，大小写不敏感去重，已有名保原名优先', () => {
    const cands = buildTagCandidates(['Travel', 'cat', '  ', 'Portrait'])
    const names = cands.map(c => c.tagName)
    // 'Travel' 保留原名；'cat' 非内置 → 独立项；'Portrait' 与内置 'portrait' 去重（先入保原名）
    expect(names).toContain('Travel')
    expect(names).toContain('cat')
    expect(names).toContain('Portrait')
    expect(names.filter(n => n.toLowerCase() === 'portrait')).toHaveLength(1)
    expect(names).not.toContain('')
    // 内置类别全量在列（大小写不敏感：'Portrait' 已顶替内置 'portrait'）
    const lower = new Set(names.map(n => n.toLowerCase()))
    for (const b of BUILTIN_LABELS) expect(lower.has(b)).toBe(true)
  })

  it('prompt 模板：a photo of a {小写标签}', () => {
    const [first] = buildTagCandidates(['Night'])
    expect(first.tagName).toBe('Night')
    expect(first.prompt).toBe(buildLabelPrompt('Night'))
    expect(first.prompt).toBe('a photo of a night')
  })

  it('空词表也产全部内置候选', () => {
    expect(buildTagCandidates([])).toHaveLength(BUILTIN_LABELS.length)
  })
})

describe('suggestTags（softmax 阈值 + topN）', () => {
  const cand = (name: string): TagCandidate => ({ tagName: name, prompt: buildLabelPrompt(name) })

  it('入参不齐 / 空候选抛错', () => {
    const v = i8([1, 0])
    expect(() => suggestTags(v, [], [])).toThrow(/入参不齐/)
    expect(() => suggestTags(v, [cand('a')], [v, v])).toThrow(/入参不齐/)
  })

  it('强匹配候选高置信入选，弱匹配被阈值过滤', () => {
    const image = i8([100, 0, 0, 0])
    const cands = [cand('cat'), cand('dog'), cand('sky')]
    const vecs = [i8([100, 0, 0, 0]), i8([0, 100, 0, 0]), i8([0, 0, 100, 0])]
    const out = suggestTags(image, cands, vecs)
    expect(out).toHaveLength(1)
    expect(out[0].tagName).toBe('cat')
    expect(out[0].confidence).toBeGreaterThan(TAG_PARAMS.MIN_CONFIDENCE)
  })

  it('近似双向候选按置信度降序，且受 MAX_SUGGESTIONS 截断', () => {
    // 图像向量与 8 个候选都呈递减相似度 → 全部高 logits 竞争，截断到 5
    const image = i8([60, 50, 40, 30, 20, 10, 5, 1])
    const cands = Array.from({ length: 8 }, (_, i) => cand(`l${i}`))
    const vecs = Array.from({ length: 8 }, (_, i) => {
      const v = [60, 50, 40, 30, 20, 10, 5, 1]
      v[i] = v[i] + 2 // 每个候选都近似图像向量，l7 相似度最高（基数小增量占比大）
      return i8(v)
    })
    const out = suggestTags(image, cands, vecs)
    expect(out.length).toBeLessThanOrEqual(TAG_PARAMS.MAX_SUGGESTIONS)
    for (let i = 1; i < out.length; i++) expect(out[i - 1].confidence).toBeGreaterThanOrEqual(out[i].confidence)
  })

  it('均匀低概率（全部低于阈值）→ 空建议', () => {
    // 30 个候选共用同一向量 → softmax 均分 1/30 ≈ 0.033 < 0.15 → 全滤除
    const image = i8([10, 10, 10, 10])
    const many = Array.from({ length: 30 }, (_, i) => cand(`t${i}`))
    const shared = i8([0, 0, 1, 0])
    expect(suggestTags(image, many, Array.from({ length: 30 }, () => shared))).toHaveLength(0)
  })

  it('confidence 保留三位小数', () => {
    const image = i8([90, 0])
    const cands = [cand('x'), cand('y')]
    const vecs = [i8([90, 0]), i8([0, 90])]
    const out = suggestTags(image, cands, vecs)
    for (const s of out) expect(s.confidence).toBe(Math.round(s.confidence * 1000) / 1000)
  })
})
