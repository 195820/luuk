import sharp from 'sharp'
import type { HistogramData } from '../../types'

export type { HistogramData }

/** 降采样阈值：200 万像素（4K 图 ≈ 830 万像素，需降采样） */
const MAX_PIXELS = 2_000_000

/**
 * 计算图片直方图
 * - 超过 200 万像素自动降采样（保持宽高比）
 * - 亮度使用 Rec.601 标准（0.299R + 0.587G + 0.114B）
 * - 数据结构使用 Uint32Array(256) 四通道
 */
export async function calculateHistogram(imagePath: string): Promise<HistogramData> {
  try {
    // 先获取元数据判断是否需要降采样
    const metadata = await sharp(imagePath).metadata()
    const originalWidth = metadata.width || 0
    const originalHeight = metadata.height || 0
    const totalPixels = originalWidth * originalHeight
    const downsampled = totalPixels > MAX_PIXELS

    // 构建 sharp pipeline
    let pipeline = sharp(imagePath)

    // 超过阈值时降采样至 200 万像素（保持宽高比）
    if (downsampled) {
      const scale = Math.sqrt(MAX_PIXELS / totalPixels)
      const targetWidth = Math.round(originalWidth * scale)
      pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: true })
    }

    // 读取原始像素数据
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })

    const rHist = new Uint32Array(256)
    const gHist = new Uint32Array(256)
    const bHist = new Uint32Array(256)
    const lumHist = new Uint32Array(256)

    const channels = info.channels

    // 遍历所有像素
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      // RGB 直方图
      rHist[r]++
      gHist[g]++
      bHist[b]++

      // 亮度（ITU-R BT.601 标准）
      const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      lumHist[luminance]++
    }

    return {
      r: rHist,
      g: gHist,
      b: bHist,
      luminance: lumHist,
      totalPixels,
      downsampled,
    }
  } catch (err) {
    throw new Error(`直方图计算失败: ${(err as Error).message}`)
  }
}

/**
 * 计算直方图统计信息
 */
export function getHistogramStats(histogram: Uint32Array | number[]): {
  min: number
  max: number
  mean: number
  median: number
  stdDev: number
} {
  // 统一转为 number[] 以兼容 Uint32Array 和 number[]
  const data = histogram instanceof Uint32Array ? Array.from(histogram) : histogram

  const total = data.reduce((sum: number, count: number, i: number) => sum + count * i, 0)
  const totalPixels = data.reduce((sum: number, count: number) => sum + count, 0)

  if (totalPixels === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 }
  }

  const mean = total / totalPixels

  // 中位数
  let cumulative = 0
  let median = 0
  for (let i = 0; i < data.length; i++) {
    cumulative += data[i]
    if (cumulative >= totalPixels / 2) {
      median = i
      break
    }
  }

  // 标准差
  const variance = data.reduce((sum: number, count: number, i: number) => sum + count * Math.pow(i - mean, 2), 0) / totalPixels
  const stdDev = Math.sqrt(variance)

  // 最小/最大值（忽略 0 计数的 bin）
  let min = 255, max = 0
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0) {
      if (i < min) min = i
      if (i > max) max = i
    }
  }

  return { min, max, mean, median, stdDev }
}
