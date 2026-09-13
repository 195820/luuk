/**
 * 插件宿主进程管理器
 * 通过 Electron utilityProcess 启动 Worker，使用 MessagePort RPC 通信
 */

import { utilityProcess } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import type { WorkerRpcResponse } from '../../types/plugin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Worker 启动超时时间（毫秒） */
const STARTUP_TIMEOUT_MS = 10_000

/** 待处理 RPC 请求的回调 */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
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

  /**
   * 懒启动 Worker（幂等）
   * 已启动则直接返回，启动中则复用 Promise
   */
  async ensureStarted(): Promise<void> {
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
    })

    // 监听 Worker 就绪消息
    await this.waitForReady()

    // 监听 RPC 响应
    this.worker.on('message', (msg: unknown) => {
      this.handleWorkerMessage(msg)
    })

    // 监听 Worker 崩溃
    this.worker.on('exit', (code: number) => {
      this.handleWorkerExit(code)
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
   * 处理 Worker 发来的消息
   * 仅处理 rpc-response 类型
   */
  private handleWorkerMessage(msg: unknown): void {
    if (
      typeof msg !== 'object' ||
      msg === null ||
      (msg as Record<string, unknown>).type !== 'rpc-response'
    ) {
      return
    }

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

  /**
   * Worker 退出处理
   * 拒绝所有待处理的 RPC 请求
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

    // 拒绝所有待处理请求
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Worker 正在关闭'))
    }
    this.pendingRequests.clear()

    const exitPromise = new Promise<void>((resolve) => {
      if (!this.worker) {
        resolve()
        return
      }
      this.worker.once('exit', () => resolve())
    })

    this.worker.kill()
    this.ready = false
    this.worker = null
    this.startPromise = null

    // 等待退出事件（最多 5 秒）
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ])
  }
}
