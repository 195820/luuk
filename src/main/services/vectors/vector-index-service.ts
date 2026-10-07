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

  isOpen(): boolean {
    return this.ann !== null
  }

  /** 暴露当前 dim 供工厂做换模型/换维度判定 */
  getDim(): number {
    return this.dim
  }

  size(): number {
    return this.ann?.size() ?? 0
  }

  /** 会话开始（R2 load）：优先从 sidecar 载入，但校验其与 vectors.db 干净行数一致，否则全量重建 */
  load(db: VectorsDB): void {
    if (this.ann) return
    const p = this.sidecarPath()
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
    // dim 不一致（换模型/换维度）→ sidecar 与 dim 不匹配不可复用：丢弃重建
    if (s.getDim() !== dim) {
      s.close()
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
