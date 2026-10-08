/**
 * T11 — 爬虫层装配（纯 DI，仿 jev-bootstrap.ts）
 * 默认全关：crawler.enabled=false 时零对象构造零窗口零网络（与 agent.enabled 双闸：
 * 调度侧 AgentScheduler 看 agent.enabled，执行侧本层看 crawler.enabled，任一关闭都不出流）。
 * 幂等：设置页改 flag 后重调 ensureCrawlerLayer 即可开/关；生产接线在 agent-handlers.ts。
 */
import { net, session } from 'electron'
import path from 'path'
import type { MasterDB } from '../database'
import type { JobRunner } from '../job-runner'
import type { PluginManager } from '../plugin-manager'
import type { CrawlSourceRecord } from '../../../types/agent'
import { getSetting } from '../settings-service'
import { logger } from '../../../utils/logger'
import { CrawlSourceStore } from './source-store'
import { RequestExecutor, CRAWLER_UA, type ExecutorFetch } from './request-executor'
import { CrawlerBrowserSession, type BrowserProvider } from './browser-session'
import { CrawlerService, CrawlerPipelineSink, type CandidateSink, type ProposalStage } from './crawler-service'
import { MediaDownloader, type DownloadFetch } from './downloader'
import { CrawlItemStore, urlHash } from './crawl-item-store'
import { CrawlerIntake } from './intake'
import { computePhash } from '../../utils/phash'

const LOG_KEY = 'CrawlerBootstrap'

/** Electron net 模块走系统网络栈（代理/证书随系统），与 global fetch 行为一致 */
const netFetch: ExecutorFetch = async (url, init) => {
  const res = await net.fetch(url, init)
  return res
}

/** 下载出口：net.fetch 的 body 为 Node ReadableStream（可 async 迭代），形别于 DownloadFetch */
const netDownloadFetch: DownloadFetch = async (url, init) => {
  const res = await net.fetch(url, init as RequestInit)
  return {
    status: res.status,
    headers: { get: (n: string) => res.headers.get(n) },
    body: res.body as unknown as AsyncIterable<Uint8Array> | null,
  }
}

/** pHash 出图/损坏降级为 null（不阻断落地，intake 仅跳过第三级去重） */
const safeComputePhash = async (filePath: string): Promise<string | null> => {
  try {
    return await computePhash(filePath)
  } catch {
    return null
  }
}

export interface CrawlerLayerDeps {
  masterDb: MasterDB
  getRunner: () => JobRunner
  pluginManager: PluginManager
  /** flag 读取注入（单测可脱离 electron-store） */
  isEnabled?: () => boolean
  /** 候选下游（T15 intake；M3 装配序里 T11 先行，允许后接） */
  getSinks?: () => { sink?: CandidateSink | null } | undefined
  /** 下载根目录解析（返回库根，intake 向其下 _downloads/ 落盘）；缺省且无 getSinks 时候选只丢弃不落盘 */
  getDownloadRoot?: () => string | null
  /** T16 提案段（agent-handlers 注入 RecommendScorer；缺省只入库不提案） */
  getProposalStage?: () => ProposalStage | null
  /** 提案归属库（沿 getDownloadRoot 同一在线库）；缺省 null=全局提案 */
  getLibraryId?: (source: CrawlSourceRecord) => number | null
  /** 测试替身：浏览器层与 fetch 可整体替换 */
  overrides?: {
    browser?: BrowserProvider | null
    fetchImpl?: ExecutorFetch
  }
}

export interface CrawlerLayer {
  enabled: boolean
  sourceStore: CrawlSourceStore | null
  service: CrawlerService | null
  /** 登录态 IPC（T16）：hasCookiesFor/showLoginWindow；overrides 置 null 时无登录态能力 */
  browser: BrowserProvider | null
  /** 关闭层并释放窗口资源（flag 翻 false / 退出清理时调用） */
  disable: () => void
}

let layer: CrawlerLayer | null = null

/** 候选下游解析：优先外部注入（测试/定制）；否则配了库根就内建 intake（可再串 T16 提案段），都没有则 null（候选只丢弃不落盘） */
function resolveSink(deps: CrawlerLayerDeps, items: CrawlItemStore | null): CandidateSink | null {
  const external = deps.getSinks?.()?.sink
  if (external) return external
  if (!deps.getDownloadRoot || !items) return null
  const downloader = new MediaDownloader({ fetchImpl: netDownloadFetch })
  const intake = new CrawlerIntake({
    items,
    downloader,
    getDownloadRoot: () => deps.getDownloadRoot!(),
    computePhash: safeComputePhash,
  })
  const stage = deps.getProposalStage?.()
  if (!stage) return intake
  return new CrawlerPipelineSink({
    intake,
    urlSeen: (url: string) => {
      try {
        return items.urlSeen(urlHash(url))
      } catch {
        return false // 查库异常按"未见过"处理：宁可重提不可漏提（重复由 pending 查重兼并）
      }
    },
    stage,
    getLibraryId: deps.getLibraryId ?? (() => null),
  })
}

/** flag 关闭 → 拆除既有层并返回 null；开启 → 幂等装配（handler 覆盖注册安全） */
export function ensureCrawlerLayer(deps: CrawlerLayerDeps): CrawlerLayer | null {
  const enabled = deps.isEnabled?.() ?? getSetting('crawler.enabled')
  if (!enabled) {
    layer?.disable()
    layer = null
    return null
  }

  const sourceStore = new CrawlSourceStore(deps.masterDb)
  const items = new CrawlItemStore(deps.masterDb)
  const browser = deps.overrides?.browser !== undefined
    ? deps.overrides.browser
    : new CrawlerBrowserSession()

  const executor = new RequestExecutor({
    fetchImpl: deps.overrides?.fetchImpl ?? netFetch,
    userAgent: CRAWLER_UA,
    respectRobots: true,
    // HTTP 出口复用爬虫分区的登录态（web-http 适配器拿到 Cookie 才能出签名接口数据）
    getCookies: async (url) => {
      if (deps.overrides?.browser !== undefined) {
        return browser?.getCookies(url) ?? ''
      }
      try {
        const cookies = await session.fromPartition('persist:luuk-crawler').cookies.get({ url })
        return cookies.map(c => `${c.name}=${c.value}`).join('; ')
      } catch {
        return ''
      }
    },
  })

  const service = new CrawlerService({
    sourceStore,
    executeOp: (pluginId, opId, input) => deps.pluginManager.executeOp(pluginId, opId, input),
    executor,
    browser,
    sink: resolveSink(deps, items),
    recordError: (sourceId, sourceUrl, detail) => { items.insertProvenanceError(sourceId, sourceUrl, detail) },
    getPcAppDownloadDir: () => {
      const root = deps.getDownloadRoot?.()
      return root ? path.join(root, '_downloads') : null
    },
  })
  service.register(deps.getRunner())
  logger.info(LOG_KEY, '爬虫层已装配（flag=crawler.enabled）')

  layer = {
    enabled: true,
    sourceStore,
    service,
    browser,
    disable: () => {
      browser?.dispose()
    },
  }
  return layer
}

/** 供 IPC 处理器（T16）取当前层；未装配为 null */
export function getCrawlerLayer(): CrawlerLayer | null {
  return layer
}

/** 测试复位（不触发 disable：handler 注册留在传入的 fake runner 上） */
export function resetCrawlerLayer(): void {
  layer = null
}
