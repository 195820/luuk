/**
 * AI 超分内置插件（upscale）
 *
 * 契约与 autotone / matting 一致：activate(luuk) → { executeOp }。
 * 大图防护：分块推理（TILE_SIZE=128 / TILE_OVERLAP=8，经 Task 0 R7 内存验证策略）。
 *   - 并发=1：每块经 sdk.inference.run 走会话池批处理队列
 *   - 边缘复制填充，输出按 stride 拼回，丢弃 overlap 冗余边界避免接缝累积
 */

import type { LuukSdk, PluginInstance, SerializedTensor } from '../../../../types/plugin'

const MODEL_ID = 'realesrgan-x4plus'
const TILE_SIZE = 128
const TILE_OVERLAP = 8

/** executeOp 输入负载 */
interface UpscaleInput {
  paths?: string[]
  path?: string
  libraryId?: number
  imageId?: number
  params?: { scale?: number }
}

/** 从解码像素 (RGB raw) 构建 NCHW float32 张量（[0,1]），边缘复制填充到 T×T */
function buildTileTensor(
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
function pickOutput(outputs: Record<string, SerializedTensor>): SerializedTensor {
  const list = Object.values(outputs).filter((t) => t.dims.length === 4)
  const t = list[0] ?? Object.values(outputs)[0]
  if (!t) throw new Error('超分模型无输出张量')
  return t
}

/** 将输出张量按 tile 内部 [0, dy*SCALE)×[0, dx*SCALE) 区域拼接回全尺寸 RGBA 缓冲 */
function mergeTile(
  out: SerializedTensor,
  dst: Uint8Array,
  dstW: number,
  dx: number,
  dy: number,
  destX: number,
  destY: number,
): void {
  const buf = out.data instanceof ArrayBuffer ? out.data : out.data.buffer
  const oH = out.dims[2]
  const oW = out.dims[3]
  const plane = oH * oW
  const isFloat = out.dataType === 'float32' || out.dataType === 'float64'
  const f32 = isFloat ? new Float32Array(buf as ArrayBuffer) : null
  const u8 = !isFloat ? new Uint8Array(buf as ArrayBuffer) : null

  const copyW = Math.min(dx, oW)
  const copyH = Math.min(dy, oH)

  for (let j = 0; j < copyH; j++) {
    for (let i = 0; i < copyW; i++) {
      const s = j * oW + i
      let r: number
      let g: number
      let b: number
      if (f32) {
        // float 输出可能是 [0,1] 或 [0,255]，按首个像素判定量纲
        const maxed = f32[0] <= 1.001
        r = f32[s] * (maxed ? 255 : 1)
        g = f32[plane + s] * (maxed ? 255 : 1)
        b = f32[2 * plane + s] * (maxed ? 255 : 1)
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

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)))
}

async function upscaleOne(
  sdk: LuukSdk,
  p: string,
  scale: number,
  libraryId?: number,
  imageId?: number,
): Promise<{ path: string; editId: number }> {
  await sdk.progress.report(0, `超分: ${p}`)
  const buf = await sdk.fs.read(p)
  const decoded = await sdk.image.decode(buf)
  const { width: W, height: H, channels: c, data } = decoded
  const srcC = Math.min(c, 3)

  const sess = await sdk.inference.createSession(MODEL_ID, '')
  const inputName = sess.inputNames[0] ?? 'image'

  const outW = W * scale
  const outH = H * scale
  const dst = new Uint8Array(outW * outH * 4)

  const stride = TILE_SIZE - TILE_OVERLAP
  const tilesX = Math.ceil(W / stride)
  const tilesY = Math.ceil(H / stride)
  const totalTiles = tilesX * tilesY
  let done = 0

  for (let ty = 0; ty < H; ty += stride) {
    for (let tx = 0; tx < W; tx += stride) {
      const tensor = buildTileTensor(data, c, W, H, tx, ty, TILE_SIZE)
      const outputs = await sdk.inference.run(
        MODEL_ID,
        { [inputName]: tensor },
        { priority: 'batch' },
      )
      const outTile = pickOutput(outputs)
      // 推导实际放大倍率（模型固定倍率）
      const realScale = outTile.dims[3] / TILE_SIZE
      const dx = Math.min(stride, W - tx)
      const dy = Math.min(stride, H - ty)
      mergeTile(outTile, dst, outW, dx * realScale, dy * realScale, tx * scale, ty * scale)
      done++
      await sdk.progress.report(Math.round((done / totalTiles) * 90), `块 ${done}/${totalTiles}`)
    }
  }

  const png = await sdk.image.encode(dst, {
    width: outW,
    height: outH,
    channels: 4,
    format: 'png',
  })
  await sdk.progress.report(95, '写入编辑链')
  const editId = await sdk.edit.write({
    sourcePath: p,
    op: 'upscale.x4',
    outputBuffer: png,
    libraryId,
    imageId,
    modelId: MODEL_ID,
    params: { scale },
    format: 'png',
  })
  void srcC
  return { path: p, editId }
}

export function activate(_luuk: LuukSdk): PluginInstance {
  return {
    isAvailable: () => true,
    executeOp: async (sdk, opId, rawInput) => {
      if (opId !== 'upscale.x4') {
        throw new Error(`未知 op: ${opId}`)
      }
      const input = (rawInput ?? {}) as UpscaleInput
      const scale = input.params?.scale ?? 4
      const paths = input.paths ?? (input.path ? [input.path] : [])
      if (paths.length === 0) {
        return { results: [], skipped: true }
      }
      const results: Array<{ path: string; editId: number }> = []
      for (const p of paths) {
        results.push(await upscaleOne(sdk, p, scale, input.libraryId, input.imageId))
      }
      return { results }
    },
  }
}
