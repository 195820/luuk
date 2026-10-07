import { describe, it, expect } from 'vitest'
import { quantizeEmbedToInt8, dequantInt8ToIntFloat } from '../onnx-clip-engine'

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d === 0 ? 0 : dot / d
}

describe('quantizeEmbedToInt8（Phase 9 M5 · T21 R5 int8-only 输出量化）', () => {
  it('方向保真：量化→反量化后余弦 ≈ 1（int8@512 全局 127 分度，实测保真下限）', () => {
    // 512 维零均值、量级相当的伪 embedding（贴近归一化 CLIP 向量的分布形状）
    const emb = new Float32Array(512)
    let h = 12345
    for (let i = 0; i < 512; i++) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0
      emb[i] = (h >>> 9) / 8388608 - 0.5 // [-0.5, 0.5) 近似零均值
    }
    const bytes = quantizeEmbedToInt8(emb)
    const back = dequantInt8ToIntFloat(bytes)
    expect(bytes.length).toBe(512)
    expect(cosine(emb, back)).toBeGreaterThan(0.99)
  })

  it('有符号 int8 范围：反量化值均落在 [-128,127]', () => {
    const emb = Float32Array.from({ length: 64 }, (_, i) => Math.sin(i) * (i - 32))
    const bytes = quantizeEmbedToInt8(emb)
    const back = dequantInt8ToIntFloat(bytes)
    for (const v of back) {
      expect(v).toBeGreaterThanOrEqual(-128)
      expect(v).toBeLessThanOrEqual(127)
    }
  })

  it('主导分量量化到 127（等比缩放归一）', () => {
    const emb = new Float32Array(4)
    emb[2] = 5 // 唯一非零，L2 norm=5 → scale=127/5
    const back = dequantInt8ToIntFloat(quantizeEmbedToInt8(emb))
    expect(back[2]).toBe(127)
    expect(back[0]).toBe(0)
  })

  it('零向量安全：全 0，无 NaN', () => {
    const bytes = quantizeEmbedToInt8(new Float32Array(8))
    const back = dequantInt8ToIntFloat(bytes)
    expect(back.every((v) => v === 0)).toBe(true)
  })

  it('余弦排序在量化后保持一致（供 ANN 召回保真）', () => {
    const q = [1, 0, 0, 0]
    const v1 = [1, 0.1, 0, 0] // 最近
    const v2 = [1, 0.6, 0, 0]
    const v3 = [0, 1, 0, 0]   // 最远
    const dq = (v: number[]) => dequantInt8ToIntFloat(quantizeEmbedToInt8(Float32Array.from(v)))
    const c1 = cosine(q, dq(v1))
    const c2 = cosine(q, dq(v2))
    const c3 = cosine(q, dq(v3))
    expect(c1).toBeGreaterThan(c2)
    expect(c2).toBeGreaterThan(c3)
  })
})
