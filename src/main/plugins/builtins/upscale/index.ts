/**
 * AI 超分内置插件（upscale）
 *
 * 契约与 autotone / matting 一致：activate(luuk) → { executeOp }。
 * 大图防护：分块推理（TILE_SIZE=128 / TILE_OVERLAP=8，经 Task 0 R7 内存验证策略）。
 *   - 并发=1：每块经 sdk.inference.run 走会话池批处理队列
 *   - 边缘复制填充，输出按 stride 拼回，丢弃 overlap 冗余边界避免接缝累积
 */

import type { LuukSdk, PluginInstance } from '../../../../types/plugin'
import {
  buildTileTensor,
  pickOutput,
  mergeTile,
} from './post'

const MODEL_ID = 'realesrgan-x4plus'
const TILE_SIZE = 128
const TILE_OVERLAP = 8

/**
 * 输出像素预算上限（P0-2 防 OOM 熔断）。
 * 峰值内存 ≈ dst(N·4) + image.encode 入口 Buffer.from 复制(N·4) + PNG 输出(~0.4·N·4)，
 * N=输出像素数。40M 像素峰值 ≈ 380MB，对齐 R7 实测 Worker 500MB 红线保留 ~25% 余量；
 * 超过则抛可展示错误而非分配打爆 utilityProcess → MAX_CRASHES 熔断（需重启才恢复）。
 */
const MAX_OUT_PIXELS = 40_000_000

/** executeOp 输入负载 */
interface UpscaleInput {
  paths?: string[]
  path?: string
  libraryId?: number
  imageId?: number
  params?: { scale?: number }
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

  const sess = await sdk.inference.createSession(MODEL_ID, '')
  const inputName = sess.inputNames[0] ?? 'image'

  const outW = W * scale
  const outH = H * scale

  // P0-2：分配 dst 前校验输出像素预算，避免整幅 RGBA + encode 复制打爆 Worker 触发熔断
  const outPixels = outW * outH
  if (outPixels > MAX_OUT_PIXELS) {
    throw new Error(
      `输出过大(${outW}x${outH} ≈ ${Math.round(outPixels / 1_000_000)}M 像素)，超过安全预算 ${Math.round(MAX_OUT_PIXELS / 1_000_000)}M；请改用 2x 倍率或先缩放原图后重试`,
    )
  }

  // 兜底：预算内仍可能因内存碎片/并发分配失败 → 转业务错误而非崩溃
  let dst: Uint8Array
  try {
    dst = new Uint8Array(outW * outH * 4)
  } catch (err) {
    throw new Error(
      `内存不足，无法分配输出缓冲(${outW}x${outH})：${(err as Error).message}`,
    )
  }

  const stride = TILE_SIZE - TILE_OVERLAP
  const tilesX = Math.ceil(W / stride)
  const tilesY = Math.ceil(H / stride)
  const totalTiles = tilesX * tilesY
  let done = 0
  let scaleVerified = false

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
      // [P2-13] dst 缓冲已按请求 scale 分配；若模型实际倍率不符，拼贴会错位/溢出——首块即断并报错
      if (!scaleVerified) {
        if (Math.abs(realScale - scale) > 1e-6) {
          throw new Error(
            `模型实际倍率 ${realScale}x 与请求倍率 ${scale}x 不一致（${MODEL_ID} 为固定倍率模型）`,
          )
        }
        scaleVerified = true
      }
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
