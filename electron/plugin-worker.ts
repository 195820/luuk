/**
 * 插件宿主 Worker 入口
 * 运行在 Electron utilityProcess 中，通过 MessagePort RPC 与主进程通信
 */

import { parentPort } from 'worker_threads'
import type {
  MemoryStatus,
} from '../src/types/plugin'

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

// ── 类型守卫：判断消息是否为 RPC 请求 ──

interface RpcRequestMessage {
  type: 'rpc-request'
  id: number
  method: string
  params?: unknown
}

function isRpcRequest(msg: unknown): msg is RpcRequestMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as Record<string, unknown>).type === 'rpc-request'
  )
}

// ── RPC 处理器注册表 ──

type RpcHandler = (params?: unknown) => Promise<unknown>

const handlers = new Map<string, RpcHandler>()

function registerHandler(method: string, handler: RpcHandler): void {
  handlers.set(method, handler)
}

// ── 内存监控 ──

/** 黄色水位线（MB） */
const YELLOW_THRESHOLD_MB = 512
/** 红色水位线（MB） */
const RED_THRESHOLD_MB = 768

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
    threshold: {
      yellow: YELLOW_THRESHOLD_MB,
      red: RED_THRESHOLD_MB,
    },
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
  }
}

// ── 注册内置处理器 ──

// 内存相关
registerHandler('memory.getStatus', async () => getMemoryStatus())
registerHandler('memory.getStats', async () => getMemoryStats())

// 插件生命周期（占位实现）
registerHandler('plugin.load', async (params) => {
  const { pluginId, entryPath } = params as { pluginId: string; entryPath: string }
  // TODO: 实际加载插件 JS 沙箱
  return { pluginId, entryPath, loaded: true }
})

registerHandler('plugin.unload', async (params) => {
  const { pluginId } = params as { pluginId: string }
  // TODO: 实际卸载插件
  return { pluginId, unloaded: true }
})

registerHandler('plugin.execute', async (params) => {
  const { pluginId, opId } = params as {
    pluginId: string
    opId: string
    input: unknown
  }
  // TODO: 实际执行插件 Op
  return { pluginId, opId, output: null }
})

// 推理相关（占位实现）
registerHandler('inference.createSession', async (params) => {
  const { modelId, modelPath } = params as { modelId: string; modelPath: string }
  // TODO: 创建 ONNX 推理会话
  return { modelId, modelPath, sessionId: `session-${modelId}` }
})

registerHandler('inference.run', async (params) => {
  const { modelId, feeds } = params as {
    modelId: string
    feeds: Record<string, unknown>
  }
  // TODO: 执行推理
  return { modelId, feeds, results: {} }
})

registerHandler('inference.destroySession', async (params) => {
  const { modelId } = params as { modelId: string }
  // TODO: 销毁推理会话
  return { modelId, destroyed: true }
})

// ── 消息处理 ──

async function handleMessage(msg: unknown): Promise<void> {
  if (!isRpcRequest(msg)) return

  const { id, method, params } = msg
  const handler = handlers.get(method)

  const response: { id: number; result?: unknown; error?: { code: string; message: string } } = { id }

  if (!handler) {
    response.error = {
      code: 'METHOD_NOT_FOUND',
      message: `未知 RPC 方法: ${method}`,
    }
  } else {
    try {
      response.result = await handler(params)
    } catch (err) {
      response.error = {
        code: 'HANDLER_ERROR',
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  port?.postMessage({ type: 'rpc-response', ...response })
}

// ── 启动 ──

if (port) {
  port.on('message', (msg: unknown) => {
    // 异步处理，不阻塞消息接收
    handleMessage(msg).catch((err) => {
      console.error('[plugin-worker] 消息处理异常:', err)
    })
  })

  // 通知主进程 Worker 已就绪
  port.postMessage({ type: 'ready' })
} else {
  console.error('[plugin-worker] 端口不存在，无法在 utilityProcess/worker_threads 中运行')
  process.exit(1)
}
