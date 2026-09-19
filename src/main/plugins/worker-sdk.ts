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

/** 反向 RPC 调用函数签名（P1-5：pluginId 显式透传，不再依赖 Worker 全局上下文） */
export type CallMainFn = (method: string, params: unknown, pluginId: string) => Promise<unknown>

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
  rawCallMain: CallMainFn,
  pool: InferencePool,
): LuukSdk {
  // P1-5：以闭包持有自身 pluginId，每次反向调用显式透传，消除全局 activePluginId 串位
  const call = (method: string, params: unknown): Promise<unknown> => rawCallMain(method, params, pluginId)
  // P2-12：本插件已合法建立会话的 modelId 集合。run/destroy 仅限本集合内，
  // 因 createSession 必经 resolveModel（主进程要求 inference 权限），故 run 传递性受权限门约束，
  // 并防止无 inference 权限的插件借用他插件已建会话跨插件跑推理。
  const ownedModels = new Set<string>()
  return {
    library: {
      query: (opts) => call('sdk.library.query', opts) as Promise<unknown>,
      writeEmbedding: (opts) => call('sdk.library.writeEmbedding', opts) as Promise<unknown>,
    },
    fs: {
      read: async (path) => {
        const buf = await call('sdk.fs.read', { path }) as Uint8Array
        return buf
      },
      write: (path, data) => call('sdk.fs.write', { path, data }) as Promise<void>,
    },
    inference: {
      createSession: async (modelId, _modelPath, opts) => {
        // P2-12：忽略插件传入的 modelPath（防越权加载任意 .onnx），
        // 仅接受主进程 sdk.inference.resolveModel 返回的权威本地路径（含下载/SHA256 校验与 inference 权限门）。
        const resolved = (await call('sdk.inference.resolveModel', { modelId })) as string
        const session = await pool.acquire(modelId, resolved, opts as never, pluginId)
        ownedModels.add(modelId)
        // 透传模型真实输入/输出张量名：不同导出（如 u2netp 的 `input.1`）名称各异，
        // 插件须按 inputNames 构造 feeds，避免写死 `input` / `image` 导致推理失败。
        return {
          modelId,
          modelPath: resolved,
          created: true,
          inputNames: (session?.inputNames ?? []) as string[],
          outputNames: (session?.outputNames ?? []) as string[],
        }
      },
      run: async (modelId, feeds, opts) => {
        // P2-12：未在本插件 createSession 建立的模型不得直接推理
        if (!ownedModels.has(modelId)) {
          throw new Error(`推理未授权：模型 ${modelId} 未经本插件 createSession 建立（缺 inference 权限或越权复用）`)
        }
        const deserialized = deserializeTensors(feeds)
        const outputs = await pool.run(modelId, deserialized, opts?.priority ?? 'batch')
        return serializeTensors(outputs)
      },
      destroySession: (modelId) => {
        ownedModels.delete(modelId)
        return pool.destroy(modelId) as Promise<void>
      },
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
        call('sdk.jobs.enqueue', { kind, payload, opts }) as Promise<string>,
    },
    edit: {
      write: (params) =>
        call('sdk.edit.write', params) as Promise<number>,
    },
    progress: {
      report: (pct, message) => call('sdk.progress.report', { pct, message }) as Promise<void>,
    },
    log: {
      info: (msg) => call('sdk.log.info', { msg }) as Promise<void>,
      warn: (msg) => call('sdk.log.warn', { msg }) as Promise<void>,
      error: (msg) => call('sdk.log.error', { msg }) as Promise<void>,
    },
    settings: {
      get: (key) => call('sdk.settings.get', { key }) as Promise<unknown>,
      set: (key, value) => call('sdk.settings.set', { key, value }) as Promise<void>,
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

/**
 * 反向 SDK 调用的分级超时（毫秒）（P1-7）。
 *
 * 旧实现对所有方法统一 5s，导致大图 fs.write / edit.write（携带数 MB~数十 MB buffer）
 * 与 resolveModel（可能对大 .onnx 做流式 SHA256 校验）必然误超时。按方法分级：
 * - 读文件：60s
 * - 写文件 / 编辑写入：60s 基线 + 每 10MB 追加 5s（按 payload 字节动态），上限 300s
 * - 模型解析（可能校验）：30s
 * - 其余（progress/log/settings 等轻量）：5s
 *
 * 纯函数，不依赖 electron / onnxruntime，供 plugin-worker.callMain 使用并单独可测。
 */
export function resolveSdkTimeoutMs(method: string, params: unknown): number {
  const bytes = payloadByteLength(params)
  switch (method) {
    case 'sdk.fs.read':
      return 60_000
    case 'sdk.fs.write':
    case 'sdk.edit.write':
      return Math.min(300_000, 60_000 + Math.ceil(bytes / (10 * 1024 * 1024)) * 5_000)
    case 'sdk.inference.resolveModel':
      return 30_000
    default:
      return 5_000
  }
}

/** 从 SDK 参数中粗略提取携带的字节负载大小（data / outputBuffer），无则 0 */
function payloadByteLength(params: unknown): number {
  if (!params || typeof params !== 'object') return 0
  const p = params as Record<string, unknown>
  const cand = p.outputBuffer ?? p.data
  if (!cand) return 0
  if (typeof (cand as { byteLength?: number }).byteLength === 'number') {
    return (cand as { byteLength: number }).byteLength
  }
  if (typeof (cand as { length?: number }).length === 'number') {
    return (cand as { length: number }).length
  }
  return 0
}
