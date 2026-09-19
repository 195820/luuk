/**
 * matting 后处理纯函数（P2-14 / P2-15 / P2-19 可测）
 *
 * 从 index.ts 抽出，不依赖 sharp / onnxruntime，可单独对「张量视图 / 显著度归一 /
 * 重采样 / alpha 合成」做单元测试。
 */

import type { SerializedTensor } from '../../../../types/plugin'

function bytesPerElement(dataType: SerializedTensor['dataType']): number {
  switch (dataType) {
    case 'int64':
    case 'float64':
      return 8
    case 'int32':
    case 'float32':
      return 4
    case 'uint8':
      return 1
  }
}

/**
 * [P2-15] 将 SerializedTensor.data 视图化为 Float32Array。
 * - 按 byteOffset / byteLength 构造视图：data 可能是底层大 buffer 的子视图（结构化克隆/切片后），
 *   旧实现 `new Float32Array(t.data.buffer)` 忽略 byteOffset → 读到错误区域。
 * - int64 单独处理：BigInt64Array 逐元素 Number() 转换（BigInt 不能直接进 Float32Array）。
 * - 校验 prod(dims) × 元素字节数 === byteLength，尺寸/类型不符即抛错，防静默错位。
 */
export function asFloat32(t: SerializedTensor): Float32Array {
  const { buf, byteOffset, byteLength } =
    t.data instanceof ArrayBuffer
      ? { buf: t.data as ArrayBuffer, byteOffset: 0, byteLength: t.data.byteLength }
      : {
          buf: t.data.buffer as ArrayBuffer,
          byteOffset: t.data.byteOffset,
          byteLength: t.data.byteLength,
        }
  const count = t.dims.reduce((a, b) => a * b, 1)
  const bpe = bytesPerElement(t.dataType)
  if (count * bpe !== byteLength) {
    throw new Error(
      `张量尺寸不符：prod(dims)=${count} × ${bpe}B ≠ byteLength=${byteLength}（dataType=${t.dataType}）`,
    )
  }
  if (t.dataType === 'float32') return new Float32Array(buf, byteOffset, count)

  const src: ArrayLike<number | bigint> =
    t.dataType === 'uint8'
      ? new Uint8Array(buf, byteOffset, count)
      : t.dataType === 'int32'
        ? new Int32Array(buf, byteOffset, count)
        : t.dataType === 'float64'
          ? new Float64Array(buf, byteOffset, count)
          : new BigInt64Array(buf, byteOffset, count) // int64

  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = Number(src[i])
  return out
}

/**
 * [P2-14] 将 [0,1] 显著度数组映射为绝对 alpha（Uint8）。
 * 替代原「min-max 拉伸」——min-max 会把整图对比度强行拉到 [0,255]，
 * 使本应半透明/全不透明的区域失真（且当显著图近似常数时 span≈0 会整体塌成 0/黑）。
 * 改为保留绝对量纲：a∈[0,1] → round(clamp01(a)×255)。
 * 可选固定软阈值 softThreshold（默认 0.5）：阈值以下的低置信背景做二次衰减以抑制边缘噪声/残留，
 * 阈值以上保持绝对值。softThreshold=0 即纯绝对映射。
 */
export function saliencyPlaneToAlpha(plane: Float32Array, softThreshold = 0.5): Uint8Array {
  const gray = new Uint8Array(plane.length)
  const t = Math.min(1, Math.max(0, softThreshold))
  for (let i = 0; i < plane.length; i++) {
    let a = plane[i]
    if (!Number.isFinite(a)) {
      gray[i] = 0 // 非有限值按透明处理，不污染相邻像素
      continue
    }
    if (a < 0) a = 0
    else if (a > 1) a = 1
    if (t > 0 && a < t) a = a * (a / t) // 阈值以下二次衰减
    gray[i] = Math.round(a * 255)
  }
  return gray
}

/** 通道数（NCHW：倒数第三维；2D 兜底 1） */
function channelCount(t: SerializedTensor): number {
  if (t.dims.length === 4) return t.dims[1]
  if (t.dims.length === 3) return t.dims[0]
  return 1
}

/** 从推理输出映射中挑选显著图张量（[n,c,h,w]，取通道 0） */
export function pickSaliency(outputs: Record<string, SerializedTensor>): SerializedTensor {
  const list = Object.values(outputs)
  if (list.length === 0) throw new Error('模型无输出张量')
  const ranked = list
    .filter((t) => t.dims.length >= 2)
    .sort((a, b) => channelCount(a) - channelCount(b))
  return ranked[0] ?? list[0]
}

/**
 * 将显著性张量转为单通道灰度 [0,255]。
 * 自动识别 logits（越界则先做 sigmoid），再做绝对量纲 alpha 映射（P2-14）。
 */
export function saliencyToGray(
  t: SerializedTensor,
  softThreshold = 0.5,
): { width: number; height: number; gray: Uint8Array } {
  const dims = t.dims
  let width: number
  let height: number
  if (dims.length === 4) {
    height = dims[2]
    width = dims[3]
  } else if (dims.length === 3) {
    height = dims[1]
    width = dims[2]
  } else {
    height = dims[0]
    width = dims[1]
  }
  const hwPlane = height * width

  const f32 = asFloat32(t)
  const plane = new Float32Array(hwPlane)
  for (let i = 0; i < hwPlane; i++) plane[i] = f32[i] // 通道 0

  // 判断是否 logits：存在越界值则做 sigmoid
  let needsSigmoid = false
  for (let i = 0; i < plane.length; i++) {
    const v = plane[i]
    if (Number.isFinite(v) && (v < -0.01 || v > 1.01)) {
      needsSigmoid = true
      break
    }
  }
  if (needsSigmoid) {
    for (let i = 0; i < plane.length; i++) plane[i] = 1 / (1 + Math.exp(-plane[i]))
  }

  const gray = saliencyPlaneToAlpha(plane, softThreshold)
  return { width, height, gray }
}

/** 双线性重采样灰度图到目标尺寸 */
export function resizeGray(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const out = new Uint8Array(dw * dh)
  const sx = sw / dw
  const sy = sh / dh
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = fx - x0
      const a = src[y0 * sw + x0]
      const b = src[y0 * sw + x1]
      const c = src[y1 * sw + x0]
      const d = src[y1 * sw + x1]
      const top = a + (b - a) * wx
      const bot = c + (d - c) * wx
      out[y * dw + x] = Math.round(top + (bot - top) * wy)
    }
  }
  return out
}

/**
 * 将 RGB(A) 源图像素与 alpha 掩码合成为 RGBA。
 * src 为解码后的连续像素（channels=3 或 4）。
 */
export function compositeAlpha(
  src: Uint8Array,
  srcChannels: number,
  gray: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = src[i * srcChannels]
    rgba[i * 4 + 1] = src[i * srcChannels + 1]
    rgba[i * 4 + 2] = src[i * srcChannels + 2]
    rgba[i * 4 + 3] = gray[i]
  }
  return rgba
}
