/**
 * T11 — CrawlSourceStore（信息源持久化）
 * crawl_sources 表的读写封装；config JSON 是 D12 的承载点：
 * 连接器形态/站点参数/op 名/断点游标全部进 config，不做 schema 迁移。
 * 连接句柄沿 S11 纪律：构造时校验、每次调用取，不缓存裸连接。
 */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { MasterDB } from '../database'
import type {
  ConnectorType,
  CrawlSourceConfig,
  CrawlSourceRecord,
} from '../../../types/agent'
import { logger } from '../../../utils/logger'

const LOG_KEY = 'CrawlSourceStore'

const CONNECTOR_TYPES: ConnectorType[] = ['web-http', 'web-browser', 'pc-app', 'app-bridge']

/** app-bridge 仅类型占位（T13d），建源即拒绝，防止误配出一个永不干活的来源 */
const IMPLEMENTABLE_CONNECTORS: ConnectorType[] = ['web-http', 'web-browser', 'pc-app']

/**
 * 校验并归一化 config JSON（非法即抛错，宁拒勿含糊入库）
 */
export function parseCrawlSourceConfig(raw: unknown): CrawlSourceConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('crawl source config 必须是 JSON 对象')
  }
  const obj = raw as Record<string, unknown>
  const connectorType = obj.connectorType as ConnectorType
  if (!CONNECTOR_TYPES.includes(connectorType)) {
    throw new Error(`crawl source config.connectorType 非法: ${String(obj.connectorType)}`)
  }
  const params = (obj.params ?? {}) as Record<string, unknown>
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('crawl source config.params 必须是对象')
  }
  const ops = obj.ops as CrawlSourceConfig['ops'] | undefined
  if (!ops || typeof ops.buildRequests !== 'string' || typeof ops.parseResponse !== 'string') {
    throw new Error('crawl source config.ops 必须显式声明 buildRequests 与 parseResponse（宿主不猜 op 名）')
  }
  const watermark = typeof obj.watermark === 'string' ? obj.watermark : undefined
  return { connectorType, params, ops, ...(watermark !== undefined ? { watermark } : {}) }
}

function mapRow(row: any): CrawlSourceRecord {
  let config: CrawlSourceConfig
  try {
    config = parseCrawlSourceConfig(JSON.parse(row.config ?? '{}'))
  } catch (err) {
    // 历史脏数据不抛穿：降为不可用配置，读侧过滤；此处保留行避免误删用户数据
    logger.warn(LOG_KEY, `来源 ${row.id} config 非法，按占位处理: ${err}`)
    config = { connectorType: 'web-http', params: { __invalidConfig: true }, ops: { buildRequests: '', parseResponse: '' } }
  }
  return {
    id: row.id,
    pluginId: row.plugin_id,
    name: row.name,
    config,
    enabled: row.enabled === 1,
    health: row.health === 'degraded' ? 'degraded' : 'ok',
    successRate: row.success_rate ?? null,
    lastCrawlAt: row.last_crawl_at ?? null,
    createdAt: row.created_at,
  }
}

export interface CreateSourceInput {
  pluginId: string
  name: string
  config: CrawlSourceConfig
  enabled?: boolean
}

/** 成功率滑动窗口权重（指数平滑：本轮占比 30%） */
const SUCCESS_SMOOTH_ALPHA = 0.3

export class CrawlSourceStore {
  constructor(readonly masterDb: MasterDB) {
    if (!masterDb.getRawDb()) throw new Error('CrawlSourceStore: MasterDB 未初始化')
  }

  private get db(): DatabaseType {
    const raw = this.masterDb.getRawDb()
    if (!raw) throw new Error('CrawlSourceStore: MasterDB 连接已关闭')
    return raw
  }

  create(input: CreateSourceInput): CrawlSourceRecord {
    if (!IMPLEMENTABLE_CONNECTORS.includes(input.config.connectorType)) {
      throw new Error(`connectorType ${input.config.connectorType} 在 M3 无实现，不能建源`)
    }
    if (!input.pluginId || !input.name) {
      throw new Error('建源必须提供 pluginId 与 name')
    }
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      INSERT INTO crawl_sources (plugin_id, name, config, enabled, health, created_at)
      VALUES (?, ?, ?, ?, 'ok', ?)
    `).run(
      input.pluginId,
      input.name,
      JSON.stringify(parseCrawlSourceConfig(input.config)),
      input.enabled === false ? 0 : 1,
      now,
    )
    return this.get(Number(result.lastInsertRowid))!
  }

  get(id: number): CrawlSourceRecord | null {
    const row = this.db.prepare('SELECT * FROM crawl_sources WHERE id = ?').get(id)
    return row ? mapRow(row) : null
  }

  /** 全部启用的来源（调度 planner 消费） */
  listEnabled(): CrawlSourceRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM crawl_sources WHERE enabled = 1 ORDER BY id',
    ).all() as any[]
    return rows.map(mapRow)
  }

  list(): CrawlSourceRecord[] {
    const rows = this.db.prepare('SELECT * FROM crawl_sources ORDER BY id').all() as any[]
    return rows.map(mapRow)
  }

  setEnabled(id: number, enabled: boolean): void {
    const result = this.db.prepare('UPDATE crawl_sources SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    if (result.changes === 0) throw new Error(`信息源不存在: ${id}`)
  }

  /**
   * 推进水位线（同时钟域不透明串，比较由适配器/调用方负责，存储层只落盘）。
   * 顺带刷新 last_crawl_at；successRate 为本轮成功率样本（0-1），做指数平滑。
   * successRate 传 undefined = 本轮无有效样本（如水位耗尽的空轮），保留既有值不拉低健康度。
   */
  commitRound(id: number, nextWatermark: string | undefined, successRate?: number): void {
    const row = this.db.prepare('SELECT config, success_rate FROM crawl_sources WHERE id = ?').get(id) as
      | { config: string; success_rate: number | null }
      | undefined
    if (!row) throw new Error(`信息源不存在: ${id}`)

    let configRaw: unknown = {}
    try { configRaw = JSON.parse(row.config ?? '{}') } catch { /* 非法 config 原样保留 */ }
    const config = configRaw as Record<string, unknown>
    if (nextWatermark !== undefined) config.watermark = nextWatermark

    let smoothed = row.success_rate
    if (successRate !== undefined) {
      const clamped = Math.min(1, Math.max(0, successRate))
      smoothed = row.success_rate === null
        ? clamped
        : row.success_rate * (1 - SUCCESS_SMOOTH_ALPHA) + clamped * SUCCESS_SMOOTH_ALPHA
    }

    this.db.prepare(`
      UPDATE crawl_sources SET config = ?, success_rate = ?, last_crawl_at = ? WHERE id = ?
    `).run(JSON.stringify(config), smoothed, new Date().toISOString(), id)
  }

  /** §12.10 健康度：反爬退让时标 degraded（提醒用户而非默默重试） */
  setHealth(id: number, health: 'ok' | 'degraded'): void {
    const result = this.db.prepare('UPDATE crawl_sources SET health = ? WHERE id = ?').run(health, id)
    if (result.changes === 0) throw new Error(`信息源不存在: ${id}`)
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM crawl_sources WHERE id = ?').run(id).changes > 0
  }
}

// ── 单例管理（沿 ProposalStore 模式：db 实例变更自动重建） ──

let instance: CrawlSourceStore | null = null
let instanceDb: MasterDB | null = null

export function getCrawlSourceStore(masterDb: MasterDB): CrawlSourceStore {
  if (!instance || instanceDb !== masterDb) {
    instance = new CrawlSourceStore(masterDb)
    instanceDb = masterDb
  }
  return instance
}

export function resetCrawlSourceStore(): void {
  instance = null
  instanceDb = null
}
