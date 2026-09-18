import sharp from 'sharp'
import { calculateHistogram, getHistogramStats } from '../../../utils/histogram'
import type { LuukSdk, PluginInstance } from '../../../../types/plugin'

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

/** 通道统计 */
interface ChannelStats {
  mean: number
  stdDev: number
}

/** 从原始 RGBA 数据计算某通道均值/标准差 */
function statsForChannel(data: Buffer, channels: number, offset: number): ChannelStats {
  let sum = 0
  let count = 0
  for (let i = offset; i < data.length; i += channels) {
    sum += data[i]
    count++
  }
  const mean = count ? sum / count : 0
  let varSum = 0
  for (let i = offset; i < data.length; i += channels) {
    const d = data[i] - mean
    varSum += d * d
  }
  return { mean, stdDev: count ? Math.sqrt(varSum / count) : 0 }
}

/** 亮度统计（Rec.601） */
function statsForLuminance(data: Buffer, channels: number): ChannelStats {
  let sum = 0
  let count = 0
  const lum = (i: number) =>
    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  for (let i = 0; i < data.length; i += channels) {
    sum += lum(i)
    count++
  }
  const mean = count ? sum / count : 0
  let varSum = 0
  for (let i = 0; i < data.length; i += channels) {
    const d = lum(i) - mean
    varSum += d * d
  }
  return { mean, stdDev: count ? Math.sqrt(varSum / count) : 0 }
}

/**
 * 对原始像素数据应用三步修正（白平衡 → 曝光 → 对比度）。
 * 供 applyAutotone（文件）与 applyAutotoneBuffer（内存）共用。
 */
function adjustData(
  data: Buffer,
  channels: number,
  lum: ChannelStats,
  r: ChannelStats,
  g: ChannelStats,
  b: ChannelStats,
  params?: AutotoneParams,
): void {
  const { exposure = true, contrast = true, whiteBalance = true } = params ?? {}

  // ── 白平衡：灰度世界假设 ──
  if (whiteBalance) {
    const rMean = r.mean || 1
    const gMean = g.mean || 1
    const bMean = b.mean || 1
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
    const deviation = (TARGET_MEAN - lum.mean) / TARGET_MEAN
    const brightnessFactor =
      1 + Math.max(-MAX_BRIGHTNESS_ADJUSTMENT, Math.min(MAX_BRIGHTNESS_ADJUSTMENT, deviation * MAX_BRIGHTNESS_ADJUSTMENT))
    for (let i = 0; i < data.length; i += channels) {
      data[i] = clamp(data[i] * brightnessFactor)
      data[i + 1] = clamp(data[i + 1] * brightnessFactor)
      data[i + 2] = clamp(data[i + 2] * brightnessFactor)
    }
  }

  // ── 对比度修正：标准差 < 50 时以均值为中心线性拉伸 ──
  if (contrast && lum.stdDev < CONTRAST_THRESHOLD) {
    const strength = (CONTRAST_THRESHOLD - lum.stdDev) / CONTRAST_THRESHOLD
    const slope = 1 + strength * MAX_CONTRAST_ENHANCEMENT
    const intercept = -(slope - 1) * lum.mean
    for (let i = 0; i < data.length; i += channels) {
      data[i] = clamp(data[i] * slope + intercept)
      data[i + 1] = clamp(data[i + 1] * slope + intercept)
      data[i + 2] = clamp(data[i + 2] * slope + intercept)
    }
  }
}

/**
 * 自动调色（文件到文件）
 * 保留原有导出签名，作为直接调用与单元测试入口。
 */
export async function applyAutotone(
  inputPath: string,
  outputPath: string,
  params?: AutotoneParams,
): Promise<void> {
  const histogram = await calculateHistogram(inputPath)
  const lumStats = getHistogramStats(histogram.luminance)
  const rStats = getHistogramStats(histogram.r)
  const gStats = getHistogramStats(histogram.g)
  const bStats = getHistogramStats(histogram.b)

  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels

  adjustData(
    data,
    channels,
    { mean: lumStats.mean, stdDev: lumStats.stdDev },
    { mean: rStats.mean, stdDev: rStats.stdDev },
    { mean: gStats.mean, stdDev: gStats.stdDev },
    { mean: bStats.mean, stdDev: bStats.stdDev },
    params,
  )

  await sharp(data, {
    raw: { width: info.width, height: info.height, channels },
  }).toFile(outputPath)
}

/**
 * 自动调色（Buffer 到 Buffer）
 * 供插件 executeOp 在 Worker 内内存处理，不落地中间文件。
 */
export async function applyAutotoneBuffer(
  inputBuffer: Uint8Array,
  params?: AutotoneParams,
): Promise<Uint8Array> {
  const { data, info } = await sharp(Buffer.from(inputBuffer))
    .rotate()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const channels = info.channels

  adjustData(
    data,
    channels,
    statsForLuminance(data, channels),
    statsForChannel(data, channels, 0),
    statsForChannel(data, channels, 1),
    statsForChannel(data, channels, 2),
    params,
  )

  const out = await sharp(data, {
    raw: { width: info.width, height: info.height, channels },
  })
    .png()
    .toBuffer()
  return new Uint8Array(out)
}

/** executeOp 输入负载 */
interface AutotoneInput {
  paths?: string[]
  path?: string
  libraryId?: number
  imageId?: number
  params?: AutotoneParams
}

/**
 * 插件入口：返回符合 executeOp 契约的实例。
 * 支持两种输入：菜单批处理（paths[]）与单元执行（path）。
 */
export function activate(_luuk: LuukSdk): PluginInstance {
  return {
    executeOp: async (sdk, opId, rawInput) => {
      if (opId !== 'autotone.auto') {
        throw new Error(`未知 op: ${opId}`)
      }
      const input = (rawInput ?? {}) as AutotoneInput
      const paths = input.paths ?? (input.path ? [input.path] : [])
      if (paths.length === 0) {
        return { results: [], skipped: true }
      }

      const results: Array<{ path: string; editId: number }> = []
      for (const p of paths) {
        const buf = await sdk.fs.read(p)
        const out = await applyAutotoneBuffer(buf, input.params)
        const editId = await sdk.edit.write({
          sourcePath: p,
          op: 'autotone.auto',
          outputBuffer: out,
          libraryId: input.libraryId,
          imageId: input.imageId,
          format: 'png',
        })
        results.push({ path: p, editId })
      }
      return { results }
    },
  }
}
