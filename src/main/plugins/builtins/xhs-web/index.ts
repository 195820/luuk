/**
 * T13b — builtin.xhs-web（小红书网页版适配器，web-browser 专属形态）
 *
 * 合规路线（§12.10 零逆向）：小红书 App 与网页版同账号同内容池，本适配器以网页版为
 * App 端接入的合规形态。取数**不自行签名、不复现 x-s/x-t**：由宿主隐藏窗口 navigate 到
 * 搜索/用户页，读站点 SSR 注入的 `window.__INITIAL_STATE__`（服务端已签好的首屏数据），
 * 即「页面自身渲染出签名内容」路线（MediaCrawler 思路），本模块保持纯函数、零网络（D10）。
 *
 * 频控保守（§12.9）：单关键词单轮 ≤2 页（maxPages 封顶 2），随机 4-8s 间隔由宿主出流层施加。
 * 图片取 `url_size_large`（原图/大图），回退 urlDefault/url，过滤占位小图。
 * 首轮登录（扫码）由宿主 T16 经 hasCookiesFor + showLoginWindow 门控，本适配器不涉凭证。
 */
import type {
  BuildRequestsInput,
  BuildRequestsResult,
  CandidateDraft,
  ParseResponseInput,
  RequestPlan,
} from '../../../../types/agent'

export const XHS_PLUGIN_ID = 'builtin.xhs-web'
export const XHS_OP_BUILD = 'xhs.buildRequests'
export const XHS_OP_PARSE = 'xhs.parseResponse'

/** SSR 首屏状态全局（browser-session hintToEval 识别 window.* 前缀做页面求值） */
export const XHS_STATE_HINT = 'window.__INITIAL_STATE__'

export interface XhsParams {
  /** 采集类型：search=关键词搜索（默认）| user=某作者笔记列表 */
  type?: 'search' | 'user'
  keyword?: string
  /** type=user 时的作者主页 id */
  authorId?: string
  /** 每页条数（透传给站点，保守默认 20） */
  pageSize?: number
  /** 单轮页数上限（封顶 2，§12.9 保守） */
  maxPages?: number
}

const MAX_PAGES_CAP = 2
const XHS_HOST = 'https://www.xiaohongshu.com'

function getParams(input: BuildRequestsInput | ParseResponseInput): XhsParams {
  return ('sourceConfig' in input ? input.sourceConfig.params : input.ctx.params) as XhsParams
}

function pageUrl(p: XhsParams, page: number): string {
  if (p.type === 'user' && p.authorId) {
    return `${XHS_HOST}/user/profile/${encodeURIComponent(p.authorId)}?page=${page}`
  }
  const kw = encodeURIComponent(p.keyword ?? '')
  return `${XHS_HOST}/search_result?keyword=${kw}&type=51&page=${page}`
}

// ── op①：buildRequests（纯函数，产出 needsBrowser 页面导航计划） ──

export function buildRequests(input: BuildRequestsInput): BuildRequestsResult {
  const p = getParams(input)
  if (p.type === 'user') {
    if (!p.authorId) throw new Error('xhs user 源缺 params.authorId')
  } else if (!p.keyword) {
    throw new Error('xhs search 源缺 params.keyword')
  }
  const maxPages = Math.min(MAX_PAGES_CAP, Math.max(1, p.maxPages ?? MAX_PAGES_CAP))
  const lastConsumed = input.watermark ? (Number.parseInt(input.watermark, 10) || 0) : 0
  const startPage = lastConsumed + 1
  if (startPage > maxPages) return { plans: [] }
  const endPage = lastConsumed === 0 ? maxPages : Math.min(maxPages, startPage) // 续跑单页推进

  const plans: RequestPlan[] = []
  for (let page = startPage; page <= endPage; page++) {
    plans.push({
      url: pageUrl(p, page),
      method: 'GET',
      needsBrowser: true,             // web-browser 形态：一律交宿主隐藏窗口
      pageHint: XHS_STATE_HINT,       // 读 SSR 注入状态而非裸 API（避免自签 x-s）
      context: { phase: p.type === 'user' ? 'user' : 'search', page },
    })
  }
  return { plans, nextWatermark: String(endPage) }
}

// ── op②：parseResponse（解析 __INITIAL_STATE__ JSON，容错蛇形/驼峰双写法） ──

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null
}
function pick(obj: Record<string, unknown> | null, ...keys: string[]): unknown {
  for (const k of keys) if (obj && obj[k] != null) return obj[k]
  return undefined
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** 笔记图片直链：url_size_large 优先，回退 url_default/url；去查询串取原图 */
function extractNoteImages(imageList: unknown): string[] {
  if (!Array.isArray(imageList)) return []
  const out: string[] = []
  for (const raw of imageList) {
    const img = asRecord(raw)
    if (!img) continue
    const u = str(pick(img, 'url_size_large', 'urlDefault', 'url_default', 'url'))
    if (!u || !/^https?:\/\//.test(u)) continue
    const clean = u.split('@')[0] // 去站点尺寸后缀（...jpg@_fw...webp）
    if (!out.includes(clean)) out.push(clean)
  }
  return out
}

function noteIdOf(feed: Record<string, unknown>, card: Record<string, unknown> | null): string | undefined {
  const id = pick(feed, 'id', 'note_id', 'noteId') ?? pick(card, 'note_id', 'noteId', 'id')
  if (typeof id === 'number') return String(id)
  return str(id)
}

function toDraft(feed: unknown): CandidateDraft | null {
  const f = asRecord(feed)
  if (!f) return null
  const card = asRecord(pick(f, 'note_card', 'noteCard') ?? undefined) ?? f
  const id = noteIdOf(f, card)
  const title = str(pick(card, 'display_title', 'displayTitle', 'title'))
  const user = asRecord(pick(card, 'user') ?? undefined)
  const author = user ? str(pick(user, 'nickname', 'nickName')) : undefined
  const images = extractNoteImages(pick(card, 'image_list', 'images', 'imageList') ?? undefined)
  if (!id && images.length === 0) return null

  const tagList = pick(card, 'tag_list', 'tags')
  const tags = Array.isArray(tagList)
    ? tagList.map(t => str(asRecord(t)?.name) ?? str(t)).filter((t): t is string => !!t)
    : []
  const draft: CandidateDraft = {
    sourceUrl: id ? `${XHS_HOST}/explore/${id}` : XHS_HOST,
    tags: tags.slice(0, 20),
    mediaUrls: images,
  }
  if (title) draft.pageTitle = title
  if (author) draft.author = author
  const desc = str(pick(card, 'desc'))
  if (desc) draft.description = desc
  return draft
}

/** __INITIAL_STATE__ 里笔记数组的多形态定位：search.feeds / user.notes / 顶层 notes */
function collectFeeds(state: Record<string, unknown>): unknown[] {
  const search = asRecord(pick(state, 'search') ?? undefined)
  const user = asRecord(pick(state, 'user') ?? undefined)
  const candidates = [
    pick(search ?? {}, 'feeds', 'item'),
    pick(user ?? {}, 'notes'),
    pick(state, 'feeds', 'notes'),
  ]
  for (const c of candidates) if (Array.isArray(c)) return c
  return []
}

export function parseResponse(input: ParseResponseInput): CandidateDraft[] {
  let state: Record<string, unknown> | null
  try {
    const parsed = JSON.parse(input.response.body)
    // navigateAndWait 已把 window.* 序列化；有些站点包一层 { code, data }，此处统一取对象
    state = asRecord(pick(asRecord(parsed) ?? {}, 'data') ?? undefined) ?? asRecord(parsed)
  } catch {
    return [] // 非 JSON（登录墙/风控 HTML）：零抽取，退让判定归宿主
  }
  if (!state) return []
  const drafts: CandidateDraft[] = []
  for (const feed of collectFeeds(state)) {
    const d = toDraft(feed)
    if (d && d.mediaUrls.length > 0) drafts.push(d)
  }
  return drafts
}

/** 插件激活：op 注册表 */
export function activate(): Record<string, (input: any) => unknown> {
  return {
    [XHS_OP_BUILD]: raw => buildRequests(raw as BuildRequestsInput),
    [XHS_OP_PARSE]: raw => parseResponse(raw as ParseResponseInput),
  }
}
