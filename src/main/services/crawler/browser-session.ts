/**
 * T11 — 宿主浏览器层（D11：luuk.browser 最小原语集）
 * 隐藏 BrowserWindow + persist:luuk-crawler 独立分区，页面上下文出签名（MediaCrawler 路线），
 * 零逆向：我们不解密/不复现签名算法，只让页面自己的 JS 帮我们发请求。
 * 明确不做：stealth 补丁、challenge 求解、指纹伪造（§12.10 红线）。
 *
 * 可测性：所有消费方（crawler-service / request-executor）依赖 BrowserProvider 接口；
 * ElectronBound 实现只在 flag 开启且首次取数时创建窗口（惰性，装配阶段零窗口零网络）。
 */
import { BrowserWindow, session, safeStorage } from 'electron'
import type { Session } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { RequestPlan, FetchedResponse } from '../../../types/agent'
import { logger } from '../../../utils/logger'

const LOG_KEY = 'CrawlerBrowser'

/** 独立持久化分区：爬虫会话与主界面/其他站点完全隔离 */
export const CRAWLER_PARTITION = 'persist:luuk-crawler'

/** navigateAndWait 单次等待上限（超时不抛错，返回当前状态由适配器判定） */
const NAVIGATE_TIMEOUT_MS = 20_000
/** 页面上下文 fetch 上限（站点响应普遍 <10s，超页即退让） */
const INPAGE_FETCH_TIMEOUT_MS = 30_000

/** 浏览器取数结果（与 FetchedResponse 同形，供 parseResponse 统一消费） */
export interface BrowserFetchResult {
  status: number
  finalUrl: string
  body: string
}

/**
 * 宿主浏览器能力面（crawler-service 消费的最小集）：
 * 单测注入 fake 实现即可覆盖路由逻辑，无需真窗口。
 */
export interface BrowserProvider {
  /** 导航到 URL 并取渲染后内容：pageHint 支持 'window.__X__' 全局变量或 CSS 选择器 */
  navigateAndWait(url: string, pageHint?: string): Promise<BrowserFetchResult>
  /** 在已加载页面上下文里执行 fetch（签名/ Cookie 由页面自身 JS 产生） */
  inPageFetch(url: string, referer?: string): Promise<BrowserFetchResult>
  /** 执行 needsBrowser 计划（内部路由 navigate/inPageFetch，plan 已含 url/pageHint） */
  runPlan(plan: RequestPlan): Promise<FetchedResponse>
  /** persist 分区 Cookie 串（宿主 HTTP 出口复用同一会话） */
  getCookies(url: string): Promise<string>
  /** 可见登录窗口（扫码/账密由用户完成，凭证落 persist 分区）；关闭时 resolve */
  showLoginWindow(url: string): Promise<void>
  /**
   * 分区内是否已有该站登录态。
   * 传 loginCookieNames 时按站点登录特征 cookie（如 bili SESSDATA、xhs web_session）判定，
   * 需至少一个存在且非空；不传时退化为"任意 cookie 存在"粗判（匿名 cookie 会误报）。
   */
  hasCookiesFor(url: string, loginCookieNames?: string[]): Promise<boolean>
  dispose(): void
}

/** 凭据落盘目录：%APPDATA%/luuk/crawler/（safeStorage 加密后写文件） */
export function getCrawlerDataDir(): string {
  return path.join(app.getPath('userData'), 'crawler')
}

/**
 * 凭据存储（D11）：api_id/api_hash/token 等按 key 加密落盘。
 * safeStorage 不可用时拒绝存储（宁拒勿明文），调用方降级为无凭据路径。
 */
export class CredentialStore {
  private get filePath(): string {
    return path.join(getCrawlerDataDir(), 'credentials.enc')
  }

  isAvailable(): boolean {
    try { return safeStorage.isEncryptionAvailable() } catch { return false }
  }

  private readAll(): Record<string, string> {
    if (this.isAvailable() && this.isEncryptedFile()) {
      try {
        const plain = safeStorage.decryptString(fs.readFileSync(this.filePath))
        return JSON.parse(plain) as Record<string, string>
      } catch (err) {
        logger.warn(LOG_KEY, `凭据解密失败（按空集处理）: ${err}`)
        return {}
      }
    }
    return {}
  }

  private isEncryptedFile(): boolean {
    try { return fs.existsSync(this.filePath) } catch { return false }
  }

  get(key: string): string | undefined {
    return this.readAll()[key]
  }

  set(key: string, value: string): void {
    if (!this.isAvailable()) {
      throw new Error('safeStorage 不可用，拒绝明文落盘凭据')
    }
    const all = this.readAll()
    all[key] = value
    fs.mkdirSync(getCrawlerDataDir(), { recursive: true })
    fs.writeFileSync(this.filePath, safeStorage.encryptString(JSON.stringify(all)))
  }

  remove(key: string): void {
    const all = this.readAll()
    delete all[key]
    if (this.isAvailable()) {
      fs.mkdirSync(getCrawlerDataDir(), { recursive: true })
      fs.writeFileSync(this.filePath, safeStorage.encryptString(JSON.stringify(all)))
    }
  }
}

/** 把 'window.__INITIAL_STATE__' 形式的提示转成页面内求值表达式 */
const WINDOW_HINT_RE = /^window(\.[A-Za-z_$][\w$]*)+$/
function hintToEval(hint: string): string {
  if (hint.startsWith('window.')) {
    // 白名单收口：仅允许 window.foo.bar 属性链，拒绝任意 JS 注入（hint 来自插件，页面携用户 cookie）
    if (!WINDOW_HINT_RE.test(hint)) {
      throw new Error(`非法 window 提示（仅允许属性链）: ${hint}`)
    }
    return `(() => { const v = ${hint}; return typeof v === 'string' ? v : JSON.stringify(v) })()`
  }
  // CSS 选择器：取 outerHTML
  return `(() => { const el = document.querySelector(${JSON.stringify(hint)}); return el ? el.outerHTML : null })()`
}

/**
 * Electron 实现：单隐藏窗口复用（避免每请求开窗口），按导航目标换页。
 * 窗口只在首次取数时创建；dispose 关窗，session 分区留存（登录态跨重启）。
 */
export class CrawlerBrowserSession implements BrowserProvider {
  private hidden: BrowserWindow | null = null
  private crawlerSession: Session | null = null
  /** 可见登录窗口按 URL 去重（同站重复点击聚焦既有窗），关层时统一释放 */
  private loginWindows = new Map<string, BrowserWindow>()

  private ensureSession(): Session {
    if (!this.crawlerSession) {
      this.crawlerSession = session.fromPartition(CRAWLER_PARTITION)
    }
    return this.crawlerSession
  }

  private ensureHidden(): BrowserWindow {
    if (this.hidden && !this.hidden.isDestroyed()) return this.hidden
    this.hidden = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        session: this.ensureSession(),
        // 页面内容不可信：不给 node 集成，不 preload
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    // 常规桌面 UA（§12.9 明确标识在 HTTP 出口侧；浏览器侧伪装反而易触发风控）
    this.hidden.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    )
    return this.hidden
  }

  async navigateAndWait(url: string, pageHint?: string): Promise<BrowserFetchResult> {
    const win = this.ensureHidden()
    const wc = win.webContents
    const ok = await Promise.race([
      wc.loadURL(url).then(() => true).catch(() => false),
      new Promise<false>(r => setTimeout(() => r(false), NAVIGATE_TIMEOUT_MS)),
    ])
    if (!ok) {
      wc.stop()
      return { status: 0, finalUrl: url, body: '' }
    }
    // 渲染稳定缓冲（SPA 首屏数据多在此窗口内写入全局变量）
    await new Promise(r => setTimeout(r, 1_000))
    let body = ''
    try {
      if (pageHint) {
        body = String(await wc.executeJavaScript(hintToEval(pageHint), true) ?? '')
      }
      if (!body) body = wc.getURL() === url ? await this.getDom() : ''
    } catch (err) {
      logger.warn(LOG_KEY, `页面取内容失败 ${url}: ${err}`)
    }
    return { status: body ? 200 : 0, finalUrl: wc.getURL(), body }
  }

  private async getDom(): Promise<string> {
    const wc = this.ensureHidden().webContents
    return String(await wc.executeJavaScript('document.documentElement.outerHTML', true) ?? '')
  }

  async inPageFetch(url: string, referer?: string): Promise<BrowserFetchResult> {
    const wc = this.ensureHidden().webContents
    const script = `
      (async () => {
        try {
          const res = await fetch(${JSON.stringify(url)}, {
            credentials: 'include',
            headers: { Referer: ${JSON.stringify(referer ?? wc.getURL())} }
          })
          return JSON.stringify({ status: res.status, url: res.url, body: await res.text() })
        } catch (e) {
          return JSON.stringify({ status: 0, url: ${JSON.stringify(url)}, body: String(e) })
        }
      })()
    `
    const raw = await Promise.race([
      wc.executeJavaScript(script, true) as Promise<string>,
      new Promise<string>(r => setTimeout(
        () => r(JSON.stringify({ status: 0, url, body: 'inPageFetch timeout' })),
        INPAGE_FETCH_TIMEOUT_MS,
      )),
    ])
    try {
      // 页内脚本/超时兵返回的是 {status,url,body}，归一化到 BrowserFetchResult 的 finalUrl
      // （旧代码强转使 finalUrl=undefined，inPageFetch 路径下 response.url 恒空）
      const p = JSON.parse(String(raw)) as { status?: number; url?: string; body?: string }
      return { status: p.status ?? 0, finalUrl: p.url ?? url, body: p.body ?? '' }
    } catch {
      return { status: 0, finalUrl: url, body: String(raw) }
    }
  }

  async runPlan(plan: RequestPlan): Promise<FetchedResponse> {
    // 有 pageHint 且未标注 in-page 的按计划语义走导航取数；
    // 站点 API 型（plan.context?.mode === 'inPageFetch'）走页面上下文 fetch
    const useInPage = (plan.context?.mode as string | undefined) === 'inPageFetch'
    const result = useInPage
      ? await this.inPageFetch(plan.url, plan.headers?.Referer)
      : await this.navigateAndWait(plan.url, plan.pageHint)
    return {
      status: result.status,
      url: result.finalUrl,
      body: result.body,
      headers: { 'content-type': 'text/plain' },
    }
  }

  async getCookies(url: string): Promise<string> {
    try {
      const cookies = await this.ensureSession().cookies.get({ url })
      return cookies.map(c => `${c.name}=${c.value}`).join('; ')
    } catch {
      return ''
    }
  }

  async hasCookiesFor(url: string, loginCookieNames?: string[]): Promise<boolean> {
    try {
      const cookies = await this.ensureSession().cookies.get({ url })
      if (cookies.length === 0) return false
      // 未指定登录特征 cookie：退化为"任意 cookie 存在"粗判
      if (!loginCookieNames || loginCookieNames.length === 0) return true
      // 指定时：至少一个登录特征 cookie 存在且非空才算已登录（匿名 cookie 不计入）
      const present = new Set(cookies.filter(c => c.value && c.value.length > 0).map(c => c.name))
      return loginCookieNames.some(n => present.has(n))
    } catch {
      return false
    }
  }

  /** 可见扫码/登录窗口：用户在页面内自行完成，凭证写 persist 分区，关窗即回；同 URL 去重聚焦 */
  showLoginWindow(url: string): Promise<void> {
    const existing = this.loginWindows.get(url)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      // 已有窗口：附带一个在其自然关闭时 resolve 的等待（不重复开窗）
      return new Promise(resolve => existing.once('closed', () => resolve()))
    }
    const win = new BrowserWindow({
      show: true,
      width: 1000,
      height: 760,
      title: '登录 - Luuk 采集',
      webPreferences: {
        session: this.ensureSession(),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    this.loginWindows.set(url, win)
    win.once('closed', () => this.loginWindows.delete(url))
    void win.loadURL(url)
    return new Promise(resolve => win.once('closed', () => resolve()))
  }

  dispose(): void {
    if (this.hidden && !this.hidden.isDestroyed()) this.hidden.destroy()
    this.hidden = null
    for (const win of this.loginWindows.values()) {
      if (!win.isDestroyed()) win.destroy()
    }
    this.loginWindows.clear()
  }
}
