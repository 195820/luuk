/**
 * Phase 9 M5 · T21 — 索引作业编排（R2 会话分时 + 脏批处理 + 逐条失败隔离）。
 *
 * 依赖全注入（engine / vectorsDB / ann / resolvePath）→ 用 FakeEngine + 临时库即可零模型、零网络单测。
 * 真 onnxruntime 引擎与 scanner→markDirty→入队 的生产接线在紧随切片。
 */
import type { VectorsDB } from '../database'
import type { VectorIndexService } from '../vectors/vector-index-service'
import type { EmbeddingEngine } from './embedding-engine'
import { logger } from '../../../utils/logger'

/** 作业 kind（与 types/plugin.ts 中 'ai.clip-index' 示例一致） */
export const AI_INDEX_JOB_KIND = 'ai.clip-index'
const INT8_QUANT = 'int8'

export interface IndexDeps {
  vectorsDB: VectorsDB
  engine: EmbeddingEngine
  ann: VectorIndexService
  /** imageId → 绝对路径；返回 null 表示解析不到（记 skipped） */
  resolvePath: (imageId: number) => string | null
  /** 每轮取脏上限（默认 50）；实际一批取 batchSize*4 再过滤本轮已试过的 */
  batchSize?: number
}

export type EmbedOneStatus = 'done' | 'skipped' | 'failed'

/**
 * 单条：解析路径 → embed → 写 vectors.db（顺带把 dirty 置 0）→ 同步内存 ANN。
 * 约定 engine 与 ann 已由外层会话 load()。失败不落库（保留 dirty 供下次重试）。
 */
export async function embedAndPersistOne(deps: IndexDeps, imageId: number): Promise<EmbedOneStatus> {
  const p = deps.resolvePath(imageId)
  if (!p) return 'skipped'
  try {
    const vec = await deps.engine.embed(p)
    deps.vectorsDB.upsertEmbedding({
      imageId,
      modelId: deps.engine.modelId,
      dim: deps.engine.dim,
      quant: INT8_QUANT,
      vector: vec,
    })
    deps.ann.upsert(imageId, vec)
    return 'done'
  } catch (err) {
    // 保留 dirty 供下次重试；记录根因（模型缺失/sharp 解码失败/维度不符均归为 failed，需日志区分）
    logger.warn('AiIndex', `embed 失败 image=${imageId} path=${p}`, err)
    return 'failed'
  }
}

export interface IndexSessionResult {
  processed: number
  skipped: number
  failed: number
}

/**
 * R2 会话分时索引会话：
 * 1) 无脏活直接返回（不空开推理会话）；
 * 2) engine.load() + ann.load() → 逐条处理脏项（本轮 attempted 集合防止失败项导致的死循环）；
 * 3) 无论成败都在 finally 释放（ann.unload 落盘 + engine.unload）。
 */
export async function runAiIndexSession(deps: IndexDeps): Promise<IndexSessionResult> {
  const result: IndexSessionResult = { processed: 0, skipped: 0, failed: 0 }
  if (deps.vectorsDB.countDirty() === 0) return result

  await deps.engine.load()
  deps.ann.load(deps.vectorsDB)
  try {
    const batchSize = deps.batchSize ?? 50
    const attempted = new Set<number>()
    for (;;) {
      const batch = deps.vectorsDB
        .getDirtyImageIds(batchSize * 4)
        .filter((id) => !attempted.has(id))
      if (batch.length === 0) break
      for (const id of batch) {
        attempted.add(id)
        const status = await embedAndPersistOne(deps, id)
        if (status === 'done') result.processed++
        else if (status === 'skipped') result.skipped++
        else result.failed++
      }
    }
  } finally {
    deps.ann.unload()
    await deps.engine.unload()
  }
  return result
}

/**
 * JobRunner 处理器（可选路径）：注册 'ai.clip-index' 单条处理器。
 * 说明：推理会话/内存 ANN 的 load/unload 由作业发起方在 start() 前后包好（JobRunner 无起止钩子，
 * 完成检测走 subscribeProgress）；本处理器只做单条 embed+persist，失败抛错交由 JobRunner 记 failed。
 */
export function registerAiIndexHandler(
  runner: { registerHandler: (kind: string, h: (item: { imageId: number | null }) => Promise<void>) => void },
  deps: IndexDeps,
): void {
  runner.registerHandler(AI_INDEX_JOB_KIND, async (item) => {
    if (item.imageId == null) return
    const status = await embedAndPersistOne(deps, item.imageId)
    if (status === 'failed') throw new Error(`embedding failed for image ${item.imageId}`)
  })
}
