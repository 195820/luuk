/**
 * T12 — builtin.rule-engine-adapter（§12.2 第②层：数据驱动的通用规则引擎）
 *
 * 规则包（params.rules）声明 列表页 CSS 选择器 + URL 模板 + 字段/图片提取规则，
 * Worker 内用 linkedom（MIT，纯 JS）解析 HTML —— 不引 Playwright（§12.3），
 * 纯函数零网络（D10）：所有取流都交宿主 RequestPlan。
 *
 * 两阶段流水（context.phase 路由）：
 *   list   → 按 itemSelector 拆条目；配了 detail 规则则再发详情页计划，否则就地出草稿
 *   detail → 按 fields 选择器补全标题/作者/标签/媒体，产出 CandidateDraft
 *
 * 非法选择器/规则缺失：parse 抛错（executeOp 沿 plugin-registry 约定隔离，不崩宿主）。
 */
import { parseHTML } from 'linkedom'
import type {
  BuildRequestsInput,
  BuildRequestsResult,
  CandidateDraft,
  ParseResponseInput,
  RequestPlan,
} from '../../../../types/agent'

/** 插件与 op 标识（宿主建源时写进 config.ops，manifest 共用同一事实源） */
export const RULE_ENGINE_PLUGIN_ID = 'builtin.rule-engine-adapter'
export const RULES_OP_BUILD = 'rules.buildRequests'
export const RULES_OP_PARSE = 'rules.parseResponse'

// ── 规则包形状 ──

export interface RuleFieldSpec {
  selector: string
  /** 取值来源：text（默认）| href | src | content（meta 标签） */
  attr?: 'text' | 'href' | 'src' | 'content'
  /** text 类型的正则截取（第 1 捕获组优先，无捕获组用整段） */
  pattern?: string
}

export interface RulesPack {
  /** 列表页条目容器 */
  listSelector: string
  /** 翻页：urlTemplate 支持 {page}（从 1 起）；缺省只抓 baseUrl 单页 */
  pagination?: { baseUrl: string; urlTemplate?: string; maxPages?: number; pageSize?: number }
  detail?: {
    /** 条目内详情页链接选择器；缺省用条目自身 a[href] */
    selector?: string
    fields: Record<string, RuleFieldSpec>
    mediaSelector?: string
  }
  /** 列表阶段就地抽取（无 detail 时必填） */
  item?: { fields: Record<string, RuleFieldSpec>; mediaSelector?: string }
  /** 媒体扩展名白名单（小写，不带点）；默认图片集，视频不在本期（T14 口径） */
  mediaExtensions?: string[]
  /** 图片节点上优先取的大图属性（如 data-src），默认 src → data-src → srcset 首项 */
  mediaAttrPriority?: string[]
  needsBrowser?: boolean
}

const DEFAULT_MEDIA_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']
/** 占位图/雪碧图噪音过滤 */
const SKIP_SRC_PATTERN = /^(data:|blob:|javascript:)|\.(svg)(\?|$)/i

const MAX_PAGES_CAP = 20

// ── 小工具 ──

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`规则包字段 ${name} 必须为非空字符串`)
  return v.trim()
}

export function resolveUrl(base: string, href: unknown): string | null {
  if (typeof href !== 'string' || !href.trim()) return null
  try {
    return new URL(href.trim(), base).href
  } catch {
    return null
  }
}

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m))
}

/** linkedom 解析（无 DOM 副作用，Worker 内安全） */
function parseDoc(html: string) {
  const { window } = parseHTML(html)
  return window.document
}

function pickText(el: Element | null, spec: RuleFieldSpec): string | null {
  if (!el) return null
  const raw = spec.attr === 'href' ? el.getAttribute('href')
    : spec.attr === 'src' || spec.attr === 'content'
      ? el.getAttribute(spec.attr === 'content' ? 'content' : 'src')
      : (el.textContent ?? '').trim()
  if (!raw) return null
  if (spec.pattern) {
    try {
      const m = raw.match(new RegExp(spec.pattern))
      if (!m) return null
      return (m[1] ?? m[0]).trim()
    } catch {
      throw new Error(`规则字段正则非法: ${spec.pattern}`)
    }
  }
  return raw.trim()
}

/** 条目/详情页内的图片挖掘：大图属性优先（data-src > src > srcset），扩展名白名单过滤 */
function extractMedia(root: Element, base: string, rules: RulesPack, scopeSelector: string): string[] {
  const exts = rules.mediaExtensions ?? DEFAULT_MEDIA_EXTS
  // 懒加载站 data-src 才是大图，故优先于兼底 src（测试口径：大图在前）
  const attrs = rules.mediaAttrPriority ?? ['data-src', 'data-original', 'src', 'srcset']
  const scope = root.querySelectorAll(scopeSelector)
  const found = new Set<string>()
  for (const img of Array.from(scope)) {
    for (const attr of attrs) {
      let value: string | null = null
      if (attr === 'srcset') {
        value = (img.getAttribute('srcset') ?? '').split(',')[0]?.trim().split(/\s+/)[0] || null
      } else {
        value = img.getAttribute(attr)
      }
      if (!value || SKIP_SRC_PATTERN.test(value)) continue
      const abs = resolveUrl(base, value)
      if (!abs) continue
      let pathname: string
      try { pathname = new URL(abs).pathname.toLowerCase() } catch { continue }
      const ext = pathname.split('.').pop() ?? ''
      if (exts.includes(ext)) found.add(abs)
    }
  }
  return [...found]
}

/** fields 白名单→ CandidateDraft 固定字段（未知键名直接忽略，防 RPC 面膨胀） */
function assignField(draft: CandidateDraft, name: string, value: string): void {
  switch (name) {
    case 'pageTitle': draft.pageTitle = value; break
    case 'author': draft.author = value; break
    case 'description': draft.description = value; break
    case 'publishedAt': draft.publishedAt = value; break
    case 'tags': draft.tags = value.split(/[,，、\s]+/).filter(Boolean).slice(0, 20); break
    default: break
  }
}

function buildDraft(itemEl: Element, base: string, rules: RulesPack, fields: Record<string, RuleFieldSpec>, pageTitle: string, mediaScope: string): CandidateDraft {
  const linkEl = itemEl.matches('a[href]') ? itemEl : itemEl.querySelector('a[href]')
  const sourceUrl = resolveUrl(base, linkEl?.getAttribute('href') ?? itemEl.getAttribute('data-url')) ?? base
  const draft: CandidateDraft = { sourceUrl, tags: [], mediaUrls: [] }
  for (const [name, spec] of Object.entries(fields)) {
    const el = name === 'sourceUrl' ? (itemEl.matches(spec.selector) ? itemEl : itemEl.querySelector(spec.selector)) : itemEl.querySelector(spec.selector)
    const value = pickText(el, spec)
    if (value) assignField(draft, name, value)
  }
  if (draft.mediaUrls.length === 0) draft.mediaUrls = extractMedia(itemEl, base, rules, mediaScope)
  if (!draft.pageTitle) draft.pageTitle = linkEl?.textContent?.trim() || pageTitle || undefined
  return draft
}

// ── op①：buildRequests（纯函数，零网络） ──

export function buildRequests(input: BuildRequestsInput): BuildRequestsResult {
  const rules = (input.sourceConfig.params as { rules?: RulesPack })?.rules
  if (!rules || typeof rules !== 'object') throw new Error('params.rules 缺失：规则引擎源必须携带规则包')
  requireString(rules.listSelector, 'rules.listSelector')
  const maxPages = Math.min(MAX_PAGES_CAP, Math.max(1, rules.pagination?.maxPages ?? 1))
  const template = rules.pagination?.urlTemplate
  if (template && !rules.pagination?.baseUrl) requireString(template, 'pagination.baseUrl')

  const startWatermark = input.watermark
  let startPage = 1
  if (startWatermark) {
    const n = Number.parseInt(startWatermark, 10)
    if (!Number.isNaN(n)) startPage = n + 1
  }
  // 首轮（水位空）一次跑完 1..maxPages；续跑轮若配 pageSize 则限量补页（小红书类限流口径）
  const lastPage = startPage === 1
    ? maxPages
    : Math.min(maxPages, startPage + Math.max(0, rules.pagination?.pageSize ?? 0))

  const plans: RequestPlan[] = []
  if (startPage === 1 && !template) {
    // 无翻页规则：单页直抓 baseUrl
    plans.push({
      url: requireString(rules.pagination?.baseUrl ?? startWatermark ?? '', 'pagination.baseUrl'),
      ...(rules.needsBrowser ? { needsBrowser: true } : {}),
      context: { phase: 'list', page: 1 },
    })
    return { plans }
  }
  for (let page = startPage; page <= lastPage; page++) {
    const url = template
      ? fillTemplate(template, { page, url: rules.pagination?.baseUrl ?? '' })
      : requireString(rules.pagination?.baseUrl, 'pagination.baseUrl')
    plans.push({
      url,
      ...(rules.needsBrowser ? { needsBrowser: true } : {}),
      context: { phase: 'list', page },
    })
  }
  // 水位 = 本轮最后一页页号（parse 全失败时宿主不推进，见 crawler-service 收尾口径）
  return { plans, nextWatermark: String(lastPage) }
}

// ── op②：parseResponse（linkedom 纯解析） ──

export function parseResponse(input: ParseResponseInput): CandidateDraft[] {
  const rules = (input.ctx.params as { rules?: RulesPack })?.rules
  if (!rules) throw new Error('params.rules 缺失')
  const phase = (input.plan.context as { phase?: string } | undefined)?.phase
  const base = input.response.url || input.plan.url
  const doc = parseDoc(input.response.body)
  const pageTitle = doc.querySelector('title')?.textContent?.trim() ?? ''

  if (phase === 'detail') {
    const fields = rules.detail?.fields ?? rules.item?.fields ?? {}
    // 从文档根取：head 里的 meta（og/发布时间）也要能命中
    const holder = (doc.documentElement ?? doc.querySelector('body')) as Element
    const draft = buildDraft(holder, base, rules, fields, pageTitle, rules.detail?.mediaSelector ?? 'img')
    draft.sourceUrl = base
    return [draft]
  }

  const items = Array.from(doc.querySelectorAll(rules.listSelector))
  if (items.length === 0) {
    // 选择器落空不抛错：零抽取计数由宿主 noteExtraction 统一做退让判定（§12.10）
    return []
  }
  const drafts: CandidateDraft[] = []
  for (const item of items) {
    if (rules.detail) {
      // 有详情页链接：产出只带链接的待补全草稿（mediaUrls 为空数组，detail 阶段回灌）
      const href = resolveUrl(base,
        item.querySelector(rules.detail.selector ?? 'a[href]')?.getAttribute('href')
        ?? (item.matches('a[href]') ? item.getAttribute('href') : null))
      if (href) {
        drafts.push({ sourceUrl: href, tags: [], mediaUrls: [], pending: true } as CandidateDraft & { pending: boolean })
        continue
      }
    }
    const fields = rules.item?.fields ?? {}
    drafts.push(buildDraft(item, base, rules, fields, pageTitle, rules.item?.mediaSelector ?? 'img'))
  }
  return drafts
}

/** detail 阶段的后续计划生成：list 阶段产出的"仅链接"草稿如何变成 detail 计划 */
export function detailPlansFrom(listDrafts: CandidateDraft[]): RequestPlan[] {
  return listDrafts
    .filter(d => (d as CandidateDraft & { pending?: boolean }).pending === true)
    .map(d => ({ url: d.sourceUrl, context: { phase: 'detail' } }))
}

/** 插件激活：返回 op 注册表（约定见 plugin-registry / plugin-worker） */
export function activate(): Record<string, (input: any) => unknown> {
  return {
    [RULES_OP_BUILD]: raw => buildRequests(raw as BuildRequestsInput),
    [RULES_OP_PARSE]: raw => parseResponse(raw as ParseResponseInput),
  }
}
