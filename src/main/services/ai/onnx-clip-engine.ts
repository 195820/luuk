/**
 * Phase 9 M5 · T21 — 真 CLIP 嵌入引擎（onnxruntime-node + sharp，实现 EmbeddingEngine）。
 *
 * 推理链照搬已实测的 PoC（scripts/bench-poc-r2.mjs，§15 R2/R5）：
 * sharp 解码 → 224 cover 缩放 → CHW CLIP 归一化 → pixel_values → image_embeds(512, fp32)。
 * R5 int8-only：对 fp32 输出做 L2 归一后 ×127 量化为 int8（方向保真，供 USearch Cos 检索）。
 *
 * 关键约束：本文件顶层零原生依赖 —— onnxruntime-node / sharp 全在方法内 `await import()`，
 * 于是 vitest 仅 import 纯函数 quantizeEmbedToInt8 时不会触碰原生模块（引擎构造仅在 ai.enabled
 * 生产接线里发生，测试链用 FakeEmbeddingEngine）。
 */
import type { EmbeddingEngine } from './embedding-engine'

// CLIP 标准归一化参数（openai/clip preprocessor_config.json，与 PoC 一致）
const MEAN = [0.48145466, 0.4578275, 0.40821073]
const STD = [0.26862954, 0.26130258, 0.27577711]
const SIZE = 224

/**
 * int8 对称量化：先 L2 归一到单位向量再 ×127、四舍五入、夹到 [-128,127]。
 * 全程等比缩放 → 方向（余弦）保真，仅引入 ≤1/127 的分度误差；零向量安全返回全 0。
 * 返回按底层字节视图（Uint8Array，值为二补码有符号 int8）以对齐 VectorsDB BLOB 存储。
 */
export function quantizeEmbedToInt8(embed: ArrayLike<number>): Uint8Array {
  const n = embed.length
  let norm = 0
  for (let i = 0; i < n; i++) {
    const v = embed[i]
    norm += v * v
  }
  norm = Math.sqrt(norm)
  const out = new Int8Array(n)
  if (norm === 0) return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  const scale = 127 / norm
  for (let i = 0; i < n; i++) {
    let q = Math.round(embed[i] * scale)
    if (q > 127) q = 127
    else if (q < -128) q = -128
    out[i] = q
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

/** 反量化（仅用于校验余弦保真，不在生产链使用） */
export function dequantInt8ToIntFloat(bytes: Uint8Array): Float64Array {
  const signed = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Float64Array(signed.length)
  for (let i = 0; i < signed.length; i++) out[i] = signed[i]
  return out
}

export interface OnnxClipEngineOptions {
  /** 模型绝对路径（生产由 ModelManager.getModelPath 解析，SHA256 由上层 verifyModel 把关） */
  modelPath: string
  modelId?: string
  dim?: number
  inputName?: string
  outputName?: string
}

type OrtSession = import('onnxruntime-node').InferenceSession

export class OnnxClipEngine implements EmbeddingEngine {
  readonly modelId: string
  readonly dim: number
  private readonly inputName: string
  private readonly outputName: string
  private session: OrtSession | null = null

  constructor(private readonly opts: OnnxClipEngineOptions) {
    this.modelId = opts.modelId ?? 'clip-vit-b32-int8'
    this.dim = opts.dim ?? 512
    this.inputName = opts.inputName ?? 'pixel_values'
    this.outputName = opts.outputName ?? 'image_embeds'
  }

  isLoaded(): boolean {
    return this.session !== null
  }

  /** R2：会话开始建 ort 会话（幂等） */
  async load(): Promise<void> {
    if (this.session) return
    const ort = await import('onnxruntime-node')
    this.session = await ort.InferenceSession.create(this.opts.modelPath)
  }

  /** R2：会话结束释放 ort 会话内存 */
  async unload(): Promise<void> {
    const s = this.session
    this.session = null
    if (s) {
      try {
        await s.release()
      } catch {
        // 释放失败不致命（GC 兜底）
      }
    }
  }

  /** 图片绝对路径 → int8 量化向量（长度 = dim） */
  async embed(imagePath: string): Promise<Uint8Array> {
    const session = this.session
    if (!session) throw new Error('OnnxClipEngine 未加载，请先 load()（R2 会话分时）')
    const [ort, sharpMod] = await Promise.all([import('onnxruntime-node'), import('sharp')])
    const sharp = sharpMod.default ?? sharpMod
    const tensor = await preprocess(ort, sharp as unknown as SharpFn, imagePath)
    const res = await session.run({ [this.inputName]: tensor }, [this.outputName])
    const emb = res[this.outputName]
    if (!emb || emb.dims.length !== 2 || emb.data.length !== this.dim) {
      throw new Error(`CLIP 输出维度不符: dims=${JSON.stringify(emb?.dims)} len=${emb?.data.length} want ${this.dim}`)
    }
    return quantizeEmbedToInt8(emb.data as Float32Array)
  }
}

/** 与 PoC 同款最小 sharp 调用面（避免依赖 sharp 全类型） */
type SharpFn = (file: string) => {
  resize: (w: number, h: number, opts: { fit: string }) => any
}

async function preprocess(ort: typeof import('onnxruntime-node'), sharp: SharpFn, fp: string): Promise<import('onnxruntime-node').Tensor> {
  const { data } = await sharp(fp)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const f32 = new Float32Array(3 * SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      for (let c = 0; c < 3; c++) {
        const v = data[(y * SIZE + x) * 3 + c] / 255
        f32[c * SIZE * SIZE + y * SIZE + x] = (v - MEAN[c]) / STD[c]
      }
    }
  }
  return new ort.Tensor('float32', f32, [1, 3, SIZE, SIZE])
}
