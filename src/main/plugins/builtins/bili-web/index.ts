/**
 * T13a — builtin.bili-web（B 站网站端适配器，web-http 为主）
 *
 * 纯函数、零网络（D10）：只产出 RequestPlan，取流交宿主 request-executor/browser。
 * 端点为公开文档化的 web 接口（动态 feed / 相册），仅采用社区公开的 wbi 签名算法
 * （mixin 表 + md5，无逆向、无破解），**不搬运 bilibili-api(GPLv3)/MediaCrawler(NCL) 代码**。
 *
 * 出流策略（§12.10 只识别退让不绕过）：
 *   - params 带 wbiImgKey/wbiSubKey → 生成带 wts/w_rid 签名的匿名计划（公开动态可浏览）
 *   - 无签名 key 或 params.needsBrowser → 计划标 needsBrowser，宿主用隐藏窗口页面上下文出流
 *     （页面自身 JS 产签名，同 MediaCrawler 思路，零逆向）；关注流/风控 412 由此兜底
 *
 * 两阶段（plan.context.phase）：list（分页枚举）→ 直接产带媒体的草稿（B 站接口即含图文）。
 */
import { createHash } from 'crypto'
import type {
  BuildRequestsInput,
  BuildRequestsResult,
  CandidateDraft,
  ParseResponseInput,
  RequestPlan,
} from '../../../../types/agent'

export const BILI_PLUGIN_ID = 'builtin.bili-web'
export const BILI_OP_BUILD = 'bili.buildRequests'
export const BILI_OP_PARSE = 'bili.parseResponse'

export interface BiliParams {
  /** UP 主 mid（空间动态/相册） */
  mid?: number | string
  /** 采集类型：dynamic=动态 feed（默认）| album=相册 */
  type?: 'dynamic' | 'album'
  /** 续跑每轮抓取页数（默认 1，保守限速） */
  pageSize?: number
  /** 首轮最多页数上限（封顶，防一次拉穿） */
  maxPages?: number
  /** 强制走浏览器页面上下文出流（无 wbi key 时自动降级也会置此） */
  needsBrowser?: boolean
  /** wbi 签名所需 img/sub key（宿主经 nav 预取注入；缺省则不签，走 needsBrowser 兜底） */
  wbiImgKey?: string
  wbiSubKey?: string
  /** 附加固定 query（透传，如语义参数） */
  extra?: Record<string, string>
}

const MAX_PAGES_CAP = 10
const UA_REFERER = 'https://www.bilibili.com/'

function getParams(input: BuildRequestsInput | ParseResponseInput): BiliParams {
  return ('sourceConfig' in input
    ? input.sourceConfig.params
    : input.ctx.params) as BiliParams
}

// ── wbi 签名（社区公开算法：mixin 置乱表 + 排序 query + md5） ──

/** mixinKeyEncrypt 置乱表（公开常量，非专有；来自 B 站前端可逆向得到的公开事实） */
const MIXIN_INDEX_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

/** query 值过滤掉 `!'()*` 后按键排序，拼成 urlencoded 串（公开签名前处理） */
function normalizeQuery(params: Record<string, string | number>): string {
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    filtered[k] = String(v).replace(/[!'()*]/g, '')
  }
  return Object.keys(filtered)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(filtered[k])}`)
    .join('&')
}

export function mixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey
  let out = ''
  for (const idx of MIXIN_INDEX_ENC_TAB) {
    const c = raw[idx]
    if (c) out += c
    if (out.length >= 32) break
  }
  return out.slice(0, 32)
}

/** 返回带 wts/w_rid 的签名 query 串（不含前导 ?） */
export function wbiSign(params: Record<string, string | number>, imgKey: string, subKey: string, wts: number): string {
  const key = mixinKey(imgKey, subKey)
  const withTs = { ...params, wts }
  const query = normalizeQuery(withTs)
  const wrid = createHash('md5').update(query + key).digest('hex')
  return `${query}&w_rid=${wrid}`
}

function listBase(type: 'dynamic' | 'album'): string {
  return type === 'album'
    ? 'https://api.bilibili.com/x/v2/medialist/resource/list'
    : 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space'
}

/** 组装某页的查询参数（未编码）；album 用 biz_id/pn/ps，dynamic 用 host_mid/offset */
function listQuery(type: 'dynamic' | 'album', pn: number, mid: string): Record<string, string> {
  return type === 'album'
    ? { type: '15', biz_id: mid, pn: String(pn), ps: '30' }
    : { host_mid: mid, offset: String((pn - 1) * 10), features: 'itemOpusStyle' }
}

// ── op①：buildRequests（纯函数） ──

export function buildRequests(input: BuildRequestsInput): BuildRequestsResult {
  const p = getParams(input)
  const mid = p.mid != null ? String(p.mid) : ''
  if (!mid) throw new Error('bili 源缺 params.mid（UP 主空间 id）')
  const type = p.type ?? 'dynamic'
  const maxPages = Math.min(MAX_PAGES_CAP, Math.max(1, p.maxPages ?? 1))

  const lastConsumed = input.watermark ? (Number.parseInt(input.watermark, 10) || 0) : 0
  const startPn = lastConsumed + 1
  if (startPn > maxPages) return { plans: [] }
  // 首轮（无水位）跑完 1..maxPages；续跑按 pageSize 限量补页（限速保守）
  const endPn = lastConsumed === 0 ? maxPages : Math.min(maxPages, startPn + Math.max(0, p.pageSize ?? 1) - 1)

  const signed = !!(p.wbiImgKey && p.wbiSubKey && !p.needsBrowser)
  const plans: RequestPlan[] = []
  for (let pn = startPn; pn <= endPn; pn++) {
    const base = listBase(type)
    const query: Record<string, string> = { ...listQuery(type, pn, mid), ...(p.extra ?? {}) }
    const finalUrl = signed
      ? `${base}?${wbiSign(query, p.wbiImgKey!, p.wbiSubKey!, Math.floor(Date.now() / 1000))}`
      : `${base}?${normalizeQuery(query)}`
    plans.push({
      url: finalUrl,
      method: 'GET',
      headers: { Referer: UA_REFERER },
      ...(signed ? {} : { needsBrowser: true }), // 未签名 → 交宿主浏览器页面上下文出流
      context: { phase: 'list', pn, type },
    })
  }
  return { plans, nextWatermark: String(endPn) }
}

// ── 媒体/字段挖掘（B 站接口结构容错） ──

const IMG_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)(?:[?#]|$)/i

/** 从任意层级的对象里收集图片直链：img_src / .src(draw.item) / 纯字符串数组 images */
function collectImages(node: unknown, out: Set<string>, depth = 0): void {
  if (node == null || depth > 6) return
  if (Array.isArray(node)) {
    for (const n of node) collectImages(n, out, depth + 1)
    return
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    for (const key of ['img_src', 'url_default', 'src']) {
      const v = obj[key]
      if (typeof v === 'string' && /^https?:\/\//.test(v) && IMG_EXT.test(v)) out.add(v)
    }
    for (const v of Object.values(obj)) collectImages(v, out, depth + 1)
  }
}

function stripSizeSuffix(url: string): string {
  // 去掉 @ 后的大小裁剪后缀与查询，取原图（B 站图床惯例：xxx.jpg@480w.webp）
  return url.split('@')[0]
}

function textOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function toDraft(item: any, base: string): CandidateDraft | null {
  if (typeof item !== 'object' || item === null) return null
  // 动态：item.id_str + modules.module_author / module_dynamic.major.draw
  // 相册：list[i].（含 pictures[].img_src）+ uid/uname
  const idStr = item.id_str ?? item.pic_id ?? item.id
  const sourceUrl = idStr != null
    ? `https://www.bilibili.com/opus/${idStr}`
    : base
  const draft: CandidateDraft = { sourceUrl, tags: [], mediaUrls: [] }

  const author = item.modules?.module_author?.name ?? item.uname
  if (author) draft.author = textOf(author)
  const title = item.modules?.module_dynamic?.desc?.text ?? item.name ?? item.title
  if (title) draft.pageTitle = textOf(title)
  const desc = item.modules?.module_dynamic?.content?.text ?? item.description
  if (desc) draft.description = textOf(desc)
  const pubTs = item.modules?.module_author?.pub_ts
  if (pubTs != null) {
    const n = Number(pubTs)
    draft.publishedAt = Number.isFinite(n) ? new Date(n * 1000).toISOString() : String(pubTs)
  }

  const imgs = new Set<string>()
  collectImages(item.modules?.module_dynamic?.major ?? item.pictures ?? item.draw ?? item, imgs)
  draft.mediaUrls = [...imgs].map(stripSizeSuffix)
  return draft.mediaUrls.length > 0 || draft.pageTitle ? draft : null
}

// ── op②：parseResponse（JSON 解析，非法/风控体一律零抽取交宿主退让，不抛穿） ──

export function parseResponse(input: ParseResponseInput): CandidateDraft[] {
  const base = input.response.url || input.plan.url
  let json: any
  try {
    json = JSON.parse(input.response.body)
  } catch {
    return [] // 非 JSON（挑战页/HTML）：零抽取，退让判定归宿主 noteExtraction
  }
  if (json?.code !== 0 || !json?.data) return []

  const data = json.data
  const items: any[] = Array.isArray(data.items) ? data.items
    : Array.isArray(data.list) ? data.list
    : []
  const drafts: CandidateDraft[] = []
  for (const item of items) {
    const d = toDraft(item, base)
    if (d) drafts.push(d)
  }
  return drafts
}

/** 插件激活：op 注册表（约定见 plugin-registry / plugin-worker） */
export function activate(): Record<string, (input: any) => unknown> {
  return {
    [BILI_OP_BUILD]: raw => buildRequests(raw as BuildRequestsInput),
    [BILI_OP_PARSE]: raw => parseResponse(raw as ParseResponseInput),
  }
}
