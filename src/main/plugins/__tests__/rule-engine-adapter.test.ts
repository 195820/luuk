/**
 * T12 — 规则引擎适配器单测：fixture HTML（列表页+详情页）抽取正确性、
 * 翻页水位、缺规则抛错、选择器落空零抽取（不抛穿）、manifest 新权限组合校验。
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  buildRequests,
  parseResponse,
  detailPlansFrom,
  RULE_ENGINE_PLUGIN_ID,
  RULES_OP_BUILD,
  RULES_OP_PARSE,
} from '../builtins/rule-engine-adapter'
import { PluginLoader, VALID_PERMISSIONS } from '../plugin-loader'
import type { BuildRequestsInput, ParseResponseInput, CrawlSourceConfig } from '../../../types/agent'

const LIST_HTML = `<!DOCTYPE html><html><head><title> sunset - 列表页</title></head><body>
  <div class="card">
    <a class="title" href="/post/1">落日海岸</a>
    <span class="tag">风景, 黄昏</span>
    <img src="/thumbs/1_small.jpg" data-src="https://cdn.example.com/img/1_large.jpg?sign=abc">
    <img src="data:image/png;base64,AAAA">
    <img src="/icons/arrow.svg">
  </div>
  <div class="card">
    <a class="title" href="/post/2">夜港霓虹</a>
    <span class="tag">城市</span>
    <img srcset="https://cdn.example.com/img/2.jpg 640w, https://cdn.example.com/img/2_big.jpg 1280w">
  </div>
  <div class="ads">广告位 <a href="/ad">推广</a></div>
</body></html>`

const DETAIL_HTML = `<!DOCTYPE html><html><head>
  <title>落日海岸 - 详情</title>
  <meta property="article:published_time" content="2026-09-01T08:00:00Z">
</head><body>
  <article>
    <h1 id="t">落日海岸</h1>
    <span class="author">摄影：阿光</span>
    <p class="desc">傍晚六点的海岸线</p>
    <img src="https://cdn.example.com/full/1a.jpg">
    <img src="https://cdn.example.com/full/1b.jpg">
  </article>
</body></html>`

const rules: any = {
  listSelector: 'div.card',
  pagination: { baseUrl: 'https://example.com/list', urlTemplate: 'https://example.com/list?page={page}', maxPages: 3 },
  item: { fields: { pageTitle: { selector: 'a.title' }, tags: { selector: '.tag' } } },
  detail: {
    selector: 'a.title',
    fields: {
      pageTitle: { selector: '#t' },
      author: { selector: '.author', pattern: '：(.+)$' },
      description: { selector: '.desc' },
      publishedAt: { selector: 'meta[property="article:published_time"]', attr: 'content' },
    },
  },
}

function src(over: Partial<CrawlSourceConfig> = {}): CrawlSourceConfig {
  return {
    connectorType: 'web-http',
    params: { rules },
    ops: { buildRequests: RULES_OP_BUILD, parseResponse: RULES_OP_PARSE },
    ...over,
  }
}

function buildInput(watermark: string | null, config = src()): BuildRequestsInput {
  return { sourceConfig: config, watermark }
}

function parseInput(url: string, body: string, phase: string, watermarkConfig = src()): ParseResponseInput {
  return {
    plan: { url, context: { phase } },
    response: { status: 200, url, body },
    ctx: { sourceId: 1, params: watermarkConfig.params },
  }
}

describe('rule-engine buildRequests', () => {
  it('首轮生成 1..maxPages 页计划并给出水位', () => {
    const res = buildRequests(buildInput(null))
    expect(res.plans.map(p => p.url)).toEqual([
      'https://example.com/list?page=1',
      'https://example.com/list?page=2',
      'https://example.com/list?page=3',
    ])
    expect(res.nextWatermark).toBe('3')
    expect(res.plans[0].context).toEqual({ phase: 'list', page: 1 })
  })

  it('续跑：水位=2 → 只补抓第 3 页（pageSize 缺省 1）', () => {
    const res = buildRequests(buildInput('2'))
    expect(res.plans.map(p => p.url)).toEqual(['https://example.com/list?page=3'])
    expect(res.nextWatermark).toBe('3')
  })

  it('水位到顶：无新计划', () => {
    expect(buildRequests(buildInput('3')).plans).toHaveLength(0)
  })

  it('缺 params.rules → 抛错（RPC 对端拿到明确错误）', () => {
    expect(() => buildRequests(buildInput(null, src({ params: {} }))))
      .toThrow('params.rules 缺失')
  })

  it('needsBrowser 规则透传到每个计划', () => {
    const config = src({ params: { rules: { ...rules, needsBrowser: true } } })
    const res = buildRequests(buildInput(null, config))
    expect(res.plans.every(p => p.needsBrowser === true)).toBe(true)
  })
})

describe('rule-engine parseResponse', () => {
  it('列表页：按规则抽取条目并产出待补全链接草稿', () => {
    const drafts = parseResponse(parseInput('https://example.com/list?page=1', LIST_HTML, 'list'))
    expect(drafts).toHaveLength(2) // ads 区块不被 div.card 命中
    expect(drafts[0].sourceUrl).toBe('https://example.com/post/1')
    expect((drafts[0] as any).pending).toBe(true)
    // 待补全草稿可转成 detail 计划
    expect(detailPlansFrom(drafts).map(p => p.url)).toEqual([
      'https://example.com/post/1', 'https://example.com/post/2',
    ])
  })

  it('详情页：字段补全 + 正则截取 + meta 取值', () => {
    const [d] = parseResponse(parseInput('https://example.com/post/1', DETAIL_HTML, 'detail'))
    expect(d.pageTitle).toBe('落日海岸')
    expect(d.author).toBe('阿光')
    expect(d.description).toBe('傍晚六点的海岸线')
    expect(d.publishedAt).toBe('2026-09-01T08:00:00Z')
    expect(d.mediaUrls).toEqual([
      'https://cdn.example.com/full/1a.jpg',
      'https://cdn.example.com/full/1b.jpg',
    ])
  })

  it('无 detail 规则时就地出草稿：媒体挖掘（data-src 优先/srcset 首项/过滤 data URI 与 svg）', () => {
    const config = src({ params: { rules: { ...rules, detail: undefined } } })
    const drafts = parseResponse(parseInput('https://example.com/list?page=1', LIST_HTML, 'list', config))
    expect(drafts[0]).toMatchObject({
      sourceUrl: 'https://example.com/post/1',
      pageTitle: '落日海岸',
      tags: ['风景', '黄昏'],
      mediaUrls: ['https://cdn.example.com/img/1_large.jpg?sign=abc', 'https://example.com/thumbs/1_small.jpg'],
    })
    expect(drafts[1].mediaUrls).toEqual(['https://cdn.example.com/img/2.jpg'])
  })

  it('选择器落空 → 零抽取空数组（退让判定归宿主，不抛错）', () => {
    const config = src({ params: { rules: { ...rules, listSelector: 'div.not-exist' } } })
    expect(parseResponse(parseInput('https://example.com/list', LIST_HTML, 'list', config))).toEqual([])
  })

  it('非法字段正则 → 抛错（宿主 executeOp 层隔离，不影响其他来源）', () => {
    const config = src({ params: { rules: { detail: { fields: { author: { selector: '.author', pattern: '([' } } } } } })
    expect(() => parseResponse(parseInput('https://example.com/post/1', DETAIL_HTML, 'detail', config)))
      .toThrow('正则非法')
  })
})

describe('T12 契约与装载', () => {
  it('manifest：crawler-adapter kind + 新权限组合通过清单校验', async () => {
    const loader = new PluginLoader(path.resolve(__dirname, '../builtins'))
    await loader.discover()
    const info = loader.getPlugins().find(p => p.manifest.id === RULE_ENGINE_PLUGIN_ID)
    expect(info?.state, `未发现 ${RULE_ENGINE_PLUGIN_ID}`).toBe('valid')
    expect(info?.manifest.kind).toBe('crawler-adapter')
    expect(info?.manifest.permissions).toEqual(['crawler.fetch'])
    expect(info?.manifest.contributes?.ops?.map(o => o.id)).toEqual([RULES_OP_BUILD, RULES_OP_PARSE])
  })

  it('权限白名单与三个 crawler.* 新权限同步', () => {
    expect(VALID_PERMISSIONS).toContain('crawler.fetch')
    expect(VALID_PERMISSIONS).toContain('crawler.protocol')
    expect(VALID_PERMISSIONS).toContain('crawler.write.media')
  })
})
