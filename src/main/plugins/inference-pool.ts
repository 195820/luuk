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

/**
 * 会话创建工厂（依赖注入缝）：(modelPath, options) → session。
 * 默认惰性 require onnxruntime-node；测试可注入假工厂以在不加载原生 ORT 的情况下验证锁/LRU 逻辑。
 */
export type SessionFactory = (modelPath: string, options: Record<string, unknown>) => Promise<any>

function defaultSessionFactory(): SessionFactory {
  const ort = require('onnxruntime-node')
  return (modelPath, options) => ort.InferenceSession.create(modelPath, options)
}

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
  ep: EpKind
  /** 创建该会话的插件 id（P1-10：plugin.unload 时按此销毁）*/
  ownerPluginId: string | null
}

interface QueueTask {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  task: () => Promise<unknown>
}

/** 默认最大常驻会话数（超出按 LRU 驱逐空闲会话）*/
const DEFAULT_MAX_SESSIONS = 4

export class InferencePool {
  private sessions = new Map<string, SessionEntry>()
  /** P1-10：同名 modelId 的并发 acquire 共享同一创建 Promise，避免双建会话 */
  private creating = new Map<string, Promise<any>>()
  private interactiveQueue: QueueTask[] = []
  private batchQueue: QueueTask[] = []
  private running = false
  private maxSessions: number
  private sessionFactory: () => SessionFactory

  constructor(
    maxSessions: number = DEFAULT_MAX_SESSIONS,
    sessionFactory: () => SessionFactory = defaultSessionFactory,
  ) {
    this.maxSessions = maxSessions
    this.sessionFactory = sessionFactory
  }

  /** 获取（或创建）模型会话 */
  async acquire(
    modelId: string,
    modelPath: string,
    opts?: AcquireOptions,
    ownerPluginId: string | null = null,
  ): Promise<any> {
    const existing = this.sessions.get(modelId)
    if (existing) {
      existing.lastUsedAt = Date.now()
      return existing.session
    }

    // P1-10：创建锁——同名并发只建一个（后到者复用进行中的创建 Promise）
    const inflight = this.creating.get(modelId)
    if (inflight) return inflight

    const p = this.createSession(modelId, modelPath, opts, ownerPluginId)
    this.creating.set(modelId, p)
    try {
      return await p
    } finally {
      this.creating.delete(modelId)
    }
  }

  /** 实际创建会话并登记（由 acquire 在创建锁保护下调用） */
  private async createSession(
    modelId: string,
    modelPath: string,
    opts: AcquireOptions | undefined,
    ownerPluginId: string | null,
  ): Promise<any> {
    // 创建前先让出可能需驱逐的旧会话（若已满）
    this.evictLRUIfNeeded(modelId)

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
    const createSessionInstance = this.sessionFactory()
    let session: any
    let usedEp: EpKind = ep
    try {
      session = await createSessionInstance(modelPath, {
        ...sessionOptions,
        executionProviders: [ep],
      })
    } catch {
      // EP 不可用 → 回退 CPU
      session = await createSessionInstance(modelPath, {
        ...sessionOptions,
        executionProviders: ['cpu'],
      })
      usedEp = 'cpu'
    }

    this.sessions.set(modelId, {
      session,
      refCount: 0,
      lastUsedAt: Date.now(),
      ep: usedEp,
      ownerPluginId,
    })
    return session
  }

  /**
   * P1-10 LRU 驱逐：会话数超上限时，按 lastUsedAt 升序驱逐 refCount===0 的空闲会话。
   * @param protectModelId 刚创建的会话不参与本轮驱逐
   */
  private evictLRUIfNeeded(protectModelId?: string): void {
    if (this.sessions.size < this.maxSessions) return
    const evictable = Array.from(this.sessions.entries())
      .filter(([id, e]) => e.refCount === 0 && id !== protectModelId)
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
    // 驱逐至 < maxSessions（为即将新增腾出一个位）
    for (const [id, e] of evictable) {
      if (this.sessions.size < this.maxSessions) break
      try {
        e.session.release?.()
      } catch {
        /* 忽略 */
      }
      this.sessions.delete(id)
    }
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

  /**
   * 销毁指定插件创建的全部会话（P1-10，供 plugin.unload）。
   * 仅释放 refCount===0 的空闲会话；在用会话跳过，避免打断并发推理。
   * @returns 实际释放的会话数
   */
  destroyByPlugin(pluginId: string): number {
    let released = 0
    for (const [modelId, entry] of Array.from(this.sessions.entries())) {
      if (entry.ownerPluginId !== pluginId) continue
      if (entry.refCount > 0) continue
      try {
        entry.session.release?.()
      } catch {
        /* 忽略 */
      }
      this.sessions.delete(modelId)
      released++
    }
    return released
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
