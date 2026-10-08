/**
 * T5 — ProposalStore（提案持久化）
 * 人在回路（D8）的核心存储：状态机 pending → {accepted|skipped|rejected}，终态不可逆。
 * accept 才触发下游动作（采集 Agent 的下载入库），skip/reject 仅记状态 + 反馈。
 */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { MasterDB } from '../database'
import type {
  AgentKind,
  DecisionSource,
  FeedbackAction,
  Proposal,
  ProposalState,
} from '../../../types/agent'
import { logger } from '../../../utils/logger'

const LOG_KEY = 'ProposalStore'

/** 用户动作 → 提案终态 */
const ACTION_TO_STATE: Record<FeedbackAction, ProposalState> = {
  accept: 'accepted',
  skip: 'skipped',
  reject: 'rejected',
}

export interface CreateProposalInput {
  agentKind: AgentKind
  libraryId: number | null
  payload: unknown
  score?: number
  decisionSrc?: DecisionSource
  confidence?: number
}

export interface ProposalQuery {
  agentKind?: AgentKind
  state?: ProposalState
  /** 1 起始 */
  page?: number
  pageSize?: number
}

export interface ProposalPage {
  items: Proposal[]
  total: number
  page: number
  pageSize: number
}

/** accept 下游动作处理器（采集 Agent 的下载入库在 M3 注册） */
export type AcceptHandler = (proposal: Proposal) => void | Promise<void>

function mapRow(row: any): Proposal {
  let payload: unknown = null
  try { payload = JSON.parse(row.payload) } catch { logger.warn(LOG_KEY, `提案 ${row.id} payload 非法 JSON，置 null`) }
  return {
    id: row.id,
    agentKind: row.agent_kind,
    libraryId: row.library_id ?? null,
    payload,
    score: row.score ?? 0,
    decisionSrc: row.decision_src,
    confidence: row.confidence ?? 0,
    state: row.state,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  }
}

export class ProposalStore {
  private acceptHandler: AcceptHandler | null = null

  constructor(readonly masterDb: MasterDB) {
    // 构造时校验可用性，但不缓存连接句柄（S11：MasterDB close/重开后仍可用）
    if (!masterDb.getRawDb()) throw new Error('ProposalStore: MasterDB 未初始化')
  }

  /** 每次调用时取连接：避免持有重开后的死句柄抛不可控的 connection 错误 */
  private get db(): DatabaseType {
    const raw = this.masterDb.getRawDb()
    if (!raw) throw new Error('ProposalStore: MasterDB 连接已关闭')
    return raw
  }

  /** 注册 accept 下游处理器（后注册覆盖前者） */
  onAccept(handler: AcceptHandler): void {
    this.acceptHandler = handler
  }

  /** 创建提案，默认 pending */
  create(input: CreateProposalInput): Proposal {
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      INSERT INTO proposals (agent_kind, library_id, payload, score, decision_src, confidence, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      input.agentKind,
      input.libraryId,
      JSON.stringify(input.payload ?? null),
      input.score ?? 0,
      input.decisionSrc ?? 'local',
      input.confidence ?? 0,
      now,
    )
    return this.get(Number(result.lastInsertRowid))!
  }

  get(id: number): Proposal | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)
    return row ? mapRow(row) : null
  }

  /**
   * 终态流转：pending → accepted/skipped/rejected。
   * 非法流转（提案不存在、已是终态）抛错；事务内联动写入 feedback_log。
   */
  resolve(id: number, action: FeedbackAction): Proposal {
    const targetState = ACTION_TO_STATE[action]
    const now = new Date().toISOString()
    const tx = this.db.transaction((): Proposal => {
      const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as any
      if (!row) throw new Error(`提案不存在: ${id}`)
      if (row.state !== 'pending') throw new Error(`非法状态流转: ${id} 已是终态 ${row.state}`)
      this.db.prepare(
        'UPDATE proposals SET state = ?, resolved_at = ? WHERE id = ? AND state = \'pending\'',
      ).run(targetState, now, id)
      this.db.prepare(
        'INSERT INTO feedback_log (proposal_id, action, created_at) VALUES (?, ?, ?)',
      ).run(id, action, now)
      return mapRow(this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id))
    })
    const proposal = tx()
    // accept 的下游动作（下载入库等）在事务外执行：DB 状态先行，物理动作失败不回滚提案
    if (action === 'accept' && this.acceptHandler) {
      try {
        await0(this.acceptHandler(proposal))
      } catch (err) {
        logger.error(LOG_KEY, `accept 下游动作失败 id=${id}: ${err}`)
      }
    }
    return proposal
  }

  /** T16 防重提案：同 sourceUrl 是否已有 pending 采集提案（payload 为 CandidateItem JSON） */
  hasPendingForSourceUrl(sourceUrl: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM proposals
      WHERE agent_kind = 'crawler' AND state = 'pending'
        AND json_valid(payload) AND json_extract(payload, '$.sourceUrl') = ?
      LIMIT 1
    `).get(sourceUrl)
    return row !== undefined
  }

  /** T23 防重提案：同 imageId 是否已有 pending 标签建议提案（payload 为 LabelProposalInput JSON） */
  hasPendingForQualityImage(imageId: number): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM proposals
      WHERE agent_kind = 'quality' AND state = 'pending'
        AND json_valid(payload) AND json_extract(payload, '$.imageId') = ?
      LIMIT 1
    `).get(imageId)
    return row !== undefined
  }

  /** 按 agent_kind / state 过滤，score 降序分页（DiscoverPanel 消费） */
  list(query: ProposalQuery = {}): ProposalPage {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20))
    const where: string[] = []
    const params: unknown[] = []
    if (query.agentKind) { where.push('agent_kind = ?'); params.push(query.agentKind) }
    if (query.state) { where.push('state = ?'); params.push(query.state) }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total = (this.db.prepare(
      `SELECT COUNT(*) AS n FROM proposals ${whereSql}`,
    ).get(...params) as { n: number }).n
    const rows = this.db.prepare(
      `SELECT * FROM proposals ${whereSql} ORDER BY score DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, (page - 1) * pageSize) as any[]
    return { items: rows.map(mapRow), total, page, pageSize }
  }

  /** 各状态计数（调度器与 UI 角标用） */
  countByState(agentKind?: AgentKind): Record<ProposalState, number> {
    const rows = agentKind
      ? this.db.prepare('SELECT state, COUNT(*) AS n FROM proposals WHERE agent_kind = ? GROUP BY state').all(agentKind)
      : this.db.prepare('SELECT state, COUNT(*) AS n FROM proposals GROUP BY state').all()
    const result: Record<ProposalState, number> = { pending: 0, accepted: 0, skipped: 0, rejected: 0 }
    for (const r of rows as Array<{ state: ProposalState; n: number }>) result[r.state] = r.n
    return result
  }
}

/** resolve 是同步 API，handler 可能返回 Promise：吞掉异步仅记录失败 */
function await0(value: void | Promise<void>): void {
  if (value && typeof (value as Promise<void>).then === 'function') {
    (value as Promise<void>).catch(err => logger.error(LOG_KEY, `accept 异步下游动作失败: ${err}`))
  }
}

/** 主进程共享单例；传入不同 MasterDB（重开/重初始化）时重建，不沿用旧连接上的实例 */
let storeInstance: ProposalStore | null = null

export function getProposalStore(masterDb: MasterDB): ProposalStore {
  if (storeInstance && storeInstance.masterDb !== masterDb) storeInstance = null
  if (!storeInstance) {
    storeInstance = new ProposalStore(masterDb)
  }
  return storeInstance
}

export function resetProposalStore(): void {
  storeInstance = null
}
