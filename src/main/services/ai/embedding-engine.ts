/**
 * Phase 9 M5 · T21 — 嵌入引擎契约（宿主能力，§5.4：运行时归 host，插件不直接依赖 onnxruntime）。
 *
 * 把 ONNXRuntime 会话挡在这个可注入接口之后：
 * - 上层索引作业只认 EmbeddingEngine，不 import onnxruntime-node（便于用 FakeEngine 零模型单测）
 * - R2 会话分时 load/unload：推理会话不是常驻，会话开始 load()、会话结束 unload() 释放内存
 * - 产出即 int8 量化向量（对齐 R5 int8-only），长度 = dim
 *
 * 真引擎（onnxruntime-node + CLIP ViT-B/32 + sharp 预处理）在紧随的切片接入；
 * 本文件只定契约与测试替身，零推理、零网络、零模型文件。
 */

export interface EmbeddingEngine {
  /** 绑定的模型 id（§9.7 模型绑定：换 model_id 不互比） */
  readonly modelId: string
  /** 向量维度（ViT-B/32 → 512） */
  readonly dim: number
  /** R2：会话开始加载推理会话 */
  load(): Promise<void>
  /** R2：会话结束释放推理会话内存 */
  unload(): Promise<void>
  isLoaded(): boolean
  /** 输入图片绝对路径，输出 int8 量化向量（长度 = dim）；未 load 时抛错 */
  embed(imagePath: string): Promise<Uint8Array>
}

/** 由路径确定性生成 dim 维伪向量（值域 0..127 保证 int8 有符号解释为正，便于余弦比较） */
function pseudoVector(seedText: string, dim: number): Uint8Array {
  const out = new Uint8Array(dim)
  let h = 2166136261
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  for (let i = 0; i < dim; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
    out[i] = (h >>> 16) & 0x7f
  }
  return out
}

/**
 * 测试/离线替身：无需模型与 ort，按路径确定性产向量，并记录 load/unload/embed 调用次数
 * （供单测断言 R2 会话分时只 load/unload 各一次）。
 */
export class FakeEmbeddingEngine implements EmbeddingEngine {
  loads = 0
  unloads = 0
  embedCalls = 0
  private loaded = false

  constructor(
    public readonly modelId = 'fake-clip-vit-b32',
    public readonly dim = 8,
  ) {}

  async load(): Promise<void> {
    this.loaded = true
    this.loads++
  }

  async unload(): Promise<void> {
    this.loaded = false
    this.unloads++
  }

  isLoaded(): boolean {
    return this.loaded
  }

  async embed(imagePath: string): Promise<Uint8Array> {
    if (!this.loaded) throw new Error('EmbeddingEngine 未加载，请先 load()（R2 会话分时）')
    this.embedCalls++
    return pseudoVector(imagePath, this.dim)
  }
}
