import { describe, it, expect } from 'vitest'
import {
  resolveQuantizeFactor,
  buildTileTensor,
  mergeTile,
  pickOutput,
  clamp255,
} from '../post'
import type { SerializedTensor } from '../../../../../types/plugin'

describe('P2-13 · upscale resolveQuantizeFactor（量纲判定）', () => {
  it('[0,1] 归一化输出 → 乘数 255', () => {
    expect(resolveQuantizeFactor(new Float32Array([0, 0.5, 0.25, 1]))).toBe(255)
  })

  it('[0,255] 输出 → 乘数 1', () => {
    expect(resolveQuantizeFactor(new Float32Array([0, 128, 200, 255]))).toBe(1)
  })

  it('回归：首像素为 0 的 [0,255] 数据不再被误判为归一化（旧 f32[0]<=1.001 会错选 255）', () => {
    expect(resolveQuantizeFactor(new Float32Array([0, 128, 200, 255]))).toBe(1)
  })

  it('跳过非有限值（NaN/Infinity），以有限值判定量纲', () => {
    expect(resolveQuantizeFactor(new Float32Array([NaN, 0.3, Infinity, 0.8, -Infinity]))).toBe(255)
  })

  it('全部非有限值 → 抛业务错（不产出坏图）', () => {
    expect(() => resolveQuantizeFactor(new Float32Array([NaN, Infinity, -Infinity]))).toThrow(
      /非有限值/,
    )
  })
})

describe('P2-13 · upscale mergeTile 拼贴', () => {
  function makeFloatTensor(dims: number[], values: number[]): SerializedTensor {
    const f = new Float32Array(values)
    return { dataType: 'float32', dims, data: f.buffer }
  }

  it('[0,1] 张量按 ×255 写入 RGBA，alpha 恒 255', () => {
    // [1,3,2,2]：R=0.5,G=0.25,B=1.0 各 4 像素
    const vals = [
      0.5, 0.5, 0.5, 0.5, // R plane
      0.25, 0.25, 0.25, 0.25, // G plane
      1, 1, 1, 1, // B plane
    ]
    const out = makeFloatTensor([1, 3, 2, 2], vals)
    const dst = new Uint8Array(2 * 2 * 4)
    mergeTile(out, dst, 2, 2, 2, 0, 0)
    for (let i = 0; i < 4; i++) {
      expect([dst[i * 4], dst[i * 4 + 1], dst[i * 4 + 2], dst[i * 4 + 3]]).toEqual([128, 64, 255, 255])
    }
  })

  it('data 为带 byteOffset 的子视图时读到正确区域（P2-15 同源修复）', () => {
    const whole = new Float32Array(16) // 前 4 个 float 为填充，不参与
    const vals = [0.5, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25, 1, 1, 1, 1]
    for (let i = 0; i < vals.length; i++) whole[4 + i] = vals[i]
    const view = new Uint8Array(whole.buffer, 16) // byteOffset = 4 float = 16B
    const out: SerializedTensor = { dataType: 'float32', dims: [1, 3, 2, 2], data: view }
    const dst = new Uint8Array(2 * 2 * 4)
    mergeTile(out, dst, 2, 2, 2, 0, 0)
    expect([dst[0], dst[1], dst[2], dst[3]]).toEqual([128, 64, 255, 255])
  })

  it('destX/destY 偏移写入到大画布的正确位置', () => {
    const out = makeFloatTensor([1, 3, 1, 1], [0.5, 0.5, 0.5])
    const dstW = 3
    const dst = new Uint8Array(dstW * 3 * 4)
    mergeTile(out, dst, dstW, 1, 1, 2, 2) // 写到 (2,2)
    const d = (2 * dstW + 2) * 4
    expect([dst[d], dst[d + 1], dst[d + 2], dst[d + 3]]).toEqual([128, 128, 128, 255])
    // 其余保持 0
    expect(dst[0]).toBe(0)
  })
})

describe('P2-13 · buildTileTensor / pickOutput / clamp255', () => {
  it('buildTileTensor 边缘复制填充 + [0,1] 归一', () => {
    // 1 像素 RGB 源，填充到 2×2 tile：所有采样命中同一像素
    const data = new Uint8Array([255, 128, 0]) // R=255,G=128,B=0
    const t = buildTileTensor(data, 3, 1, 1, 0, 0, 2)
    expect(t.dims).toEqual([1, 3, 2, 2])
    const f = new Float32Array(t.data as ArrayBuffer)
    expect(f[0]).toBeCloseTo(1, 5) // R 平面全 1
    expect(f[4]).toBeCloseTo(128 / 255, 5) // G 平面
    expect(f[8]).toBe(0) // B 平面
  })

  it('pickOutput 选 4 维张量，无输出抛错', () => {
    const good: SerializedTensor = { dataType: 'float32', dims: [1, 3, 2, 2], data: new Float32Array(12).buffer }
    const bad: SerializedTensor = { dataType: 'float32', dims: [1], data: new Float32Array(1).buffer }
    expect(pickOutput({ a: bad, b: good })).toBe(good)
    expect(() => pickOutput({})).toThrow(/无输出张量/)
  })

  it('clamp255 边界', () => {
    expect(clamp255(-10)).toBe(0)
    expect(clamp255(300)).toBe(255)
    expect(clamp255(127.6)).toBe(128)
  })
})
