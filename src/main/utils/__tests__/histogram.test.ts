import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { calculateHistogram, getHistogramStats } from '../histogram'

describe('getHistogramStats（纯函数统计）', () => {
  it('空直方图返回全 0', () => {
    expect(getHistogramStats(new Uint32Array(256))).toEqual({
      min: 0, max: 0, mean: 0, median: 0, stdDev: 0,
    })
  })

  it('单一 bin：min=max=mean=median，stdDev=0', () => {
    const h = new Uint32Array(256)
    h[100] = 5
    const s = getHistogramStats(h)
    expect(s.min).toBe(100)
    expect(s.max).toBe(100)
    expect(s.mean).toBe(100)
    expect(s.median).toBe(100)
    expect(s.stdDev).toBe(0)
  })

  it('两极分布：mean/stdDev=127.5，median 取首个累计过半的 bin', () => {
    const arr = new Array(256).fill(0)
    arr[0] = 1
    arr[255] = 1
    const s = getHistogramStats(arr)
    expect(s.min).toBe(0)
    expect(s.max).toBe(255)
    expect(s.mean).toBeCloseTo(127.5, 5)
    expect(s.median).toBe(0)
    expect(s.stdDev).toBeCloseTo(127.5, 5)
  })

  it('均匀分布：mean=127.5，median=127', () => {
    const s = getHistogramStats(new Array(256).fill(1))
    expect(s.mean).toBeCloseTo(127.5, 5)
    expect(s.median).toBe(127)
    expect(s.min).toBe(0)
    expect(s.max).toBe(255)
  })

  it('Uint32Array 与 number[] 输入结果一致', () => {
    const arr = new Array(256).fill(0)
    arr[10] = 2
    arr[20] = 3
    expect(getHistogramStats(Uint32Array.from(arr))).toEqual(getHistogramStats(arr))
  })
})

describe('calculateHistogram（sharp 集成）', () => {
  let dir: string
  let redPath: string
  let bigPath: string

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'))
    redPath = path.join(dir, 'red.png')
    bigPath = path.join(dir, 'big.png')
    // 10x10 纯红（100 像素，不触发降采样）
    await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png().toFile(redPath)
    // 2000x1500 = 300 万像素（> 200 万阈值，触发降采样）
    await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 0, g: 128, b: 255 } } })
      .png().toFile(bigPath)
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('纯色图：RGB 与 Rec.601 亮度 bin 精确', async () => {
    const h = await calculateHistogram(redPath)
    expect(h.downsampled).toBe(false)
    expect(h.totalPixels).toBe(100)
    expect(h.r[255]).toBe(100)
    expect(h.g[0]).toBe(100)
    expect(h.b[0]).toBe(100)
    // 亮度 = round(0.299*255 + 0.587*0 + 0.114*0) = 76
    expect(h.luminance[76]).toBe(100)
  })

  it('超过 200 万像素自动降采样，totalPixels 仍报告原始像素数', async () => {
    const h = await calculateHistogram(bigPath)
    expect(h.downsampled).toBe(true)
    expect(h.totalPixels).toBe(2000 * 1500)
    // 实际统计的像素数（降采样后）应小于原始像素数
    const counted = Array.from(h.r).reduce((a, b) => a + b, 0)
    expect(counted).toBeGreaterThan(0)
    expect(counted).toBeLessThan(h.totalPixels)
  })

  it('不存在的文件抛出「直方图计算失败」', async () => {
    await expect(calculateHistogram(path.join(dir, 'nope.png')))
      .rejects.toThrow(/直方图计算失败/)
  })
})
