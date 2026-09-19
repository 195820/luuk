/**
 * 插件宿主进程管理器
 * 通过 Electron utilityProcess 启动 Worker，使用 MessagePort RPC 通信
 */

import { utilityProcess } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../../utils/logger'
import type {
  WorkerRpcResponse,
  WorkerToMainRequest,
  RpcError,
} from '../../types/plugin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Worker 启动超时时间（毫秒） */
const STARTUP_TIMEOUT_MS = 10_000
/** 反向 SDK 调用熔断前的最大崩溃次数 */
const MAX_CRASHES = 3

/** 待处理 RPC 请求的回调 */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

/** SDK 调用处理器（Worker → 主进程反向请求） */
export type SdkCallHandler = (req: WorkerToMainRequest) => Promise<unknown>

/** 将任意异常归一化为 RPC 错误负载 */
function toRpcError(err: unknown): RpcError {
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as { code?: string; message?: string; name?: string }
    return {
      code: e.code || e.name || 'EXECUTION_ERROR',
      message: e.message || String(err),
    }
  }
  return { code: 'EXECUTION_ERROR', message: err instanceof Error ? err.message : String(err) }
}

/**
 * 插件宿主进程
 * 管理 utilityProcess 生命周期，提供 RPC 调用接口
 */
export class PluginHostProcess {
  private worker: Electron.UtilityProcess | null = null
  private ready = false
  private requestId = 0
  private pendingRequests = new Map<number, PendingRequest>()
  private startPromise: Promise<void> | null = null
  /** 内存水位线阈值（MB），随 fork 下发给 Worker，与主进程保持一致 */
  private memoryThresholds: { yellowMB: number; redMB: number } = { yellowMB: 300, redMB: 400 }
  /** 反向 SDK 调用处理器 */
  private sdkCallHandler: SdkCallHandler | null = null
  /** 连续崩溃计数与熔断标记 */
  private crashCount = 0
  private circuitBroken = false
  /** 是否处于主动优雅关闭中（不计入崩溃计数） */
  private shutdownRequested = false
  /** 熔断回调（由 PluginManager 注册，用于停用全部插件） */
  onCircuitBreak: (() => void) | null = null
  /**
   * Worker 退出回调（崩溃/异常退出时触发，P1-6）：
   * 由 PluginManager 注册，用于清空 loadedInWorker 陈旧标记并重载启用中的插件。
   * 仅在 doStart 安装的常驻 exit 监听中触发（优雅 shutdown 不触发）。
   */
  onWorkerExit: ((code: number) => void) | null = null

  /** 配置内存水位线阈值（须在 ensureStarted 前调用，随 fork 下发） */
  setMemoryThresholds(yellowMB: number, redMB: number): void {
    this.memoryThresholds = { yellowMB, redMB }
  }

  /** 注册反向 SDK 调用处理器 */
  onSdkCall(handler: SdkCallHandler): void {
    this.sdkCallHandler = handler
  }

  /** 熔断状态查询 */
  isCircuitBroken(): boolean {
    return this.circuitBroken
  }

  /**
   * 懒启动 Worker（幂等）
   * 已启动则直接返回，启动中则复用 Promise
   */
  async ensureStarted(): Promise<void> {
    if (this.circuitBroken) {
      throw new Error('插件宿主已熔断（Worker 连续崩溃），请重启应用')
    }
    if (this.ready && this.worker) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.doStart()
    return this.startPromise
  }

  /**
   * 执行实际的 Worker 启动流程
   */
  private async doStart(): Promise<void> {
    // Worker 脚本路径：构建后为 dist-electron/plugin-worker.js
    const workerScriptPath = path.resolve(__dirname, 'plugin-worker.js')

    this.worker = utilityProcess.fork(workerScriptPath, [], {
      serviceName: 'luuk-plugin-worker',
      env: {
        ...process.env,
        LUUK_MEM_YELLOW_MB: String(this.memoryThresholds.yellowMB),
        LUUK_MEM_RED_MB: String(this.memoryThresholds.redMB),
      },
    })

    // 监听 Worker 就绪消息
    await this.waitForReady()

    // P1-11：捕获本次 Worker 引用，exit/message 回调仅在"仍是当前 Worker"时处理，
    // 避免旧 Worker 的延迟 exit 事件污染新启动的 Worker 实例（跨实例串扰）。
    const self = this.worker

    // 监听 RPC 响应
    self.on('message', (msg: unknown) => {
      if (this.worker !== self) return
      this.handleWorkerMessage(msg)
    })

    // 监听 Worker 崩溃
    self.on('exit', (code: number) => {
      if (this.worker !== self) return
      this.handleWorkerExit(code)
      // handleWorkerExit 已将 this.worker 置空；崩溃退出通知上层做自愈（P1-6）
      this.onWorkerExit?.(code)
    })
  }

  /**
   * 等待 Worker 发送 ready 消息
   * 超时 10 秒则拒绝并清理
   */
  private waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker 未初始化'))
        return
      }

      const timeout = setTimeout(() => {
        cleanup()
        // 超时 → 强制终止 Worker
        this.worker?.kill()
        this.worker = null
        this.startPromise = null
        reject(new Error(`Worker 启动超时（${STARTUP_TIMEOUT_MS}ms）`))
      }, STARTUP_TIMEOUT_MS)

      const onMessage = (msg: unknown) => {
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as Record<string, unknown>).type === 'ready'
        ) {
          cleanup()
          this.ready = true
          resolve()
        }
      }

      const onExit = (code: number) => {
        cleanup()
        this.worker = null
        this.startPromise = null
        reject(new Error(`Worker 在启动阶段退出，退出码: ${code}`))
      }

      const cleanup = () => {
        clearTimeout(timeout)
        this.worker?.off('message', onMessage)
        this.worker?.off('exit', onExit)
      }

      this.worker.on('message', onMessage)
      this.worker.on('exit', onExit)
    })
  }

  /**
   * 处理 Worker 发来的消息（双向）
   * - worker-to-main（sdk-request）：转发给反向 SDK 宿主
   * - rpc-response（main-to-worker）：路由到 pendingRequests
   */
  private handleWorkerMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as Record<string, unknown>

    // Worker 发来的 SDK 调用 → 异步交给注册的 handler，完成后回包
    if (m.type === 'sdk-request' || m.channel === 'worker-to-main') {
      const req = msg as WorkerToMainRequest
      if (!this.sdkCallHandler) {
        this.sendSdkResponse(req.id, {
          error: { code: 'EXECUTION_ERROR', message: 'SDK 宿主未就绪' },
        })
        return
      }
      void (async () => {
        try {
          const result = await this.sdkCallHandler!(req)
          this.sendSdkResponse(req.id, { result })
        } catch (err) {
          const rpcErr = toRpcError(err)
          this.sendSdkResponse(req.id, { error: rpcErr })
        }
      })()
      return
    }

    // 主进程发出的请求的响应 → 路由到 pendingRequests
    if (m.type === 'rpc-response') {
      const response = msg as WorkerRpcResponse
      const pending = this.pendingRequests.get(response.id)
      if (!pending) return

      this.pendingRequests.delete(response.id)

      if (response.error) {
        const err = new Error(response.error.message)
        err.name = response.error.code
        pending.reject(err)
      } else {
        pending.resolve(response.result)
      }
    }
  }

  /**
   * 向 Worker 回复一个 SDK 调用的结果
   */
  sendSdkResponse(id: number, payload: { result?: unknown; error?: RpcError }): void {
    if (!this.worker) return
    this.worker.postMessage({
      type: 'rpc-response',
      channel: 'worker-to-main',
      id,
      ...payload,
    })
  }

  /**
   * Worker 退出处理
   * - 拒绝所有待处理 RPC 请求
   * - 异常退出计入崩溃次数，达阈值则熔断并停止重启
   */
  private handleWorkerExit(code: number): void {
    const wasReady = this.ready
    this.ready = false
    this.worker = null
    this.startPromise = null

    // 拒绝所有待处理请求
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(
        new Error(
          wasReady
            ? `Worker 已退出（退出码: ${code}），请求 ${id} 未完成`
            : `Worker 异常退出（退出码: ${code}）`
        )
      )
    }
    this.pendingRequests.clear()

    // 优雅关闭（主动 kill）不计入崩溃；仅非零退出码或运行中异常退出计数
    const graceful = this.shutdownRequested
    this.shutdownRequested = false
    if (!graceful && (code !== 0 || wasReady)) {
      this.crashCount++
      logger.warn('PluginHostProcess', `Worker 异常退出（次数 ${this.crashCount}，退出码 ${code}）`)
      if (this.crashCount >= MAX_CRASHES) {
        this.circuitBroken = true
        logger.error('PluginHostProcess', `Worker 连续崩溃 ${this.crashCount} 次，停止重启并触发熔断`)
        this.onCircuitBreak?.()
      }
    }
  }

  /**
   * 发起 RPC 调用
   * @param method 方法名
   * @param params 参数
   * @returns Worker 处理结果
   */
  async rpc<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureStarted()

    if (!this.worker || !this.ready) {
      throw new Error('Worker 未就绪')
    }

    const id = ++this.requestId

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })

      this.worker!.postMessage({
        type: 'rpc-request',
        channel: 'main-to-worker',
        id,
        method,
        params,
      })
    })
  }

  /**
   * 检查 Worker 是否就绪
   */
  isReady(): boolean {
    return this.ready && this.worker !== null
  }

  /**
   * 优雅关闭 Worker
   * 发送关闭信号并等待退出
   */
  async shutdown(): Promise<void> {
    if (!this.worker) return

    // P1-11：先移除 doStart 安装的常驻 exit/message 监听，避免优雅关闭误触崩溃计数 / onWorkerExit 自愈
    const self = this.worker
    self.removeAllListeners('exit')
    self.removeAllListeners('message')

    // 标记为优雅关闭，退出事件不计入崩溃
    this.shutdownRequested = true

    // 拒绝所有待处理请求
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Worker 正在关闭'))
    }
    this.pendingRequests.clear()

    const exitPromise = new Promise<void>((resolve) => {
      self.once('exit', () => resolve())
    })

    self.kill()
    this.ready = false
    this.worker = null
    this.startPromise = null

    // 等待退出事件（最多 1 秒；退出清理路径不能被 worker 拖住，主进程侧另有超时兑底）
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 1000)),
    ])
  }
}
