/**
 * Phase 9 M5 · T23 — IQA 零模型启发式质量分（D-1 决策：不新增模型资产）。
 *
 * 口径对齐 `utils/histogram.ts`：单遍解码到 ≤MAX_PIXELS 灰度缓冲（Rec.601），
 * 禁止整图原始像素常驻（R7 内存 ≤ 黄区）。三分量：
 * - sharpness：Laplacian 3×3 方差（经典清晰度代理），饱和映射归一；
 * - exposure：亮度均值偏离理想中位 128 + 高光/暗部截断比例；
 * - composition：三分法四交点梯度能量 vs 全图均值的对比（中性基线 50）。
 *
 * 关键约束（仿 onnx-clip-engine）：本文件顶层零原生依赖 —— sharp 仅在生产入口
 * `scoreQuality` 内 `await import()`；纯函数分量导出供 vitest 直接喂缓冲测试。
 */

/** quality_scores.model_id 落库值（§2.1b；后续换深度模型时以此区分口径） */
export const QUALITY_MODEL_ID = 'heuristic-v1'

/** 调参中心（仿 SCORER_PARAMS 风格） */
export const QUALITY_PARAMS = {
  /** 降采样阈值，与 histogram.ts 同口径（200 万像素） */
  MAX_PIXELS: 2_000_000,
  /** 总分权重 */
  WEIGHT_SHARPNESS: 0.4,
  WEIGHT_EXPOSURE: 0.35,
  WEIGHT_COMPOSITION: 0.25,
  /** sharpness 饱和常数：variance=K 时得分 ≈ 63% */
  SHARPNESS_K: 150,
  /** exposure：亮度均值偏差 |mean-128|/128 达到该值 → 偏差项归零 */
  EXPOSURE_TOLERANCE: 0.45,
  /** exposure：截断比例（bin0+bin255）惩罚增益，clip×GAIN ≥ 1 → 归零 */
  EXPOSURE_CLIP_GAIN: 4,
  /** composition：交点窗口半宽 = 短边 × 该比例 */
  COMPOSITION_WINDOW_RATIO: 0.1,
  /** composition：交点能量比 (ratio-1)×GAIN 叠加到中性基线 0.5 */
  COMPOSITION_GAIN: 0.5,
}

export interface QualityScores {
  /** 加权总分 [0,100] 整数 */
  total: number
  /** 分量 [0,100]，保留一位小数 */
  sharpness: number
  exposure: number
  composition: number
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * Laplacian 3×3（核 [0,1,0;1,-4,1;0,1,0]）响应方差。
 * 外圈 1px 不参与（免边界处理）；纯色/平滑图 → 0。
 */
export function laplacianVariance(gray: Uint8Array | Buffer, width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const v = -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width]
      sum += v
      sumSq += v * v
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return Math.max(0, sumSq / n - mean * mean)
}

/** 清晰度得分：variance 饱和映射 100×(1-e^(-v/K)) */
export function sharpnessScore(variance: number): number {
  const v = Math.max(0, variance)
  return round1(100 * (1 - Math.exp(-v / QUALITY_PARAMS.SHARPNESS_K)))
}

/**
 * 曝光得分：灰度缓冲直接建 256-bin 亮度直方图（与 histogram 的 luminance 通道同口径，
 * sharp grayscale 即 BT.601 luma）→ 偏差项 × 截断项。
 */
export function exposureScore(gray: Uint8Array | Buffer): number {
  if (gray.length === 0) return 0
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  const mean = sum / total
  const deviation = Math.abs(mean - 128) / 128
  const clipRatio = (hist[0] + hist[255]) / total
  const devTerm = clamp(1 - deviation / QUALITY_PARAMS.EXPOSURE_TOLERANCE, 0, 1)
  const clipTerm = clamp(1 - clipRatio * QUALITY_PARAMS.EXPOSURE_CLIP_GAIN, 0, 1)
  return round1(100 * devTerm * clipTerm)
}

/**
 * 构图得分：梯度幅值（|Δx|+|Δy|）在全图与三分法四交点窗口的均值之比，
 * ratio=1（交点无突出边缘能量）→ 中性 50，交点能量越突出得分越高。
 */
export function compositionScore(gray: Uint8Array | Buffer, width: number, height: number): number {
  if (width < 5 || height < 5) return 50
  const { COMPOSITION_WINDOW_RATIO: WR, COMPOSITION_GAIN: GAIN } = QUALITY_PARAMS
  // 逐像素梯度幅值（内圈 1px）
  const innerW = width - 2
  const innerH = height - 2
  const grad = new Float64Array(innerW * innerH)
  let gSum = 0
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    const outRow = (y - 1) * innerW
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const g = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + width] - gray[i - width])
      grad[outRow + (x - 1)] = g
      gSum += g
    }
  }
  const globalMean = gSum / grad.length
  // 交点窗口均值（窗口坐标映射进 grad 内圈坐标系）
  const frac = [1 / 3, 2 / 3]
  const half = Math.max(1, Math.round(Math.min(width, height) * WR))
  let interSum = 0
  let interCount = 0
  for (const fy of frac) {
    for (const fx of frac) {
      const cx = Math.round(fx * width) - 1 // grad 坐标（减去内圈偏移 1）
      const cy = Math.round(fy * height) - 1
      const x0 = clamp(cx - half, 0, innerW)
      const x1 = clamp(cx + half, 0, innerW)
      const y0 = clamp(cy - half, 0, innerH)
      const y1 = clamp(cy + half, 0, innerH)
      if (x1 <= x0 || y1 <= y0) continue
      for (let y = y0; y < y1; y++) {
        const row = y * innerW
        for (let x = x0; x < x1; x++) {
          interSum += grad[row + x]
          interCount++
        }
      }
    }
  }
  if (interCount === 0 || globalMean <= 0) return 50
  const ratio = interSum / interCount / globalMean
  return round1(100 * clamp(0.5 + (ratio - 1) * GAIN, 0, 1))
}

/** 由三分量合成总分（权重和 = 1，输出 [0,100] 整数） */
export function composeTotal(s: { sharpness: number; exposure: number; composition: number }): number {
  const { WEIGHT_SHARPNESS: ws, WEIGHT_EXPOSURE: we, WEIGHT_COMPOSITION: wc } = QUALITY_PARAMS
  return Math.round(clamp(ws * s.sharpness + we * s.exposure + wc * s.composition, 0, 100))
}

/**
 * 生产入口：图片绝对路径 → 质量分。
 * 单遍解码（灰度 + 按需降采样），损坏文件抛错（作业侧记 failed，可 resume）。
 */
export async function scoreQuality(absPath: string): Promise<QualityScores> {
  const sharpMod = await import('sharp')
  const sharp = sharpMod.default ?? sharpMod
  try {
    const metadata = await sharp(absPath).metadata()
    const ow = metadata.width || 0
    const oh = metadata.height || 0
    if (ow === 0 || oh === 0) throw new Error('无法读取图片尺寸')

    let pipeline = sharp(absPath).grayscale()
    // 与 histogram.ts 同口径：超阈值降采样至 200 万像素（保持宽高比）
    if (ow * oh > QUALITY_PARAMS.MAX_PIXELS) {
      const scale = Math.sqrt(QUALITY_PARAMS.MAX_PIXELS / (ow * oh))
      pipeline = pipeline.resize({ width: Math.max(1, Math.round(ow * scale)), withoutEnlargement: true })
    }
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
    const gray = data as Uint8Array
    const width = info.width
    const height = info.height

    const sharpness = sharpnessScore(laplacianVariance(gray, width, height))
    const exposure = exposureScore(gray)
    const composition = compositionScore(gray, width, height)
    return { total: composeTotal({ sharpness, exposure, composition }), sharpness, exposure, composition }
  } catch (err) {
    throw new Error(`质量分计算失败: ${(err as Error).message}`)
  }
}
