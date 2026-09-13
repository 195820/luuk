import sharp from 'sharp'
import { calculateHistogram, getHistogramStats } from '../../../utils/histogram'

/** 自动调色参数 */
export interface AutotoneParams {
  /** 是否启用曝光修正（默认 true） */
  exposure?: boolean
  /** 是否启用对比度修正（默认 true） */
  contrast?: boolean
  /** 是否启用白平衡修正（默认 true） */
  whiteBalance?: boolean
}

/** 亮度修正上限（±30%） */
const MAX_BRIGHTNESS_ADJUSTMENT = 0.3

/** 目标亮度中值 */
const TARGET_MEAN = 128

/** 对比度增强触发阈值（标准差低于此值时增强） */
const CONTRAST_THRESHOLD = 50

/** 对比度最大增强幅度 */
const MAX_CONTRAST_ENHANCEMENT = 0.5

/** 像素值裁剪 */
function clamp(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

/**
 * 自动调色
 *
 * 算法流程：
 * 1. 分析直方图获取亮度/通道统计
 * 2. 白平衡修正（灰度世界假设）
 * 3. 曝光修正（亮度均值向 128 靠拢）
 * 4. 对比度修正（低标准差时拉伸）
 */
export async function applyAutotone(
  inputPath: string,
  outputPath: string,
  params?: AutotoneParams
): Promise<void> {
  const { exposure = true, contrast = true, whiteBalance = true } = params ?? {}

  // 分析原始图像直方图
  const histogram = await calculateHistogram(inputPath)
  const lumStats = getHistogramStats(histogram.luminance)
  const rStats = getHistogramStats(histogram.r)
  const gStats = getHistogramStats(histogram.g)
  const bStats = getHistogramStats(histogram.b)

  // 读取原始像素数据（所有调整在内存中完成）
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels

  // ── 白平衡：灰度世界假设 ──
  // R/G/B 均值对齐到全局均值，消除色偏
  if (whiteBalance) {
    const rMean = rStats.mean || 1
    const gMean = gStats.mean || 1
    const bMean = bStats.mean || 1
    const globalMean = (rMean + gMean + bMean) / 3

    const rGain = globalMean / rMean
    const gGain = globalMean / gMean
    const bGain = globalMean / bMean

    for (let i = 0; i < data.length; i += channels) {
      data[i] = clamp(data[i] * rGain)
      data[i + 1] = clamp(data[i + 1] * gGain)
      data[i + 2] = clamp(data[i + 2] * bGain)
    }
  }

  // ── 曝光修正：亮度均值向 128 靠拢 ──
  if (exposure) {
    const deviation = (TARGET_MEAN - lumStats.mean) / TARGET_MEAN
    // 限制在 ±30% 范围内
    const brightnessFactor = 1 + Math.max(-MAX_BRIGHTNESS_ADJUSTMENT, Math.min(MAX_BRIGHTNESS_ADJUSTMENT, deviation * MAX_BRIGHTNESS_ADJUSTMENT))

    for (let i = 0; i < data.length; i += channels) {
      data[i] = clamp(data[i] * brightnessFactor)
      data[i + 1] = clamp(data[i + 1] * brightnessFactor)
      data[i + 2] = clamp(data[i + 2] * brightnessFactor)
    }
  }

  // ── 对比度修正：标准差 < 50 时线性拉伸 ──
  // 以原始均值为中心，避免对偏暗/偏亮图像产生反向效果
  if (contrast && lumStats.stdDev < CONTRAST_THRESHOLD) {
    const strength = (CONTRAST_THRESHOLD - lumStats.stdDev) / CONTRAST_THRESHOLD
    const slope = 1 + strength * MAX_CONTRAST_ENHANCEMENT
    // 截距保证原始均值不变（围绕均值拉伸）
    const intercept = -(slope - 1) * lumStats.mean

    for (let i = 0; i < data.length; i += channels) {
      data[i] = clamp(data[i] * slope + intercept)
      data[i + 1] = clamp(data[i + 1] * slope + intercept)
      data[i + 2] = clamp(data[i + 2] * slope + intercept)
    }
  }

  // 写入输出文件
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels }
  }).toFile(outputPath)
}
