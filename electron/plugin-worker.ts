/**
 * 插件宿主 Worker 入口
 * 运行在 Electron utilityProcess 中，通过 MessagePort RPC 与主进程双向通信。
 *
 * 职责：
 * - 承载插件 JS 沙箱（require 编译后的 CJS 入口），提供 luuk.* SDK
 * - 承载 ONNX 推理（InferencePool，D2：onnxruntime 运行在 utilityProcess）
 * - image.* 使用 sharp 在本地执行（避免跨进程传大图）
 * - library/fs/jobs/edit/... 经反向 RPC（callMain）转发到主进程 SDK 宿主
 */

import { createRequire } from 'module'
import { parentPort } from 'worker_threads'
import { InferencePool } from '../src/main/plugins/inference-pool'
import { createPluginSdk } from '../src/main/plugins/worker-sdk'
import type {
  MemoryStatus,
  LuukSdk,
  PluginInstance,
  MainToWorkerRequest,
  RpcResponse,
  RpcError,
} from '../src/types/plugin'

const require = createRequire(import.meta.url)

// ── 通信端口 ──
// 本 Worker 由 plugin-host-process 以 utilityProcess 方式启动，通信走
// `process.parentPort`（Electron 注入），此时 worker_threads 的 parentPort 为 null。
// 这里同时兼容两种宿主：优先 utilityProcess，退化为 worker_threads。

interface ParentPortLike {
  on(event: 'message', listener: (message: unknown) => void): unknown
  postMessage(message: unknown): void
}

function getPort(): ParentPortLike | null {
  const proc = process as NodeJS.Process & { parentPort?: ParentPortLike }
  if (proc.parentPort) return proc.parentPort
  if (parentPort) return parentPort as unknown as ParentPortLike
  return null
}

const port = getPort()

// ── 内存水位线阈值（由主进程经 fork env 下发，保持与主进程一致） ──

const YELLOW_THRESHOLD_MB = Number(process.env.LUUK_MEM_YELLOW_MB ?? 300)
const RED_THRESHOLD_MB = Number(process.env.LUUK_MEM_RED_MB ?? 400)

// ── 反向 RPC（Worker → 主进程）──

/** 单次反向调用超时（毫秒） */
const SDK_CALL_TIMEOUT_MS = 5000
/** 最大并发在途反向调用（消息风暴防护） */
const MAX_INFLIGHT = 20

let sdkCallId = 0
const sdkPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function callMain(method: string, params: unknown, pluginId: string): Promise<unknown> {
  // P1-5/S3：硬断言 pluginId，禁止裸调用（只能由 createPluginSdk 闭包传入真实 id）
  if (!pluginId) {
    return Promise.reject(new Error(`callMain 缺少 pluginId：${method}`))
  }
  return new Promise((resolve, reject) => {
    if (sdkPending.size >= MAX_INFLIGHT) {
      reject(new Error(`反向 SDK 调用在途过多（>${MAX_INFLIGHT}），请稍后重试`))
      return
    }
    const id = ++sdkCallId
    const timer = setTimeout(() => {
      sdkPending.delete(id)
      reject(new Error(`SDK 调用超时: ${method}`))
    }, SDK_CALL_TIMEOUT_MS)
    sdkPending.set(id, { resolve, reject, timer })
    port?.postMessage({ type: 'sdk-request', channel: 'worker-to-main', id, method, pluginId, params })
  })
}

// ── 正向 RPC 处理器（主进程 → Worker）──

type RpcHandler = (params?: unknown) => Promise<unknown>
const handlers = new Map<string, RpcHandler>()

function registerHandler(method: string, handler: RpcHandler): void {
  handlers.set(method, handler)
}

// ── 已加载插件实例 ──

const loadedPlugins = new Map<string, { instance: PluginInstance; sdk: LuukSdk }>()
const inferencePool = new InferencePool()

// ── 内存监控 ──

/**
 * 本 Worker 进程自身 RSS（口径=单进程 process.memoryUsage().rss）。
 * 阈值经主进程 fork env（LUUK_MEM_YELLOW_MB/RED_MB）下发，与主进程聚合口径同源常量。
 * 注：这是“本进程”口径，主进程另有“全应用聚合”口径（app.getAppMetrics 求和）；
 * AI 执行硬闸门的“聚合 red || Worker red”判定在主进程侧完成（见 plugin-manager.executeOp），
 * 本方法仅供展示/诊断，二者标注来源以免混用（P0-3）。
 */
function getMemoryStatus(): MemoryStatus {
  const mem = process.memoryUsage()
  const rssMB = Math.round(mem.rss / 1024 / 1024)

  let level: 'green' | 'yellow' | 'red' = 'green'
  if (rssMB >= RED_THRESHOLD_MB) {
    level = 'red'
  } else if (rssMB >= YELLOW_THRESHOLD_MB) {
    level = 'yellow'
  }

  return {
    level,
    rssMB,
    threshold: { yellow: YELLOW_THRESHOLD_MB, red: RED_THRESHOLD_MB },
  }
}

function getMemoryStats() {
  const mem = process.memoryUsage()
  return {
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    sessions: inferencePool.stats(),
  }
}

// ── 注册内置处理器 ──

registerHandler('memory.getStatus', async () => getMemoryStatus())
registerHandler('memory.getStats', async () => getMemoryStats())
registerHandler('memory.evict', async () => {
  inferencePool.evictOnMemoryPressure()
  return { evicted: true }
})

registerHandler('plugin.load', async (params) => {
  const { pluginId, entryPath } = params as { pluginId: string; entryPath: string }
  const sdk = createPluginSdk(pluginId, callMain, inferencePool)
  const mod = require(entryPath)
  const instance: PluginInstance =
    typeof mod.activate === 'function' ? mod.activate(sdk) : (mod.default ?? mod)
  loadedPlugins.set(pluginId, { instance, sdk })
  return { pluginId, entryPath, loaded: true }
})

registerHandler('plugin.unload', async (params) => {
  const { pluginId } = params as { pluginId: string }
  const entry = loadedPlugins.get(pluginId)
  try {
    await entry?.instance.deactivate?.()
  } catch {
    /* 忽略卸载异常 */
  }
  loadedPlugins.delete(pluginId)
  return { pluginId, unloaded: true }
})

registerHandler('plugin.execute', async (params) => {
  const { pluginId, opId, input } = params as {
    pluginId: string
    opId: string
    input: unknown
  }
  const entry = loadedPlugins.get(pluginId)
  if (!entry) throw new Error(`插件未加载: ${pluginId}`)
  if (typeof entry.instance.executeOp !== 'function') {
    throw new Error(`插件 ${pluginId} 未实现 executeOp`)
  }
  // P1-5：不再设置全局 activePluginId；SDK 实例由 createPluginSdk(pluginId,…) 闭包携带自身 id，
  // 反向调用逐次显式透传，并发 execute 不再串位。
  return await entry.instance.executeOp(entry.sdk, opId, input)
})

// ── 消息处理 ──

function toRpcError(err: unknown): RpcError {
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as { code?: string; message?: string; name?: string }
    return { code: e.code || e.name || 'EXECUTION_ERROR', message: e.message || String(err) }
  }
  return { code: 'EXECUTION_ERROR', message: err instanceof Error ? err.message : String(err) }
}

async function handleRpcRequest(msg: MainToWorkerRequest): Promise<void> {
  const { id, method, params } = msg
  const handler = handlers.get(method)
  const response: RpcResponse = { type: 'rpc-response', channel: 'main-to-worker', id }

  if (!handler) {
    response.error = { code: 'METHOD_NOT_FOUND', message: `未知 RPC 方法: ${method}` }
  } else {
    try {
      response.result = await handler(params)
    } catch (err) {
      response.error = toRpcError(err)
    }
  }
  port?.postMessage(response)
}

function handleSdkResponse(msg: RpcResponse): void {
  const p = sdkPending.get(msg.id)
  if (!p) return
  clearTimeout(p.timer)
  sdkPending.delete(msg.id)
  if (msg.error) {
    const err = new Error(msg.error.message)
    err.name = msg.error.code
    p.reject(err)
  } else {
    p.resolve(msg.result)
  }
}

function handleMessage(msg: unknown): void {
  if (typeof msg !== 'object' || msg === null) return
  const m = msg as Record<string, unknown>

  // 主进程发来的正向请求
  if (m.type === 'rpc-request' && m.channel === 'main-to-worker') {
    void handleRpcRequest(msg as MainToWorkerRequest).catch((err) => {
      console.error('[plugin-worker] RPC 处理异常:', err)
    })
    return
  }

  // 主进程对我们反向 SDK 调用的回包
  if (m.type === 'rpc-response' && m.channel === 'worker-to-main') {
    handleSdkResponse(msg as RpcResponse)
    return
  }
}

// ── 启动 ──

if (port) {
  port.on('message', (msg: unknown) => {
    try {
      handleMessage(msg)
    } catch (err) {
      console.error('[plugin-worker] 消息处理异常:', err)
    }
  })

  // 通知主进程 Worker 已就绪
  port.postMessage({ type: 'ready' })
} else {
  console.error('[plugin-worker] 端口不存在，无法在 utilityProcess/worker_threads 中运行')
  process.exit(1)
}
