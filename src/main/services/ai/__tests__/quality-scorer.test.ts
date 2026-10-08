/**
 * T23 · IQA 零模型启发式单测 — 纯函数喂合成缓冲 + scoreQuality 真实 sharp 集成（histogram.test 已证可用）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  QUALITY_MODEL_ID,
  QUALITY_PARAMS,
  laplacianVariance,
  sharpnessScore,
  exposureScore,
  compositionScore,
  composeTotal,
  scoreQuality,
} from '../quality-scorer'

/** 生成确定性伪随机灰度缓冲（LCG，避免 Math.random 抖动断言） */
function noiseGray(width: number, height: number, lo: number, hi: number): Uint8Array {
  const out = new Uint8Array(width * height)
  let seed = 42
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    out[i] = lo + (seed % (hi - lo + 1))
  }
  return out
}

describe('laplacianVariance / sharpnessScore（纯函数）', () => {
  it('纯色缓冲方差为 0，清晰度得分为 0', () => {
    const gray = new Uint8Array(64 * 64).fill(128)
    expect(laplacianVariance(gray, 64, 64)).toBe(0)
    expect(sharpnessScore(0)).toBe(0)
  })

  it('高频噪声方差远高于平滑渐变', () => {
    const w = 64, h = 64
    const noisy = noiseGray(w, h, 0, 255)
    const smooth = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) smooth[y * w + x] = Math.round(128 + x * 0.2)
    expect(laplacianVariance(noisy, w, h)).toBeGreaterThan(laplacianVariance(smooth, w, h) * 10)
  })

  it('小于 3px 的退化尺寸返回 0 不越界', () => {
    expect(laplacianVariance(new Uint8Array(4), 2, 2)).toBe(0)
  })

  it('sharpnessScore 单调递增且饱和于 [0,100]', () => {
    const low = sharpnessScore(10)
    const mid = sharpnessScore(QUALITY_PARAMS.SHARPNESS_K)
    const high = sharpnessScore(10_000)
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
    expect(mid).toBeCloseTo(63.2, 1)
    expect(high).toBeLessThanOrEqual(100)
  })
})

describe('exposureScore（纯函数）', () => {
  const fill = (v: number, n = 1000) => new Uint8Array(n).fill(v)

  it('中灰 128 得满分', () => {
    expect(exposureScore(fill(128))).toBe(100)
  })

  it('欠曝全黑被截断惩罚归零', () => {
    expect(exposureScore(fill(0))).toBe(0)
  })

  it('轻微偏暗得分低于中灰但明显高于全黑', () => {
    // fill(96)：deviation=0.25 → devTerm=1-0.25/0.45≈0.444
    const darkish = exposureScore(fill(96))
    expect(darkish).toBeLessThan(100)
    expect(darkish).toBeGreaterThan(30)
  })

  it('空缓冲返回 0', () => {
    expect(exposureScore(new Uint8Array(0))).toBe(0)
  })
})

describe('compositionScore（纯函数）', () => {
  it('平坦图返回中性 50', () => {
    const w = 90, h = 90
    const flat = new Uint8Array(w * h).fill(100)
    expect(compositionScore(flat, w, h)).toBe(50)
  })

  it('退化小图返回中性 50', () => {
    expect(compositionScore(new Uint8Array(16), 4, 4)).toBe(50)
  })

  it('边缘能量集中于三分交点时高于均匀棋盘基线', () => {
    const w = 90, h = 90
    // 均匀棋盘：全图梯度能量均匀 → ratio≈1 → 50
    const checker = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) checker[y * w + x] = (x >> 3) % 2 ? 255 : 0
    const baseline = compositionScore(checker, w, h)
    // 交点团块：仅四交点窗口内有高频纹理，其余平坦 → ratio≫1 → 高于基线
    const blob = new Uint8Array(w * h)
    const half = Math.round(Math.min(w, h) * QUALITY_PARAMS.COMPOSITION_WINDOW_RATIO)
    for (const fy of [1 / 3, 2 / 3]) {
      for (const fx of [1 / 3, 2 / 3]) {
        const cx = Math.round(fx * w), cy = Math.round(fy * h)
        for (let y = cy - half; y <= cy + half; y++) {
          for (let x = cx - half; x <= cx + half; x++) {
            if (x >= 0 && x < w && y >= 0 && y < h) blob[y * w + x] = (x + y) % 2 ? 255 : 0
          }
        }
      }
    }
    const focused = compositionScore(blob, w, h)
    expect(focused).toBeGreaterThan(baseline)
    expect(focused).toBeLessThanOrEqual(100)
  })
})

describe('composeTotal（加权与夹取）', () => {
  it('满分分量 → 100', () => {
    expect(composeTotal({ sharpness: 100, exposure: 100, composition: 100 })).toBe(100)
  })
  it('权重应用：全 0 → 0；混合按 0.4/0.35/0.25', () => {
    expect(composeTotal({ sharpness: 0, exposure: 0, composition: 0 })).toBe(0)
    expect(composeTotal({ sharpness: 100, exposure: 0, composition: 0 })).toBe(40)
    expect(composeTotal({ sharpness: 0, exposure: 100, composition: 0 })).toBe(35)
    expect(composeTotal({ sharpness: 0, exposure: 0, composition: 100 })).toBe(25)
  })
})

describe('scoreQuality（sharp 集成，回归序断言 §2.8）', () => {
  let dir: string
  let sharpPath: string
  let blurPath: string
  let underPath: string
  let normalPath: string

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-test-'))
    const w = 200, h = 150
    // 清晰纹理底图（高频棋盘 + 噪声）
    const base = new Uint8Array(w * h * 3)
    let seed = 7
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        seed = (seed * 1103515245 + 12345) % 2147483648
        const checker = ((x >> 1) + (y >> 1)) % 2 ? 230 : 25
        const v = Math.max(0, Math.min(255, checker + (seed % 21) - 10))
        const i = (y * w + x) * 3
        base[i] = v; base[i + 1] = v; base[i + 2] = v
      }
    }
    const raw = { width: w, height: h, channels: 3 } as const
    sharpPath = path.join(dir, 'sharp.png')
    await sharp(Buffer.from(base), { raw }).png().toFile(sharpPath)
    // 强模糊版本
    blurPath = path.join(dir, 'blur.png')
    await sharp(Buffer.from(base), { raw }).blur(8).png().toFile(blurPath)
    // 欠曝版本（×0.1）与正常中灰版本
    const dark = Buffer.from(base)
    const mid = Buffer.from(base)
    for (let i = 0; i < w * h; i++) {
      dark[i * 3] = Math.round(dark[i * 3] * 0.08)
      dark[i * 3 + 1] = Math.round(dark[i * 3 + 1] * 0.08)
      dark[i * 3 + 2] = Math.round(dark[i * 3 + 2] * 0.08)
    }
    for (let i = 0; i < mid.length; i++) mid[i] = 128
    underPath = path.join(dir, 'under.png')
    await sharp(dark, { raw: { width: w, height: h, channels: 3 } }).png().toFile(underPath)
    normalPath = path.join(dir, 'normal.png')
    await sharp(mid, { raw }).png().toFile(normalPath)
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('清晰图清晰度与总分显著高于模糊图', async () => {
    const s = await scoreQuality(sharpPath)
    const b = await scoreQuality(blurPath)
    expect(s.sharpness).toBeGreaterThan(b.sharpness + 30)
    expect(s.total).toBeGreaterThan(b.total)
  })

  it('正常曝光清晰图质量分高于同源欠曝版本', async () => {
    // 对比同源纹理图（正常曝光 vs ×0.08 欠曝），避免用平坦中灰图（清晰度必然 0）
    const s = await scoreQuality(sharpPath)
    const u = await scoreQuality(underPath)
    expect(s.exposure).toBeGreaterThan(u.exposure)
    expect(s.total).toBeGreaterThan(u.total)
  })

  it('全部输出落在合法域：total 整数 [0,100]，分量 [0,100]', async () => {
    for (const p of [sharpPath, blurPath, underPath, normalPath]) {
      const s = await scoreQuality(p)
      expect(Number.isInteger(s.total)).toBe(true)
      expect(s.total).toBeGreaterThanOrEqual(0)
      expect(s.total).toBeLessThanOrEqual(100)
      for (const v of [s.sharpness, s.exposure, s.composition]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    }
  })

  it('损坏/不存在文件抛「质量分计算失败」', async () => {
    await expect(scoreQuality(path.join(dir, 'nope.png'))).rejects.toThrow(/质量分计算失败/)
  })

  it('model_id 常量为 heuristic-v1（D-1 决策口径）', () => {
    expect(QUALITY_MODEL_ID).toBe('heuristic-v1')
  })
})
