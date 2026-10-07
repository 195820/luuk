/**
 * Phase 9 M5 · T22 — 语义搜索编排（纯 DI，零原生，可全替身单测）。
 *
 * 串起查询链：query →（已 load 的）TextEncoder.encode → int8 查询向量 →（已 load 的）ANN.search → 组装 Image+similarity。
 * 会话生命周期（R2 load/unload、idle TTL、与索引会话的互斥）不在此，交由 ai-wiring 的查询会话包裹；
 * 本模块只吃「已就绪」的依赖，故单测用 FakeTextEncoder + 替身 search + 替身 getImage 即可覆盖全链。
 *
 * 相似度口径：USearch Cos 度量 distance = 1 − cosine ∈ [0,2] → similarity% = round((1−distance)×100)，夹到 [0,100]。
 */
import type { AnnHit } from '../vectors/ann-index'

export interface SemanticQueryDeps {
  /** 已加载文本编码器：自然语言 → int8 查询向量（长度 = dim） */
  encode(text: string): Promise<Uint8Array>
  /** 已加载 ANN：向量 → TopK 命中（按距离升序） */
  search(vector: Uint8Array, k: number): AnnHit[]
  /** imageId → 已映射的 Image 记录（缺行返回 null，跳过） */
  getImage(imageId: number): Record<string, unknown> | null
}

/** Image 记录 + 语义相似度百分比（对齐 SimilarImage 的 similarity 字段口径） */
export type SemanticImage = Record<string, unknown> & { similarity: number }

/** Cos 距离 → 相似度百分比，夹到 [0,100] */
export function cosDistanceToSimilarity(distance: number): number {
  const s = Math.round((1 - distance) * 100)
  return s < 0 ? 0 : s > 100 ? 100 : s
}

/**
 * 同步组装：ANN 命中（距离升序）→ Image+similarity，缺行跳过。
 * 单列出来供查询会话（ai-wiring）在「编码之后不再 await」的同步临界区内直接调用，
 * 消除 isOpen 判定与 search 之间的让出点（防索引在查询 await 期卸载共享 ANN）。
 */
export function assembleSemanticResults(
  hits: AnnHit[],
  getImage: (imageId: number) => Record<string, unknown> | null,
): SemanticImage[] {
  const out: SemanticImage[] = []
  for (const h of hits) {
    const img = getImage(h.id)
    if (!img) continue
    out.push({ ...img, similarity: cosDistanceToSimilarity(h.distance) })
  }
  return out
}

/**
 * 语义搜索：空/全空白查询直接返回 []（不建会话、不查询）。
 * 命中按 ANN 返回序（距离升序 = 相似度降序）逐个映射为 Image，缺行跳过。
 */
export async function semanticSearch(
  deps: SemanticQueryDeps,
  query: string,
  limit: number,
): Promise<SemanticImage[]> {
  if (!query || query.trim() === '') return []
  const vec = await deps.encode(query)
  const hits = deps.search(vec, Math.max(1, limit))
  return assembleSemanticResults(hits, deps.getImage)
}
