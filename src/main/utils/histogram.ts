import sharp from 'sharp'
import type { HistogramData } from '../../types'

export type { HistogramData }

/**
 * 计算图片直方图
 * @param imagePath 图片绝对路径
 * @returns 直方图数据
 */
export async function calculateHistogram(imagePath: string): Promise<HistogramData> {
  try {
    // 读取图片原始像素数据
    const { data, info } = await sharp(imagePath)
      .raw()
      .toBuffer({ resolveWithObject: true })

    const rHist = new Array(256).fill(0)
    const gHist = new Array(256).fill(0)
    const bHist = new Array(256).fill(0)
    const lumHist = new Array(256).fill(0)

    const totalPixels = info.width * info.height
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

      // 亮度直方图（ITU-R BT.709 标准）
      const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
      lumHist[luminance]++
    }

    return {
      r: rHist,
      g: gHist,
      b: bHist,
      luminance: lumHist,
      totalPixels,
    }
  } catch (err) {
    throw new Error(`直方图计算失败: ${(err as Error).message}`)
  }
}

/**
 * 计算直方图统计信息
 */
export function getHistogramStats(histogram: number[]): {
  min: number
  max: number
  mean: number
  median: number
  stdDev: number
} {
  const total = histogram.reduce((sum, count, i) => sum + count * i, 0)
  const totalPixels = histogram.reduce((sum, count) => sum + count, 0)

  if (totalPixels === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 }
  }

  const mean = total / totalPixels

  // 中位数
  let cumulative = 0
  let median = 0
  for (let i = 0; i < histogram.length; i++) {
    cumulative += histogram[i]
    if (cumulative >= totalPixels / 2) {
      median = i
      break
    }
  }

  // 标准差
  const variance = histogram.reduce((sum, count, i) => sum + count * Math.pow(i - mean, 2), 0) / totalPixels
  const stdDev = Math.sqrt(variance)

  // 最小/最大值（忽略 0 计数的 bin）
  let min = 255, max = 0
  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i] > 0) {
      if (i < min) min = i
      if (i > max) max = i
    }
  }

  return { min, max, mean, median, stdDev }
}
