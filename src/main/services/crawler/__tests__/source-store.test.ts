/**
 * T11 — CrawlSourceStore 单测（真库：MasterDB + better-sqlite3 临时目录，沿 proposal-store 模式）
 * 覆盖：config 校验（D12 承载点）、app-bridge 拒建、水位/健康度/成功率的轮次落盘语义。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { MasterDB } from '../../database'
import {
  CrawlSourceStore,
  parseCrawlSourceConfig,
  getCrawlSourceStore,
  resetCrawlSourceStore,
} from '../source-store'
import type { CrawlSourceConfig } from '../../../../types/agent'

const webHttp = (over: Partial<CrawlSourceConfig> = {}): CrawlSourceConfig => ({
  connectorType: 'web-http',
  params: { keyword: 'sunset' },
  ops: { buildRequests: 'bili.buildRequests', parseResponse: 'bili.parseResponse' },
  ...over,
})

describe('parseCrawlSourceConfig', () => {
  it('合法 config 往返，watermark 缺省不产出键', () => {
    const out = parseCrawlSourceConfig(webHttp())
    expect(out.connectorType).toBe('web-http')
    expect('watermark' in out).toBe(false)
    expect(parseCrawlSourceConfig(webHttp({ watermark: '42' })).watermark).toBe('42')
  })

  it('非法 connectorType / 非对象 / 缺 ops 显式声明 → 抛错', () => {
    expect(() => parseCrawlSourceConfig(null)).toThrow('JSON 对象')
    expect(() => parseCrawlSourceConfig({ connectorType: 'ftp' })).toThrow('connectorType')
    expect(() => parseCrawlSourceConfig({ connectorType: 'web-http' })).toThrow('buildRequests')
  })
})

describe('CrawlSourceStore', () => {
  let db: MasterDB
  let tempDir: string
  let store: CrawlSourceStore

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivsrc-'))
    db = new MasterDB()
    db.initialize(tempDir)
    resetCrawlSourceStore()
    store = getCrawlSourceStore(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('create → get 往返，默认 enabled/health=ok', () => {
    const rec = store.create({ pluginId: 'builtin.bili-web', name: 'b站关键词', config: webHttp() })
    expect(rec.id).toBeGreaterThan(0)
    expect(rec.enabled).toBe(true)
    expect(rec.health).toBe('ok')
    expect(rec.config.params.keyword).toBe('sunset')
    expect(store.get(rec.id)!.name).toBe('b站关键词')
  })

  it('app-bridge 占位形态拒绝建源（M3 无实现）', () => {
    expect(() => store.create({
      pluginId: 'x', name: 'n', config: webHttp({ connectorType: 'app-bridge' }),
    })).toThrow('无实现')
  })

  it('listEnabled 过滤停用来源', () => {
    const a = store.create({ pluginId: 'p', name: 'a', config: webHttp() })
    const b = store.create({ pluginId: 'p', name: 'b', config: webHttp() })
    store.setEnabled(b.id, false)
    expect(store.listEnabled().map(r => r.id)).toEqual([a.id])
    expect(() => store.setEnabled(999, true)).toThrow('不存在')
  })

  it('commitRound：水位推进 + 成功率指数平滑 + last_crawl_at', () => {
    const rec = store.create({ pluginId: 'p', name: 'a', config: webHttp() })
    store.commitRound(rec.id, 'page2', 1)
    let after = store.get(rec.id)!
    expect(after.config.watermark).toBe('page2')
    expect(after.successRate).toBe(1)
    expect(after.lastCrawlAt).toBeTruthy()

    // 第二轮 0 成功：EMA α=0.3 → 1*0.7 + 0*0.3 = 0.7；undefined 水位保持旧值
    store.commitRound(rec.id, undefined, 0)
    after = store.get(rec.id)!
    expect(after.config.watermark).toBe('page2')
    expect(after.successRate).toBeCloseTo(0.7)
  })

  it('历史脏 config 不抛穿：读侧降级为占位不可用配置', () => {
    const rec = store.create({ pluginId: 'p', name: 'a', config: webHttp() })
    db.getRawDb()!.prepare('UPDATE crawl_sources SET config = ? WHERE id = ?').run('not-json', rec.id)
    const after = store.get(rec.id)!
    expect(after.config.params.__invalidConfig).toBe(true)
    expect(after.config.ops.buildRequests).toBe('')
  })

  it('delete 移除行', () => {
    const rec = store.create({ pluginId: 'p', name: 'a', config: webHttp() })
    expect(store.delete(rec.id)).toBe(true)
    expect(store.get(rec.id)).toBeNull()
  })
})
