import { Index, MetricKind, ScalarKind } from 'usearch'

/**
 * Phase 9 M5 · HNSW 向量索引薄封装（R5 改道：ANN 替代暴力扫描）。
 *
 * 选型说明：PoC 实测暴力扫描 1M×512 int8 P50 4.5s 超 §9.4 目标 → 引入 HNSW。
 * 原计划用 sqlite-vec 的 vec0，但 0.1.9 实测无法经 better-sqlite3 参数绑定完成
 * insert/query（恒抛 “Only integers are allowed for primary key values”），且不支持
 * int8 量化列；故改用 USearch（成熟原生 HNSW、原生 int8 量化，贴合 R5 int8-only）。
 *
 * 属主进程 host 能力（§5.4：运行时归 host，插件不直接依赖向量库）。
 * - 向量以 int8 存储（dtype i8），字节序与 vectors.db 的 BLOB 一致（同 buffer 视图）
 * - 余弦度量（CLIP 归一化向量）
 * - USearch 的 key 是 BigInt，命中不足 k 时以 NaN 距离填充 —— 对外统一过滤并转 Number
 */

export interface AnnHit {
  id: number
  distance: number
}

export interface AnnIndexOptions {
  metric?: MetricKind
  quantization?: ScalarKind
}

export class AnnIndex {
  private readonly index: Index

  constructor(dim: number, opts?: AnnIndexOptions) {
    this.index = new Index(
      dim,
      opts?.metric ?? MetricKind.Cos,
      opts?.quantization ?? ScalarKind.I8,
    )
  }

  /** 加入/覆盖一个向量（同 id 幂等由调用方先 remove 保证） */
  add(id: number, vector: Int8Array | Uint8Array): void {
    this.index.add(BigInt(id), this.toInt8(vector))
  }

  remove(id: number): void {
    this.index.remove(BigInt(id))
  }

  has(id: number): boolean {
    return this.index.contains(BigInt(id)) as boolean
  }

  /** KNN 检索；命中不足 k 时自动裁剪掉填充位（NaN 距离） */
  search(vector: Int8Array | Uint8Array, k: number): AnnHit[] {
    if (this.index.size() === 0 || k <= 0) return []
    const m = this.index.search(this.toInt8(vector), Math.max(1, k), 0)
    const out: AnnHit[] = []
    for (let i = 0; i < m.keys.length; i++) {
      const d = m.distances[i]
      if (!Number.isFinite(d)) continue
      out.push({ id: Number(m.keys[i]), distance: d })
    }
    return out
  }

  size(): number {
    return this.index.size()
  }

  save(filePath: string): void {
    this.index.save(filePath)
  }

  /** 从磁盘载入（须与写入时同 dim/量化配置） */
  static load(filePath: string, dim: number, opts?: AnnIndexOptions): AnnIndex {
    const inst = new AnnIndex(dim, opts)
    inst.index.load(filePath)
    return inst
  }

  /** 复用底层字节做有符号视图，避免数值重映射破坏 int8 位模式 */
  private toInt8(v: Int8Array | Uint8Array): Int8Array {
    if (v instanceof Int8Array) return v
    return new Int8Array(v.buffer, v.byteOffset, v.byteLength)
  }
}
