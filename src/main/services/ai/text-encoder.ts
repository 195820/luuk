/**
 * Phase 9 M5 · T22 — 文本编码引擎（onnxruntime-node，实现 TextEncoder 契约）。
 *
 * 复用 T21 已实测的 CLIP 基础设施：同一 checkpoint（Xenova/clip-vit-base-patch32）的**文本塔**，
 * 与图像塔共享 512 维投影空间 → 查询向量可与库存图像向量直接做余弦 ANN 检索。
 *   tokenize（注入的 ClipTokenizer，纯 JS）→ input_ids(int64[1,77]) → text_embeds(512, fp32)
 *   → quantizeEmbedToInt8（复用 T21，方向保真）→ Uint8Array（对齐 VectorsDB / USearch Cos）。
 *
 * 关键约束（同 OnnxClipEngine）：本文件顶层零原生依赖 —— onnxruntime-node 全在方法内 `await import()`；
 * vitest 仅 import 契约/Fake 时不触碰原生模块。R2 会话分时 + C2 串行化 load 与图像塔一致。
 */
import { quantizeEmbedToInt8 } from './onnx-clip-engine'
import { CLIP_CONTEXT } from './clip-tokenizer'
import type { ClipTokenizer } from './clip-tokenizer'

export interface TextEncoder {
  /** 绑定的文本塔模型 id（与图像塔 id 区分，§9.7 模型绑定） */
  readonly modelId: string
  /** 向量维度（与图像塔一致 → 512） */
  readonly dim: number
  /** R2：查询会话开始加载推理会话 */
  load(): Promise<void>
  /** R2：查询会话结束释放推理会话内存 */
  unload(): Promise<void>
  isLoaded(): boolean
  /** 自然语言查询 → int8 量化向量（长度 = dim）；未 load 时抛错 */
  encode(text: string): Promise<Uint8Array>
  /** 批量编码（AI 标签 prompt 用）：单次会话内循环 encode，避免逐条 load/unload 抖动；空输入返回 [] */
  encodeBatch(texts: string[]): Promise<Uint8Array[]>
}

export interface OnnxClipTextEncoderOptions {
  /** 文本塔模型绝对路径（生产由 ModelManager 解析，SHA256 上层把关） */
  modelPath: string
  /** 注入的分词器（纯 JS，由上层从 tokenizer.json 构造一次复用） */
  tokenizer: ClipTokenizer
  modelId?: string
  dim?: number
  inputName?: string
  outputName?: string
}

type OrtSession = import('onnxruntime-node').InferenceSession

export class OnnxClipTextEncoder implements TextEncoder {
  readonly modelId: string
  readonly dim: number
  private readonly inputName: string
  private readonly outputName: string
  private session: OrtSession | null = null
  /** C2：串行化 in-flight load，并发查询复用同一 Promise，避免重复建会话 */
  private loading: Promise<void> | null = null
  /** load 在飞期间被 unload 请求：新会话建成后立即释放，不留孤立会话 */
  private disposedDuringLoad = false

  constructor(private readonly opts: OnnxClipTextEncoderOptions) {
    this.modelId = opts.modelId ?? 'clip-text-b32-int8'
    this.dim = opts.dim ?? 512
    this.inputName = opts.inputName ?? 'input_ids'
    this.outputName = opts.outputName ?? 'text_embeds'
  }

  isLoaded(): boolean {
    return this.session !== null
  }

  async load(): Promise<void> {
    if (this.session) return
    if (!this.loading) {
      this.disposedDuringLoad = false
      this.loading = (async () => {
        const ort = await import('onnxruntime-node')
        const created = await ort.InferenceSession.create(this.opts.modelPath)
        // 建会话期间收到过 unload 请求：立即释放刚建好的会话，不外泄孤立引用
        if (this.disposedDuringLoad) {
          this.disposedDuringLoad = false
          try { await created.release() } catch { /* 释放失败不致命 */ }
          return
        }
        this.session = created
      })().finally(() => { this.loading = null })
    }
    await this.loading
  }

  async unload(): Promise<void> {
    const s = this.session
    this.session = null
    // 会话尚在建立（loading 在飞且尚未赋值）：标记让 load 完成后自行释放
    if (!s && this.loading) { this.disposedDuringLoad = true; return }
    if (s) {
      try {
        await s.release()
      } catch {
        // 释放失败不致命（GC 兜底）
      }
    }
  }

  async encode(text: string): Promise<Uint8Array> {
    const session = this.session
    if (!session) throw new Error('OnnxClipTextEncoder 未加载，请先 load()（R2 会话分时）')
    const ort = await import('onnxruntime-node')
    const ids = this.opts.tokenizer.encode(text)
    // 自校验分词产出定长（自定义分词器返回变长会在 ort 侧报难读的 shape 错）
    if (ids.length !== CLIP_CONTEXT) {
      throw new Error(`CLIP 分词产出长度不符: got=${ids.length} want=${CLIP_CONTEXT}`)
    }
    const big = BigInt64Array.from(ids, (v) => BigInt(v))
    const feeds: Record<string, import('onnxruntime-node').Tensor> = {
      [this.inputName]: new ort.Tensor('int64', big, [1, CLIP_CONTEXT]),
    }
    // 导出图若声明 attention_mask 则补全 1（PoC 实测本 checkpoint 仅 input_ids，此为防御分支）
    if (session.inputNames.includes('attention_mask')) {
      feeds.attention_mask = new ort.Tensor('int64', BigInt64Array.from(ids, () => 1n), [1, CLIP_CONTEXT])
    }
    const res = await session.run(feeds, [this.outputName])
    const emb = res[this.outputName]
    if (!emb || emb.dims.length !== 2 || emb.data.length !== this.dim) {
      throw new Error(`CLIP 文本输出维度不符: dims=${JSON.stringify(emb?.dims)} len=${emb?.data.length} want ${this.dim}`)
    }
    // 输出必须 fp32（若导出图把 text_embeds 量化为 int8/uint8，quantizeEmbedToInt8 会静默算错向量）
    if (emb.type !== 'float32') {
      throw new Error(`CLIP 文本输出 dtype 非 float32: got=${emb.type}`)
    }
    return quantizeEmbedToInt8(emb.data as Float32Array)
  }

  /** 批量：复用同一会话循环单条 encode（prompt 数 ≤ ~60，无会话 churn）；空输入短路 */
  async encodeBatch(texts: string[]): Promise<Uint8Array[]> {
    if (texts.length === 0) return []
    const out: Uint8Array[] = []
    for (const t of texts) out.push(await this.encode(t))
    return out
  }
}

/** 由文本确定性生成 dim 维伪向量（值域 0..127 保证 int8 有符号解释为正，同 FakeEmbeddingEngine 策略） */
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
 * 测试/离线替身：零模型零 ort，按查询文本确定性产向量，并记录 load/unload/encode 次数
 * （供单测断言 R2 会话分时只 load/unload 各一次）。
 */
export class FakeTextEncoder implements TextEncoder {
  loads = 0
  unloads = 0
  encodeCalls = 0
  private loaded = false

  constructor(
    public readonly modelId = 'fake-clip-text-b32',
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

  async encode(text: string): Promise<Uint8Array> {
    if (!this.loaded) throw new Error('TextEncoder 未加载，请先 load()（R2 会话分时）')
    this.encodeCalls++
    return pseudoVector(text, this.dim)
  }

  async encodeBatch(texts: string[]): Promise<Uint8Array[]> {
    if (texts.length === 0) return []
    const out: Uint8Array[] = []
    for (const t of texts) out.push(await this.encode(t))
    return out
  }
}
