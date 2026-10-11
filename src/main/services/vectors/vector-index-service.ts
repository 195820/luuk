import fs from 'fs'
import path from 'path'
import type { VectorsDB } from '../database'
import { AnnIndex, type AnnHit } from './ann-index'

/**
 * Phase 9 M5 · 每库一个 HNSW sidecar 索引（`.ivlib/vectors.usearch`）。
 *
 * 设计约束：
 * - vectors.db 是源真相，本索引只是可丢弃的加速层：缺失即从 vectors.db 全量重建。
 * - R2 会话分时 load/unload：会话开始 load（优先读 sidecar，否则 rebuild），
 *   会话结束 unload（save 落盘 + 释放内存）；不常驻，避免抢占内存。
 * - 与 ThumbnailsDB/VectorsDB 一致的按库路径单例管理。
 *
 * 本类只负责索引编排，不做推理；推理产物（int8 向量）由上层索引作业经
 * upsert() 灌入（EmbeddingEngine/index-job 为下一切片，需模型落位 + §5.4 host 运行时接入决策）。
 */

const SIDECAR_FILE = 'vectors.usearch'
// A-3/Warn#4：USearch 文件头不含 modelId/dim 之外的标识，进程重启后换模型会绕过工厂 rm 直接载入旧模型图（§9.7）。
// 额外落一份 {dim, modelId} 元数据，load 先校验，不符即视为陈旧丢弃重建。
const META_FILE = 'vectors.usearch.meta.json'

export class VectorIndexService {
  private ann: AnnIndex | null = null

  constructor(
    private readonly libraryPath: string,
    private readonly dim: number,
    private readonly modelId?: string,
  ) {}

  private sidecarPath(): string {
    return path.join(this.libraryPath, '.ivlib', SIDECAR_FILE)
  }

  private metaPath(): string {
    return path.join(this.libraryPath, '.ivlib', META_FILE)
  }

  /** Warn#4：读元数据判当前 sidecar 是否属本服务（dim+modelId 一致）；缺失/损坏 → false（不可信→陈旧） */
  private metaMatches(): boolean {
    try {
      const m = JSON.parse(fs.readFileSync(this.metaPath(), 'utf8')) as { dim: number; modelId?: string | null }
      return m.dim === this.dim && (m.modelId ?? undefined) === (this.modelId ?? undefined)
    } catch {
      return false
    }
  }

  isOpen(): boolean {
    return this.ann !== null
  }

  /** 暴露当前 dim 供工厂做换模型/换维度判定 */
  getDim(): number {
    return this.dim
  }

  /** 暴露绑定 modelId 供工厂复用判定与查询侧模型绑定校验（§9.7 跨模型拒绝比较） */
  getModelId(): string | undefined {
    return this.modelId
  }

  size(): number {
    return this.ann?.size() ?? 0
  }

  /** 会话开始（R2 load）：优先从 sidecar 载入，但校验其与 vectors.db 干净行数一致，否则全量重建 */
  load(db: VectorsDB): void {
    if (this.ann) return
    const p = this.sidecarPath()
    // A-3/Warn#4：sidecar 命中前先校验元数据（dim+modelId）。进程重启后换模型会绕过工厂 rm 直接
    // AnnIndex.load 旧模型图 → §9.7 跨模型污染；元数据不符（或缺失/损坏）即删陈旧 sidecar 走重建
    if (fs.existsSync(p) && !this.metaMatches()) {
      try { fs.rmSync(p, { force: true }); fs.rmSync(this.metaPath(), { force: true }) } catch { /* 删除失败不致命：countIndexed 校验仍会兜底 */ }
    }
    if (fs.existsSync(p)) {
      const ann = AnnIndex.load(p, this.dim)
      // 陈旧校验：sidecar 只信 vectors.db（源真相）。size 与干净行数不符（退出未落盘/崩溃/脏写）→ 丢弃重建
      if (ann.size() === db.countIndexed(this.modelId)) {
        this.ann = ann
      } else {
        // sidecar 陈旧：丢弃它，从 vectors.db 全量重建
        this.rebuild(db)
      }
    } else {
      this.rebuild(db)
    }
  }

  /** 会话结束（R2 unload）：落盘并释放内存 */
  unload(): void {
    if (!this.ann) return
    this.ann.save(this.sidecarPath())
    // A-3/Warn#4：同步落元数据 {dim, modelId}，供下次 load（含进程重启）校验 sidecar 归属
    try {
      fs.mkdirSync(path.dirname(this.metaPath()), { recursive: true })
      fs.writeFileSync(this.metaPath(), JSON.stringify({ dim: this.dim, modelId: this.modelId ?? null }))
    } catch { /* 元数据写失败不致命：下次 load metaMatches 返回 false → 保守重建 */ }
    this.ann = null
  }

  /** 从 vectors.db 全量重建内存索引（sidecar 缺失/陈旧 / 换模型时用）；返回索引规模 */
  rebuild(db: VectorsDB): number {
    const ann = new AnnIndex(this.dim)
    for (const e of db.listAllEmbeddings(this.modelId)) {
      ann.add(e.imageId, e.vector)
    }
    this.ann = ann
    return ann.size()
  }

  /** 索引作业写入 vectors.db 后同步进内存索引（先删后加，保证幂等） */
  upsert(imageId: number, vector: Uint8Array): void {
    this.assertOpen()
    this.ann!.remove(imageId)
    this.ann!.add(imageId, vector)
  }

  /** 文件删除 / 向量失效时移除 */
  remove(imageId: number): void {
    this.ann?.remove(imageId)
  }

  /** KNN 检索；未打开时返回空（不隐式触发 load，交由调用方管理会话生命周期） */
  search(vector: Int8Array | Uint8Array, k: number): AnnHit[] {
    if (!this.ann) return []
    return this.ann.search(vector, k)
  }

  /** 丢弃内存索引（不落盘；源真相仍在 vectors.db） */
  close(): void {
    this.ann = null
  }

  private assertOpen(): void {
    if (!this.ann) throw new Error('VectorIndexService 未打开，请先 load() 或 rebuild()')
  }
}

const instances = new Map<string, VectorIndexService>()

/** 按库路径取（并惰性构造）VectorIndexService；dim/modelId 由调用方按模型给定（ViT-B/32 → 512） */
export function getVectorIndexService(libraryPath: string, dim: number, modelId?: string): VectorIndexService {
  const s = instances.get(libraryPath)
  if (s) {
    // dim 或 modelId 不一致（换模型/换维度）→ sidecar 与之不匹配不可复用：丢弃重建
    if (s.getDim() !== dim || s.getModelId() !== modelId) {
      s.close()
      // A-3：换模型 = 旧 sidecar 语义失效。旧图内嵌旧模型空间（USearch 文件头不含 modelId，
      // load 仅按 dim 校验 → 数量碰巧相等时会把旧模型图当新模型用，§9.7 跨模型污染）。
      // sidecar 本就是可丢弃加速层（源真相 vectors.db），直接删最稳——新会话从 vectors.db 全量重建。
      const stale = path.join(libraryPath, '.ivlib', SIDECAR_FILE)
      try { fs.rmSync(stale, { force: true }) } catch { /* 删除失败不致命：load 侧 countIndexed 校验兜底 */ }
      // Warn#4：一并删元数据，避免新会话首装载（若未走本工厂）误读旧元数据
      try { fs.rmSync(path.join(libraryPath, '.ivlib', META_FILE), { force: true }) } catch { /* 忽略 */ }
      const next = new VectorIndexService(libraryPath, dim, modelId)
      instances.set(libraryPath, next)
      return next
    }
    return s
  }
  const created = new VectorIndexService(libraryPath, dim, modelId)
  instances.set(libraryPath, created)
  return created
}

export function closeVectorIndexService(libraryPath: string): void {
  const s = instances.get(libraryPath)
  if (s) {
    s.close()
    instances.delete(libraryPath)
  }
}

export function closeAllVectorIndexServices(): void {
  // 退出清理：仍开着的内存索引先落盘（unload 写 sidecar）再丢弃，尽量保留加速层免下次全量重建
  for (const s of instances.values()) {
    try {
      if (s.isOpen()) s.unload()
      else s.close()
    } catch { /* 落盘失败不致命：源真相仍在 vectors.db，下次 load 会校验重建 */ }
  }
  instances.clear()
}
