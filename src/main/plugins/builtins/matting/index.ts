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

import type { LuukSdk, PluginInstance } from '../../../../types/plugin'
import {
  pickSaliency,
  saliencyToGray,
  resizeGray,
  compositeAlpha,
} from './post'

const MODEL_ID = 'u2netp'
const MODEL_SIZE = { width: 320, height: 320 }

/** executeOp 输入负载 */
interface MattingInput {
  paths?: string[]
  path?: string
  libraryId?: number
  imageId?: number
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
  const sess = await sdk.inference.createSession(MODEL_ID, '')
  const inputName = sess.inputNames[0] ?? 'input'
  const tensor = await sdk.image.normalize(buf, MODEL_SIZE)
  const outputs = await sdk.inference.run(MODEL_ID, { [inputName]: tensor }, { priority: 'batch' })
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
