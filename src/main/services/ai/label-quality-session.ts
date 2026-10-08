/**
 * Phase 9 M5 · T23 — 标签/质量作业的单条编排（纯 DI，零模型零原生，可全替身单测）。
 *
 * 仿 index-session.ts 口径：本模块只做「单条 item → 结果落库/产提案」的可注入逻辑，
 * 会话生命周期（文本编码器 load/idle 卸载、库级守卫、入队启动）由 ai-wiring 包裹。
 * - ai.label：读 vectors.db 已存图像向量（不 embed、不 load ANN）→ suggestTags → 产 quality 提案；
 * - ai.quality：纯 sharp 启发式 scoreQuality → upsertQualityScore（零引擎会话，可与索引并行）。
 */
import { logger } from '../../../utils/logger'
import { suggestTags, type TagCandidate, type TagSuggestion } from './tag-suggester'
import type { QualityScores } from './quality-scorer'

/** 作业 kind（与 JobRunner 注册表一致） */
export const AI_LABEL_JOB_KIND = 'ai.label'
export const AI_QUALITY_JOB_KIND = 'ai.quality'

export type ItemStatus = 'done' | 'skipped' | 'failed'

/** 单条标签建议提案的写入意图（ai-wiring 桥接到 ProposalStore.create） */
export interface LabelProposalInput {
  libraryId: number
  imageId: number
  /** 库内相对路径（image_tags 同形态，不暴露绝对路径） */
  imageRelativePath: string
  suggestions: TagSuggestion[]
}

export interface LabelItemDeps {
  /** §9.7 模型绑定：向量行 model_id 与之不符 → skip（跨模型拒绝比较） */
  modelId: string
  /** imageId → 干净嵌入向量行（dirty 行/缺行返回 null/undefined → skip） */
  getEmbedding(imageId: number): { model_id: string; vector: Uint8Array } | null | undefined
  /** imageId → 库内相对路径（缺 → skip，文件已删/未入库） */
  resolvePath(imageId: number): string | null
  /** 会话级共享的候选词表与 prompt 向量（1:1，ai-wiring 在会话首条时构建） */
  candidates: TagCandidate[]
  promptVecs: Uint8Array[]
  /** 有建议才调用；同图已有 pending 提案的去重由调用方在此内决定（返回 true 表示已存在 → skip 落提案但仍算 done） */
  createProposal: (input: LabelProposalInput) => void
  /** 同图是否已有 pending 标签提案（幂等重跑支撑） */
  hasPendingProposal(imageId: number): boolean
}

/**
 * 单条：取向量 → 零样本建议 → 有建议则产提案（人在回路，绝不直接写 image_tags）。
 * 缺向量/模型不符/路径解析失败 → skipped；建议为空 → done（合法结果，非失败）。
 */
export function labelOne(deps: LabelItemDeps, libraryId: number, imageId: number): ItemStatus {
  const row = deps.getEmbedding(imageId)
  if (!row) return 'skipped'
  if (row.model_id !== deps.modelId) {
    logger.warn('AiLabel', `模型绑定不符 image=${imageId}（向量=${row.model_id} ≠ 层=${deps.modelId}），跳过`)
    return 'skipped'
  }
  const rel = deps.resolvePath(imageId)
  if (!rel) return 'skipped'
  let suggestions: TagSuggestion[]
  try {
    suggestions = suggestTags(row.vector, deps.candidates, deps.promptVecs)
  } catch (err) {
    logger.warn('AiLabel', `建议生成失败 image=${imageId}`, err)
    return 'failed'
  }
  if (suggestions.length === 0) return 'done'
  if (deps.hasPendingProposal(imageId)) return 'done' // 已有待确认提案：不重复产生
  try {
    deps.createProposal({ libraryId, imageId, imageRelativePath: rel, suggestions })
  } catch (err) {
    logger.warn('AiLabel', `提案写入失败 image=${imageId}`, err)
    return 'failed'
  }
  return 'done'
}

export interface QualityItemDeps {
  /** quality_scores.model_id 落库值（'heuristic-v1'） */
  modelId: string
  /** 注入的打分器（生产为 scoreQuality，单测喂替身） */
  score(absPath: string): Promise<QualityScores>
  /** 幂等 upsert（生产为 ThumbnailsDB.upsertQualityScore） */
  upsert(input: {
    imageId: number
    total: number
    sharpness: number
    exposure: number
    composition: number
    modelId: string
  }): void
}

/**
 * 单条：绝对路径 → scoreQuality → upsertQualityScore（路径解析由作业侧完成）。
 * 解码失败（损坏文件）→ failed（JobRunner 记项级失败，可 resume 重跑）。
 */
export async function qualityOne(deps: QualityItemDeps, absPath: string, imageId: number): Promise<ItemStatus> {
  if (!absPath) return 'skipped'
  try {
    const s = await deps.score(absPath)
    deps.upsert({
      imageId,
      total: s.total,
      sharpness: s.sharpness,
      exposure: s.exposure,
      composition: s.composition,
      modelId: deps.modelId,
    })
    return 'done'
  } catch (err) {
    logger.warn('AiQuality', `质量分计算失败 image=${imageId} path=${absPath}`, err)
    return 'failed'
  }
}
