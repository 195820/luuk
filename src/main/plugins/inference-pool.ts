/**
 * ONNX 推理会话池
 *
 * 运行于 utilityProcess（D2：onnxruntime 在 Worker 承载）。
 * - 会话复用：按 modelId 缓存，refCount 追踪在用数
 * - 执行模型：并发 = 1（单串行队列），双队列（交互式优先于批处理）
 * - EP 选择：默认 CPU，可选 directml / winml，创建失败回退 CPU
 * - 内存压力驱逐：红色水位时释放空闲会话
 */

import { createRequire } from 'module'
import os from 'os'

const require = createRequire(import.meta.url)
const ort = require('onnxruntime-node')

export type EpKind = 'cpu' | 'directml' | 'winml'

interface AcquireOptions {
  ep?: EpKind
  intraOpThreads?: number
  interOpThreads?: number
}

interface SessionEntry {
  session: any
  refCount: number
  lastUsedAt: number
  residentMB: number
  ep: EpKind
}

interface QueueTask {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  task: () => Promise<unknown>
}

export class InferencePool {
  private sessions = new Map<string, SessionEntry>()
  private interactiveQueue: QueueTask[] = []
  private batchQueue: QueueTask[] = []
  private running = false

  /** 获取（或创建）模型会话 */
  async acquire(modelId: string, modelPath: string, opts?: AcquireOptions): Promise<any> {
    const existing = this.sessions.get(modelId)
    if (existing) {
      existing.lastUsedAt = Date.now()
      return existing.session
    }

    const sessionOptions = {
      graphOptimizationLevel: 'all',
      executionMode: 'sequential',
      intraOpNumThreads: opts?.intraOpThreads ?? Math.max(1, os.cpus().length - 2),
      interOpNumThreads: opts?.interOpThreads ?? 1,
      // R7 实测：ORT CPU EP 的内存池（arena）会持续保留已释放内存，4K 推理峰值可达 550–600MB
      // （超 C6 500MB 红线）；关闭后分配即时归还，峰值降到 ~150–210MB。
      enableCpuMemArena: false,
    }

    const ep: EpKind = opts?.ep ?? 'cpu'
    let session: any
    let usedEp: EpKind = ep
    try {
      session = await ort.InferenceSession.create(modelPath, {
        ...sessionOptions,
        executionProviders: [ep],
      })
    } catch {
      // EP 不可用 → 回退 CPU
      session = await ort.InferenceSession.create(modelPath, {
        ...sessionOptions,
        executionProviders: ['cpu'],
      })
      usedEp = 'cpu'
    }

    this.sessions.set(modelId, {
      session,
      refCount: 0,
      lastUsedAt: Date.now(),
      residentMB: 0,
      ep: usedEp,
    })
    return session
  }

  /** 执行推理（并发 = 1，交互式插队） */
  run(
    modelId: string,
    feeds: Record<string, unknown>,
    priority: 'interactive' | 'batch' = 'batch',
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const task = async (): Promise<Record<string, unknown>> => {
        const entry = this.sessions.get(modelId)
        if (!entry) throw new Error(`Session 未找到: ${modelId}`)
        entry.lastUsedAt = Date.now()
        entry.refCount++
        try {
          return await entry.session.run(feeds)
        } finally {
          entry.refCount--
        }
      }

      const item: QueueTask = { resolve: resolve as (v: unknown) => void, reject, task }
      if (priority === 'interactive') {
        this.interactiveQueue.push(item)
      } else {
        this.batchQueue.push(item)
      }
      void this.tryExecute()
    })
  }

  private async tryExecute(): Promise<void> {
    if (this.running) return
    // 交互式队列优先于批处理队列
    const next = this.interactiveQueue.shift() ?? this.batchQueue.shift()
    if (!next) return

    this.running = true
    try {
      const result = await next.task()
      next.resolve(result)
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.running = false
      setImmediate(() => void this.tryExecute())
    }
  }

  /** 销毁单个会话 */
  async destroy(modelId: string): Promise<void> {
    const entry = this.sessions.get(modelId)
    if (!entry) return
    try {
      entry.session.release?.()
    } catch {
      /* 忽略释放异常 */
    }
    this.sessions.delete(modelId)
  }

  /** 红色水位线强制驱逐空闲会话 */
  evictOnMemoryPressure(): void {
    for (const [modelId, entry] of this.sessions) {
      if (entry.refCount === 0) {
        try {
          entry.session.release?.()
        } catch {
          /* 忽略 */
        }
        this.sessions.delete(modelId)
      }
    }
  }

  /** 会话统计（供 memory.getStats 上报） */
  stats(): Array<{ modelId: string; refCount: number; ep: EpKind; lastUsedAt: number }> {
    return Array.from(this.sessions.entries()).map(([modelId, e]) => ({
      modelId,
      refCount: e.refCount,
      ep: e.ep,
      lastUsedAt: e.lastUsedAt,
    }))
  }
}
