// @vitest-environment node
/**
 * Phase 9 M5 · T22 — 文本编码引擎契约测（零真模型：Fake + mock ort）。
 *
 * 覆盖：
 *  - FakeTextEncoder：R2 只 load/unload 各一次、未 load 抛错、按文本确定性产 dim 维向量
 *  - OnnxClipTextEncoder：encode 前未 load 抛错、C2 并发 load 去重（create 仅一次）、
 *    输出维度校验（不符抛错）、产出 int8 长度 = dim
 * 真推理正确性（与图像塔同空间、top-1 召回）留在门控 e2e（IV_AI_E2E）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeTextEncoder, OnnxClipTextEncoder } from '../text-encoder'
import type { ClipTokenizer } from '../clip-tokenizer'

const stubTokenizer = { encode: () => new Array(77).fill(49407) } as unknown as ClipTokenizer

// —— mock onnxruntime-node（避免真实原生加载与 jsdom 跨 realm float32 坑）——
const state = vi.hoisted(() => ({ createCount: 0, runCount: 0, outDims: [1, 512] as number[], inputNames: ['input_ids'] as string[], outType: 'float32' as string }))
vi.mock('onnxruntime-node', () => {
  class Tensor {
    constructor(public dtype: string, public data: unknown, public dims: number[]) {}
  }
  return {
    Tensor,
    InferenceSession: {
      create: vi.fn(async () => {
        state.createCount++
        return {
          inputNames: state.inputNames,
          async run(_feeds: Record<string, unknown>, outputs: string[]) {
            state.runCount++
            const name = outputs[0]
            return { [name]: { dims: state.outDims, data: new Float32Array(512).fill(0.5), type: state.outType } }
          },
          async release() {},
        }
      }),
    },
  }
})

describe('FakeTextEncoder（T22 契约替身）', () => {
  it('R2 会话分时：load/unload 各计一次；未 load 编码抛错', async () => {
    const e = new FakeTextEncoder('fake', 16)
    await expect(e.encode('cat')).rejects.toThrow(/未加载/)
    expect(e.isLoaded()).toBe(false)
    await e.load()
    await e.load()
    expect(e.loads).toBe(2)
    const v = await e.encode('a photo of a cat')
    expect(v).toBeInstanceOf(Uint8Array)
    expect(v.length).toBe(16)
    // 确定性：同文本同向量
    const v2 = await e.encode('a photo of a cat')
    expect(Array.from(v)).toEqual(Array.from(v2))
    await e.unload()
    expect(e.unloads).toBe(1)
    expect(e.isLoaded()).toBe(false)
  })

  it('不同查询文本 → 不同伪向量', async () => {
    const e = new FakeTextEncoder('fake', 32)
    await e.load()
    const a = await e.encode('cat')
    const b = await e.encode('dog')
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

describe('OnnxClipTextEncoder（mock ort，零真模型）', () => {
  beforeEach(() => {
    state.createCount = 0
    state.runCount = 0
    state.outDims = [1, 512]
    state.inputNames = ['input_ids']
    state.outType = 'float32'
  })

  it('未 load 直接 encode 抛错', async () => {
    const e = new OnnxClipTextEncoder({ modelPath: 'x.onnx', tokenizer: stubTokenizer })
    await expect(e.encode('cat')).rejects.toThrow(/未加载/)
  })

  it('C2：并发 load 去重，InferenceSession.create 仅一次', async () => {
    const e = new OnnxClipTextEncoder({ modelPath: 'x.onnx', tokenizer: stubTokenizer })
    await Promise.all([e.load(), e.load(), e.load()])
    expect(state.createCount).toBe(1)
    expect(e.isLoaded()).toBe(true)
  })

  it('encode 产出 int8 向量长度 = dim', async () => {
    const e = new OnnxClipTextEncoder({ modelPath: 'x.onnx', tokenizer: stubTokenizer, dim: 512 })
    await e.load()
    const v = await e.encode('a bee on a flower')
    expect(v).toBeInstanceOf(Uint8Array)
    expect(v.length).toBe(512)
    expect(state.runCount).toBe(1)
  })

  it('输出维度不符抛错（dims 非二维）', async () => {
    state.outDims = [512]
    const e = new OnnxClipTextEncoder({ modelPath: 'x.onnx', tokenizer: stubTokenizer, dim: 512 })
    await e.load()
    await expect(e.encode('cat')).rejects.toThrow(/维度不符/)
  })

  it('输出 dtype 非 float32 抛错（防量化输出被误当 fp32 再量化）', async () => {
    state.outType = 'int8'
    const e = new OnnxClipTextEncoder({ modelPath: 'x.onnx', tokenizer: stubTokenizer, dim: 512 })
    await e.load()
    await expect(e.encode('cat')).rejects.toThrow(/dtype 非 float32/)
  })

  it('导出图声明 attention_mask 时补喂（不抛错）', async () => {
    state.inputNames = ['input_ids', 'attention_mask']
    const e = new OnnxClipTextEncoder({ modelPath: 'x.onnx', tokenizer: stubTokenizer, dim: 512 })
    await e.load()
    const v = await e.encode('cat')
    expect(v.length).toBe(512)
  })

  it('unload 释放后再 load 重建会话', async () => {
    const e = new OnnxClipTextEncoder({ modelPath: 'x.onnx', tokenizer: stubTokenizer })
    await e.load()
    await e.unload()
    expect(e.isLoaded()).toBe(false)
    await e.load()
    expect(state.createCount).toBe(2)
  })
})
