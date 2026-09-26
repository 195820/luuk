import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { MasterDB } from '../../database'
import { ProposalStore, resetProposalStore } from '../proposal-store'
import type { Proposal } from '../../../../types/agent'

describe('ProposalStore（T5 提案持久化）', () => {
  let db: MasterDB
  let tempDir: string
  let store: ProposalStore

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivprop-'))
    db = new MasterDB()
    db.initialize(tempDir)
    resetProposalStore()
    store = new ProposalStore(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const input = (over: Partial<Parameters<ProposalStore['create']>[0]> = {}) => ({
    agentKind: 'crawler' as const,
    libraryId: 1,
    payload: { sourceUrl: 'https://a.com/1', tags: ['sunset'] },
    score: 0.5,
    ...over,
  })

  it('创建提案默认 pending，payload 往返', () => {
    const p = store.create(input())
    expect(p.state).toBe('pending')
    expect(p.decisionSrc).toBe('local')
    expect(p.createdAt).toBeTruthy()
    expect(p.resolvedAt).toBeNull()
    const loaded = store.get(p.id)!
    expect(loaded.payload).toEqual({ sourceUrl: 'https://a.com/1', tags: ['sunset'] })
    expect(loaded.agentKind).toBe('crawler')
  })

  it('accept/skip/reject 写入终态与 resolved_at，并联动 feedback_log', () => {
    const raw = db.getRawDb()!
    for (const action of ['accept', 'skip', 'reject'] as const) {
      const p = store.create(input())
      const resolved = store.resolve(p.id, action)
      expect(['accepted', 'skipped', 'rejected']).toContain(resolved.state)
      expect(resolved.resolvedAt).toBeTruthy()
      const log = raw.prepare('SELECT * FROM feedback_log WHERE proposal_id = ?').get(p.id) as any
      expect(log.action).toBe(action)
    }
    expect((raw.prepare('SELECT COUNT(*) as n FROM feedback_log').get() as any).n).toBe(3)
  })

  it('终态不可逆：重复 resolve 抛错，非法目标状态不可达', () => {
    const p = store.create(input())
    store.resolve(p.id, 'accept')
    expect(() => store.resolve(p.id, 'reject')).toThrow(/非法状态流转/)
    expect(() => store.resolve(p.id, 'skip')).toThrow()
    expect(store.get(p.id)!.state).toBe('accepted')
  })

  it('不存在的提案 resolve 抛错', () => {
    expect(() => store.resolve(9999, 'accept')).toThrow(/提案不存在/)
  })

  it('accept 触发下游处理器；skip/reject 不触发', () => {
    const calls: Proposal[] = []
    store.onAccept(p => { calls.push(p) })
    store.resolve(store.create(input()).id, 'accept')
    store.resolve(store.create(input()).id, 'skip')
    store.resolve(store.create(input()).id, 'reject')
    expect(calls).toHaveLength(1)
    expect(calls[0].state).toBe('accepted')
  })

  it('accept 处理器抛错不影响提案终态', () => {
    store.onAccept(() => { throw new Error('download failed') })
    const p = store.resolve(store.create(input()).id, 'accept')
    expect(p.state).toBe('accepted')
  })

  it('按评分降序分页正确', () => {
    for (const score of [0.1, 0.9, 0.5, 0.7, 0.3]) {
      store.create(input({ score }))
    }
    const page1 = store.list({ pageSize: 2 })
    expect(page1.total).toBe(5)
    expect(page1.items.map(i => i.score)).toEqual([0.9, 0.7])
    const page2 = store.list({ pageSize: 2, page: 2 })
    expect(page2.items.map(i => i.score)).toEqual([0.5, 0.3])
    const page3 = store.list({ pageSize: 2, page: 3 })
    expect(page3.items.map(i => i.score)).toEqual([0.1])
    // 越界页返回空
    expect(store.list({ pageSize: 2, page: 9 }).items).toEqual([])
  })

  it('按 agent_kind / state 过滤', () => {
    const a = store.create(input({ agentKind: 'crawler', score: 0.9 }))
    store.create(input({ agentKind: 'organize', score: 0.8 }))
    store.create(input({ agentKind: 'crawler', score: 0.1 }))
    store.resolve(a.id, 'accept')
    const pendingCrawler = store.list({ agentKind: 'crawler', state: 'pending' })
    expect(pendingCrawler.total).toBe(1)
    expect(pendingCrawler.items[0].score).toBe(0.1)
    expect(store.list({ agentKind: 'organize' }).total).toBe(1)
  })

  it('countByState 统计各状态', () => {
    const p1 = store.create(input())
    const p2 = store.create(input())
    store.create(input({ agentKind: 'quality' }))
    store.resolve(p1.id, 'accept')
    store.resolve(p2.id, 'reject')
    expect(store.countByState()).toEqual({ pending: 1, accepted: 1, skipped: 0, rejected: 1 })
    expect(store.countByState('crawler')).toEqual({ pending: 0, accepted: 1, skipped: 0, rejected: 1 })
    expect(store.countByState('quality')).toEqual({ pending: 1, accepted: 0, skipped: 0, rejected: 0 })
  })

  it('payload 非法 JSON 时读取不抛错（置 null）', () => {
    const p = store.create(input())
    db.getRawDb()!.prepare('UPDATE proposals SET payload = ? WHERE id = ?').run('{broken', p.id)
    expect(store.get(p.id)!.payload).toBeNull()
  })
})
