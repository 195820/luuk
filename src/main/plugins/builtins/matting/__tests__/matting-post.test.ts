import { describe, it, expect } from 'vitest'
import {
  asFloat32,
  saliencyPlaneToAlpha,
  saliencyToGray,
  compositeAlpha,
  resizeGray,
} from '../post'
import type { SerializedTensor } from '../../../../../types/plugin'

describe('P2-15 · asFloat32 视图化', () => {
  it('float32 子视图按 byteOffset 读取正确区域', () => {
    const whole = new Float32Array([9, 9, 1, 2, 3, 4]) // 前 2 float 为填充
    const view = new Uint8Array(whole.buffer, 8) // byteOffset = 2 float = 8B
    const t: SerializedTensor = { dataType: 'float32', dims: [4], data: view }
    expect(Array.from(asFloat32(t))).toEqual([1, 2, 3, 4])
  })

  it('int64 走 BigInt64Array 逐元素转 float', () => {
    const big = new BigInt64Array([100n, 200n, 300n])
    const t: SerializedTensor = { dataType: 'int64', dims: [3], data: new Uint8Array(big.buffer) }
    expect(Array.from(asFloat32(t))).toEqual([100, 200, 300])
  })

  it('uint8 逐元素转 float', () => {
    const u = new Uint8Array([0, 128, 255])
    const t: SerializedTensor = { dataType: 'uint8', dims: [3], data: u }
    expect(Array.from(asFloat32(t))).toEqual([0, 128, 255])
  })

  it('prod(dims)×字节数 ≠ byteLength → 抛尺寸不符错', () => {
    const t: SerializedTensor = {
      dataType: 'float32',
      dims: [5], // 5×4=20
      data: new Float32Array(3).buffer, // byteLength 12
    }
    expect(() => asFloat32(t)).toThrow(/尺寸不符/)
  })
})

describe('P2-14 · saliencyPlaneToAlpha 绝对量纲', () => {
  it('回归：常数显著度 0.5 → 全 128（保留绝对值；旧 min-max 因 span≈0 塌成 0/黑）', () => {
    const plane = new Float32Array([0.5, 0.5, 0.5, 0.5])
    expect(Array.from(saliencyPlaneToAlpha(plane))).toEqual([128, 128, 128, 128])
  })

  it('softThreshold=0 → 纯绝对映射 x×255', () => {
    const plane = new Float32Array([0, 0.25, 0.5, 1])
    expect(Array.from(saliencyPlaneToAlpha(plane, 0))).toEqual([0, 64, 128, 255])
  })

  it('阈值以下二次衰减，阈值以上保持绝对值', () => {
    const plane = new Float32Array([0.25, 0.8]) // t=0.5
    const out = saliencyPlaneToAlpha(plane, 0.5)
    // 0.25<0.5 → 0.25*(0.25/0.5)=0.125 → 32；0.8≥0.5 → 0.8*255=204
    expect(Array.from(out)).toEqual([32, 204])
  })

  it('越界夹取 [0,1]，非有限值置 0', () => {
    const plane = new Float32Array([-1, 2, NaN])
    const out = saliencyPlaneToAlpha(plane, 0)
    expect(Array.from(out)).toEqual([0, 255, 0])
  })
})

describe('matting 合成/重采样/端到端显著图', () => {
  it('saliencyToGray：[0,1] 常数显著图 → 绝对灰度 128', () => {
    const vals = new Float32Array([0.5, 0.5, 0.5, 0.5])
    const t: SerializedTensor = { dataType: 'float32', dims: [1, 1, 2, 2], data: vals.buffer }
    const { width, height, gray } = saliencyToGray(t)
    expect([width, height]).toEqual([2, 2])
    expect(Array.from(gray)).toEqual([128, 128, 128, 128])
  })

  it('saliencyToGray：logits（越界）先 sigmoid 再绝对映射', () => {
    const vals = new Float32Array([4, 2, -1, -3])
    const t: SerializedTensor = { dataType: 'float32', dims: [1, 1, 2, 2], data: vals.buffer }
    const { gray } = saliencyToGray(t, 0) // softThreshold 0 便于断言纯 sigmoid×255
    const sig = (x: number) => Math.round(1 / (1 + Math.exp(-x)) * 255)
    expect(Array.from(gray)).toEqual([sig(4), sig(2), sig(-1), sig(-3)])
  })

  it('compositeAlpha：RGB 源 + 掩码 → RGBA', () => {
    const src = new Uint8Array([10, 20, 30, 40, 50, 60]) // 2 像素 RGB
    const gray = new Uint8Array([200, 250])
    const rgba = compositeAlpha(src, 3, gray, 2, 1)
    expect(Array.from(rgba)).toEqual([10, 20, 30, 200, 40, 50, 60, 250])
  })

  it('resizeGray：放大保持常数', () => {
    const src = new Uint8Array([100, 100, 100, 100])
    const out = resizeGray(src, 2, 2, 4, 4)
    expect(out.length).toBe(16)
    expect(Array.from(out).every((v) => v === 100)).toBe(true)
  })
})
