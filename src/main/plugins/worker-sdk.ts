/**
 * Worker 侧 luuk.* SDK 代理
 *
 * 为运行在 utilityProcess 中的插件构造 `luuk` 命名空间：
 * - library / fs / jobs / edit / progress / log / settings：经反向 RPC 转发到主进程
 * - image：使用 sharp 在 Worker 本地执行（避免跨进程传大图）
 * - inference：onnxruntime 运行在 utilityProcess（D2），使用本地 InferencePool；
 *   模型路径解析经反向 RPC 由主进程 ModelManager 提供
 */

import { createRequire } from 'module'
import type {
  LuukSdk,
  SerializedTensor,
  SerializedTensorMap,
} from '../../types/plugin'
import type { InferencePool } from './inference-pool'

const require = createRequire(import.meta.url)

/** 反向 RPC 调用函数签名 */
export type CallMainFn = (method: string, params: unknown) => Promise<unknown>

/** Phase 8 占位 API 调用时抛出的错误 */
class NotImplemented extends Error {
  constructor(api: string) {
    super(`luuk.${api} 在当前 Phase 未实现`)
    this.name = 'NOT_IMPLEMENTED'
  }
}

/**
 * 为指定插件创建 luuk.* SDK 实例。
 * @param pluginId 插件 id（随每次反向调用附带，供主进程做权限校验）
 * @param callMain 反向 RPC：Worker → 主进程
 * @param pool Worker 本地推理池（inference.* 使用）
 */
export function createPluginSdk(
  pluginId: string,
  callMain: CallMainFn,
  pool: InferencePool,
): LuukSdk {
  return {
    library: {
      query: (opts) => callMain('sdk.library.query', opts) as Promise<unknown>,
      writeEmbedding: (opts) => callMain('sdk.library.writeEmbedding', opts) as Promise<unknown>,
    },
    fs: {
      read: async (path) => {
        const buf = await callMain('sdk.fs.read', { path }) as Uint8Array
        return buf
      },
      write: (path, data) => callMain('sdk.fs.write', { path, data }) as Promise<void>,
    },
    inference: {
      createSession: async (modelId, modelPath, opts) => {
        // 路径解析经主进程（含下载校验），随后在 Worker 本地建立 ONNX 会话。
        // 插件通常只知 modelId，传空 modelPath 由主进程 ModelManager 解析本地路径。
        const resolved =
          (modelPath && modelPath.trim()) ||
          ((await callMain('sdk.inference.resolveModel', { modelId })) as string)
        const session = await pool.acquire(modelId, resolved, opts as never)
        return { modelId, modelPath: resolved, created: true, ...(session ? {} : {}) }
      },
      run: async (modelId, feeds, opts) => {
        const deserialized = deserializeTensors(feeds)
        const outputs = await pool.run(modelId, deserialized, opts?.priority ?? 'batch')
        return serializeTensors(outputs)
      },
      destroySession: (modelId) => pool.destroy(modelId) as Promise<void>,
    },
    image: {
      decode: async (buf) => {
        const sharp = require('sharp')
        const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
        return {
          width: info.width,
          height: info.height,
          channels: info.channels,
          data: new Uint8Array(data),
        }
      },
      encode: async (data, opts) => {
        const sharp = require('sharp')
        const pipeline = sharp(Buffer.from(data), {
          raw: { width: opts.width, height: opts.height, channels: opts.channels },
        })
        const format = opts.format ?? 'png'
        const out =
          format === 'jpeg'
            ? pipeline.jpeg({ quality: opts.quality ?? 90 })
            : format === 'webp'
              ? pipeline.webp({ quality: opts.quality ?? 90 })
              : pipeline.png()
        const buf = await out.toBuffer()
        return new Uint8Array(buf)
      },
      normalize: async (buf, size) => {
        // 缩放到目标尺寸 → 归一化到 [0,1] float32 NCHW（常见 ONNX 预处理）
        const sharp = require('sharp')
        const { data, info } = await sharp(buf)
          .resize(size.width, size.height, { fit: 'fill' })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        const c = info.channels
        const plane = size.width * size.height
        const float = new Float32Array(c * plane)
        for (let ch = 0; ch < c; ch++) {
          for (let i = 0; i < plane; i++) {
            float[ch * plane + i] = data[i * c + ch] / 255
          }
        }
        return {
          dataType: 'float32',
          dims: [1, c, size.height, size.width],
          data: float.buffer,
        } satisfies SerializedTensor
      },
    },
    jobs: {
      enqueue: (kind, payload, opts) =>
        callMain('sdk.jobs.enqueue', { kind, payload, opts }) as Promise<string>,
    },
    edit: {
      write: (params) =>
        callMain('sdk.edit.write', { pluginId, ...params }) as Promise<number>,
    },
    progress: {
      report: (pct, message) => callMain('sdk.progress.report', { pct, message }) as Promise<void>,
    },
    log: {
      info: (msg) => callMain('sdk.log.info', { msg }) as Promise<void>,
      warn: (msg) => callMain('sdk.log.warn', { msg }) as Promise<void>,
      error: (msg) => callMain('sdk.log.error', { msg }) as Promise<void>,
    },
    settings: {
      get: (key) => callMain('sdk.settings.get', { key }) as Promise<unknown>,
      set: (key, value) => callMain('sdk.settings.set', { key, value }) as Promise<void>,
    },
    // Phase 8 占位：调用即抛 NOT_IMPLEMENTED
    browser: {
      navigate: () => {
        throw new NotImplemented('browser')
      },
    },
    fetch: {
      request: () => {
        throw new NotImplemented('fetch')
      },
    },
    mask: {
      request: () => {
        throw new NotImplemented('mask')
      },
    },
  }
}

// ── 张量序列化 ──

/** 将可跨进程传输的 SerializedTensorMap 反序列化为 ort.Tensor 描述 */
export function deserializeTensors(map: SerializedTensorMap): Record<string, unknown> {
  const ort = require('onnxruntime-node')
  const out: Record<string, unknown> = {}
  for (const [name, t] of Object.entries(map)) {
    const TypedArray = tensorArrayFor(t.dataType)
    const view = new TypedArray(
      t.data instanceof ArrayBuffer ? t.data : t.data.buffer,
      t.data instanceof ArrayBuffer ? 0 : t.data.byteOffset,
      (t.data instanceof ArrayBuffer ? t.data.byteLength : t.data.byteLength) / bytesPerElement(t.dataType),
    )
    out[name] = new ort.Tensor(t.dataType, view, t.dims)
  }
  return out
}

/** 将 ort.Tensor 输出映射序列化为可传输结构 */
export function serializeTensors(result: Record<string, unknown>): SerializedTensorMap {
  const out: SerializedTensorMap = {}
  for (const [name, tensor] of Object.entries(result)) {
    const t = tensor as { type: string; dims: readonly number[]; data: ArrayBufferView }
    out[name] = {
      dataType: t.type as SerializedTensor['dataType'],
      dims: Array.from(t.dims),
      // 序列化时保留底层 TypedArray（structuredClone 可直接搬运，接收侧按 dataType 重建）
      data: t.data as unknown as Uint8Array,
    }
  }
  return out
}

function tensorArrayFor(dataType: string): any {
  switch (dataType) {
    case 'int64':
      return BigInt64Array
    case 'int32':
      return Int32Array
    case 'uint8':
      return Uint8Array
    case 'float64':
      return Float64Array
    default:
      return Float32Array
  }
}

function bytesPerElement(dataType: string): number {
  switch (dataType) {
    case 'int64':
    case 'float64':
      return 8
    case 'int32':
      return 4
    case 'uint8':
      return 1
    default:
      return 4
  }
}
