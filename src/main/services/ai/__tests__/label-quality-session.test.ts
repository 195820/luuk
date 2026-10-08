/**
 * T23 · 标签/质量单条编排 — 全替身 DI，零模型零原生零网络。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  labelOne,
  qualityOne,
  AI_LABEL_JOB_KIND,
  AI_QUALITY_JOB_KIND,
  type LabelItemDeps,
  type LabelProposalInput,
  type QualityItemDeps,
} from '../label-quality-session'
import { buildTagCandidates } from '../tag-suggester'
import type { QualityScores } from '../quality-scorer'

const i8 = (vals: number[]) => {
  const a = Int8Array.from(vals)
  return new Uint8Array(a.buffer, a.byteOffset, a.length)
}

/** 双候选（u/v 正交基）：向量与 u 同向 → 仅 'u' 入选 */
const cands = buildTagCandidates(['u', 'v']).slice(0, 2)
const promptVecs = [i8([1, 0, 0, 0]), i8([0, 1, 0, 0])]

function labelDeps(over: Partial<LabelItemDeps> = {}): LabelItemDeps & { created: LabelProposalInput[] } {
  const created: LabelProposalInput[] = []
  return {
    created,
    modelId: 'clip-vit-b32-int8',
    getEmbedding: () => ({ model_id: 'clip-vit-b32-int8', vector: i8([1, 0, 0, 0]) }),
    resolvePath: () => 'set01/a.jpg',
    candidates: cands,
    promptVecs,
    createProposal: (input) => { created.push(input) },
    hasPendingProposal: () => false,
    ...over,
  }
}

describe('labelOne（零样本 → 提案，人在回路）', () => {
  it('强匹配 → 产提案，payload 含相对路径与建议', () => {
    const deps = labelDeps()
    expect(labelOne(deps, 7, 42)).toBe('done')
    expect(deps.created).toHaveLength(1)
    expect(deps.created[0]).toMatchObject({ libraryId: 7, imageId: 42, imageRelativePath: 'set01/a.jpg' })
    expect(deps.created[0].suggestions.length).toBeGreaterThan(0)
    expect(deps.created[0].suggestions[0].tagName).toBe(cands[0].tagName)
  })

  it('无向量行 → skipped 且不产提案', () => {
    const deps = labelDeps({ getEmbedding: () => undefined })
    expect(labelOne(deps, 7, 1)).toBe('skipped')
    expect(deps.created).toHaveLength(0)
  })

  it('§9.7 模型绑定不符 → skipped（跨模型拒绝比较）', () => {
    const deps = labelDeps({ getEmbedding: () => ({ model_id: 'other-model', vector: i8([1, 0]) }) })
    expect(labelOne(deps, 7, 1)).toBe('skipped')
    expect(deps.created).toHaveLength(0)
  })

  it('路径解析失败（文件已删）→ skipped', () => {
    const deps = labelDeps({ resolvePath: () => null })
    expect(labelOne(deps, 7, 1)).toBe('skipped')
  })

  it('全候选低于阈值 → done 零提案（合法空结果）', () => {
    // 候选 40+ 内置项共用同一向量 → softmax 均分 < 0.15 → 无建议
    const many = buildTagCandidates([])
    const same = i8([1, 0, 0, 0])
    const deps = labelDeps({ candidates: many, promptVecs: many.map(() => same) })
    expect(labelOne(deps, 7, 1)).toBe('done')
    expect(deps.created).toHaveLength(0)
  })

  it('同图已有 pending 提案 → done 不重复产生（幂等重跑）', () => {
    const deps = labelDeps({ hasPendingProposal: () => true })
    expect(labelOne(deps, 7, 1)).toBe('done')
    expect(deps.created).toHaveLength(0)
  })

  it('向量维度与 prompt 不符（suggestTags 抛）→ failed', () => {
    const deps = labelDeps({ getEmbedding: () => ({ model_id: 'clip-vit-b32-int8', vector: i8([1, 0]) }) })
    expect(labelOne(deps, 7, 1)).toBe('failed')
  })

  it('提案写入抛 → failed', () => {
    const deps = labelDeps({ createProposal: () => { throw new Error('db down') } })
    expect(labelOne(deps, 7, 1)).toBe('failed')
  })
})

describe('qualityOne（打分 → upsert）', () => {
  const scores: QualityScores = { total: 77, sharpness: 90, exposure: 60, composition: 50 }

  function qualityDeps(over: Partial<QualityItemDeps> = {}): QualityItemDeps & { upserted: unknown[] } {
    const upserted: unknown[] = []
    return {
      upserted,
      modelId: 'heuristic-v1',
      score: async () => scores,
      upsert: (input) => { upserted.push(input) },
      ...over,
    }
  }

  it('正常路径：score → upsert（携带 modelId 与全部分量）', async () => {
    const deps = qualityDeps()
    expect(await qualityOne(deps, '/abs/a.jpg', 3)).toBe('done')
    expect(deps.upserted).toEqual([
      { imageId: 3, total: 77, sharpness: 90, exposure: 60, composition: 50, modelId: 'heuristic-v1' },
    ])
  })

  it('空路径 → skipped 不调打分器', async () => {
    const score = vi.fn()
    const deps = qualityDeps({ score: score as never })
    expect(await qualityOne(deps, '', 3)).toBe('skipped')
    expect(score).not.toHaveBeenCalled()
  })

  it('打分抛（损坏文件）→ failed 不落库', async () => {
    const deps = qualityDeps({ score: async () => { throw new Error('解码失败') } })
    expect(await qualityOne(deps, '/abs/bad.jpg', 3)).toBe('failed')
    expect(deps.upserted).toHaveLength(0)
  })

  it('upsert 抛 → failed', async () => {
    const deps = qualityDeps({ upsert: () => { throw new Error('db down') } })
    expect(await qualityOne(deps, '/abs/a.jpg', 3)).toBe('failed')
  })

  it('作业 kind 常量为 ai.label / ai.quality', () => {
    expect(AI_LABEL_JOB_KIND).toBe('ai.label')
    expect(AI_QUALITY_JOB_KIND).toBe('ai.quality')
  })
})
