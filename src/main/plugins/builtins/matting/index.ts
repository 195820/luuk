/**
 * AI 抠图内置插件（matting）
 *
 * 契约与 autotone 保持一致：activate(luuk) → { executeOp(sdk, opId, input) }。
 * 运行于 utilityProcess：
 *   1. sdk.fs.read 读取源图（经主进程权限校验，限制库目录内）
 *   2. sdk.image.normalize 预处理为模型输入张量（Worker 本地 sharp，不跨进程传大图）
 *   3. sdk.inference.createSession + run：u2netp 显著性分割（会话池并发=1，批处理优先级）
 *   4. 后处理：显著图 → alpha 通道 → 合成透明背景 RGBA → sdk.image.encode
 *   5. sdk.edit.write 写编辑版本链
 */

import type { LuukSdk, PluginInstance, SerializedTensor } from '../../../../types/plugin'

const MODEL_ID = 'u2netp'
const MODEL_SIZE = { width: 320, height: 320 }

/** executeOp 输入负载 */
interface MattingInput {
  paths?: string[]
  path?: string
  libraryId?: number
  imageId?: number
}

/** 从推理输出映射中挑选显著图张量（[n,c,h,w]，取通道 0） */
function pickSaliency(outputs: Record<string, SerializedTensor>): SerializedTensor {
  const list = Object.values(outputs)
  if (list.length === 0) throw new Error('模型无输出张量')
  // 优先选择 dims 形如 [1,1,H,W] / [1,H,W] 的最小通道张量
  const ranked = list
    .filter((t) => t.dims.length >= 2)
    .sort((a, b) => channelCount(a) - channelCount(b))
  const t = ranked[0] ?? list[0]
  return t
}

function channelCount(t: SerializedTensor): number {
  // NCHW：倒数第三维为通道；NHWC/2D 兜底
  if (t.dims.length === 4) return t.dims[1]
  if (t.dims.length === 3) return t.dims[0]
  return 1
}

/**
 * 将显著性张量转为单通道灰度 [0,255]。
 * 自动识别 logits（越界则先做 sigmoid），再 min-max 归一化。
 */
function saliencyToGray(t: SerializedTensor): { width: number; height: number; gray: Uint8Array } {
  const dims = t.dims
  let width: number
  let height: number
  let hwPlane: number
  if (dims.length === 4) {
    // NCHW：通道 0 为显著图
    height = dims[2]
    width = dims[3]
    hwPlane = height * width
  } else if (dims.length === 3) {
    height = dims[1]
    width = dims[2]
    hwPlane = height * width
  } else {
    height = dims[0]
    width = dims[1]
    hwPlane = height * width
  }

  const f32 = asFloat32(t)
  const plane = new Float32Array(hwPlane)
  for (let i = 0; i < hwPlane; i++) plane[i] = f32[i] // 通道 0

  // 判断是否 logits：存在越界值则做 sigmoid
  let needsSigmoid = false
  for (let i = 0; i < plane.length; i++) {
    if (plane[i] < -0.01 || plane[i] > 1.01) {
      needsSigmoid = true
      break
    }
  }
  if (needsSigmoid) {
    for (let i = 0; i < plane.length; i++) plane[i] = 1 / (1 + Math.exp(-plane[i]))
  }

  // min-max 归一化到 [0,255]
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < plane.length; i++) {
    if (plane[i] < min) min = plane[i]
    if (plane[i] > max) max = plane[i]
  }
  const span = max - min || 1
  const gray = new Uint8Array(hwPlane)
  for (let i = 0; i < hwPlane; i++) {
    gray[i] = Math.round(((plane[i] - min) / span) * 255)
  }
  return { width, height, gray }
}

/** 将 SerializedTensor 的 data 视图化为 Float32Array */
function asFloat32(t: SerializedTensor): Float32Array {
  const buf = t.data instanceof ArrayBuffer ? t.data : t.data.buffer
  if (t.dataType === 'float32') return new Float32Array(buf)
  // uint8 / int32 等：逐元素转 float
  const src =
    t.dataType === 'uint8'
      ? new Uint8Array(buf)
      : t.dataType === 'int32'
        ? new Int32Array(buf)
        : t.dataType === 'float64'
          ? new Float64Array(buf)
          : new Float32Array(buf)
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = Number(src[i])
  return out
}

/** 双线性重采样灰度图到目标尺寸 */
function resizeGray(
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
function compositeAlpha(
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

async function extractOne(
  sdk: LuukSdk,
  p: string,
  libraryId?: number,
  imageId?: number,
): Promise<{ path: string; editId: number }> {
  await sdk.progress.report(0, `抠图: ${p}`)
  const buf = await sdk.fs.read(p)

  // 预处理并推理
  await sdk.inference.createSession(MODEL_ID, '')
  const tensor = await sdk.image.normalize(buf, MODEL_SIZE)
  const outputs = await sdk.inference.run(MODEL_ID, { input: tensor }, { priority: 'batch' })
  await sdk.progress.report(55, '合成掩码')

  // 后处理：显著图 → 原尺寸 alpha
  const saliency = pickSaliency(outputs)
  const { width: mw, height: mh, gray } = saliencyToGray(saliency)
  const decoded = await sdk.image.decode(buf)
  const grayFull = resizeGray(gray, mw, mh, decoded.width, decoded.height)
  const rgba = compositeAlpha(decoded.data, decoded.channels, grayFull, decoded.width, decoded.height)
  const png = await sdk.image.encode(rgba, {
    width: decoded.width,
    height: decoded.height,
    channels: 4,
    format: 'png',
  })
  await sdk.progress.report(85, '写入编辑链')

  const editId = await sdk.edit.write({
    sourcePath: p,
    op: 'matting.extract',
    outputBuffer: png,
    libraryId,
    imageId,
    modelId: MODEL_ID,
    format: 'png',
  })
  return { path: p, editId }
}

export function activate(_luuk: LuukSdk): PluginInstance {
  return {
    isAvailable: () => true,
    executeOp: async (sdk, opId, rawInput) => {
      if (opId !== 'matting.extract') {
        throw new Error(`未知 op: ${opId}`)
      }
      const input = (rawInput ?? {}) as MattingInput
      const paths = input.paths ?? (input.path ? [input.path] : [])
      if (paths.length === 0) {
        return { results: [], skipped: true }
      }
      const results: Array<{ path: string; editId: number }> = []
      for (let i = 0; i < paths.length; i++) {
        const r = await extractOne(sdk, paths[i], input.libraryId, input.imageId)
        results.push(r)
        await sdk.progress.report(Math.round(((i + 1) / paths.length) * 100))
      }
      return { results }
    },
  }
}
