/**
 * upscale 后处理纯函数（P2-13 / P2-19 可测）
 *
 * 从 index.ts 抽出，便于在不加载 onnxruntime / sharp 的前提下对
 * 「量纲判定 / 分块张量构建 / 瓦片拼贴」做单元测试。
 * 这些函数不依赖任何原生模块，仅操作 Float32Array / Uint8Array / SerializedTensor。
 */

import type { SerializedTensor } from '../../../../types/plugin'

export function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)))
}

/**
 * 判定 float 输出张量的量纲：[0,1] → 返回 255（需放大到 8bit），[0,255] → 返回 1。
 *
 * [P2-13] 关键修复：
 *  - 不再用「首像素 f32[0] <= 1.001」这一单点判据（首像素恰好为 0 或异常即误判整图）；
 *  - 扫描全局 min/max，跳过非有限值（NaN/Infinity），防单个 NaN 污染 min/max 使整图变黑；
 *  - 若全部为非有限值，抛业务错（明确失败优于产出坏图）。
 *
 * @returns 量化乘数（255 或 1）
 */
export function resolveQuantizeFactor(f32: Float32Array, sampleLimit = 4096): number {
  const n = Math.min(f32.length, sampleLimit)
  let min = Infinity
  let max = -Infinity
  let finite = 0
  for (let i = 0; i < n; i++) {
    const v = f32[i]
    if (!Number.isFinite(v)) continue // 跳过 NaN/Infinity
    finite++
    if (v < min) min = v
    if (v > max) max = v
  }
  if (finite === 0) {
    throw new Error('超分输出张量全部为非有限值（NaN/Infinity），模型推理结果异常')
  }
  // 全落在 [~0,1] 视为归一化输出，需 ×255；否则视为已是 8bit 量纲
  const isNormalized = max <= 1.001 && min >= -0.001
  return isNormalized ? 255 : 1
}

/** 从解码像素 (RGB raw) 构建 NCHW float32 张量（[0,1]），边缘复制填充到 T×T */
export function buildTileTensor(
  data: Uint8Array,
  srcChannels: number,
  W: number,
  H: number,
  tx: number,
  ty: number,
  T: number,
): SerializedTensor {
  const plane = T * T
  const f = new Float32Array(3 * plane)
  for (let j = 0; j < T; j++) {
    const sy = Math.min(H - 1, Math.max(0, ty + j))
    for (let i = 0; i < T; i++) {
      const sx = Math.min(W - 1, Math.max(0, tx + i))
      const s = (sy * W + sx) * srcChannels
      const d = j * T + i
      f[d] = data[s] / 255
      f[plane + d] = data[s + 1] / 255
      f[2 * plane + d] = data[s + 2] / 255
    }
  }
  return { dataType: 'float32', dims: [1, 3, T, T], data: f.buffer }
}

/** 挑选输出张量（[1,3,oH,oW]） */
export function pickOutput(outputs: Record<string, SerializedTensor>): SerializedTensor {
  const list = Object.values(outputs).filter((t) => t.dims.length === 4)
  const t = list[0] ?? Object.values(outputs)[0]
  if (!t) throw new Error('超分模型无输出张量')
  return t
}

/**
 * 将输出张量按 tile 内部 [0, dy)×[0, dx) 区域拼接回全尺寸 RGBA 缓冲。
 * [P2-13] float 量纲以整块 min/max 判定（resolveQuantizeFactor），替代逐像素首像素判据。
 */
export function mergeTile(
  out: SerializedTensor,
  dst: Uint8Array,
  dstW: number,
  dx: number,
  dy: number,
  destX: number,
  destY: number,
): void {
  const buf = out.data instanceof ArrayBuffer ? out.data : out.data.buffer
  const byteOffset = out.data instanceof ArrayBuffer ? 0 : out.data.byteOffset
  const oH = out.dims[2]
  const oW = out.dims[3]
  const plane = oH * oW
  const isFloat = out.dataType === 'float32' || out.dataType === 'float64'
  // [P2-15] 按 byteOffset 构造视图，避免 data 为子视图时读到错误区域
  const f32 = isFloat ? new Float32Array(buf as ArrayBuffer, byteOffset) : null
  const u8 = !isFloat ? new Uint8Array(buf as ArrayBuffer, byteOffset) : null
  const factor = f32 ? resolveQuantizeFactor(f32) : 1

  const copyW = Math.min(dx, oW)
  const copyH = Math.min(dy, oH)

  for (let j = 0; j < copyH; j++) {
    for (let i = 0; i < copyW; i++) {
      const s = j * oW + i
      let r: number
      let g: number
      let b: number
      if (f32) {
        r = f32[s] * factor
        g = f32[plane + s] * factor
        b = f32[2 * plane + s] * factor
      } else {
        r = u8![s]
        g = u8![plane + s]
        b = u8![2 * plane + s]
      }
      const d = ((destY + j) * dstW + (destX + i)) * 4
      dst[d] = clamp255(r)
      dst[d + 1] = clamp255(g)
      dst[d + 2] = clamp255(b)
      dst[d + 3] = 255
    }
  }
}
