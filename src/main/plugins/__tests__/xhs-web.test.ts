/**
 * T13b — builtin.xhs-web 单测：搜索/用户页导航计划、SSR 首屏态解析（蛇形/驼峰双写法、
 * url_size_large 优先 + 去尺寸后缀）、登录墙/风控零抽取、无图笔记丢弃、manifest 校验。全离线，零网络。
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  buildRequests,
  parseResponse,
  XHS_STATE_HINT,
  XHS_PLUGIN_ID,
  XHS_OP_BUILD,
  XHS_OP_PARSE,
} from '../builtins/xhs-web'
import { PluginLoader } from '../plugin-loader'
import type { BuildRequestsInput, ParseResponseInput, CrawlSourceConfig } from '../../../types/agent'

const cfg = (params: Record<string, unknown>): CrawlSourceConfig => ({
  connectorType: 'web-browser', params,
  ops: { buildRequests: XHS_OP_BUILD, parseResponse: XHS_OP_PARSE },
})
const buildIn = (params: Record<string, unknown>, watermark: string | null): BuildRequestsInput =>
  ({ sourceConfig: cfg(params), watermark })
const parseIn = (url: string, body: string, params: Record<string, unknown> = { keyword: '落日' }): ParseResponseInput =>
  ({ plan: { url, context: { phase: 'search' } }, response: { status: 200, url, body }, ctx: { sourceId: 1, params } })

describe('xhs buildRequests', () => {
  it('首轮：单关键词封顶 2 页、needsBrowser、pageHint 读 SSR 态、水位=2', () => {
    const res = buildRequests(buildIn({ keyword: '落日海岸' }, null))
    expect(res.plans).toHaveLength(2)
    expect(res.plans.every(p => p.needsBrowser === true && p.pageHint === XHS_STATE_HINT)).toBe(true)
    expect(res.plans[0].url).toContain('xiaohongshu.com/search_result')
    expect(res.plans[0].url).toContain('keyword=' + encodeURIComponent('落日海岸'))
    expect(res.nextWatermark).toBe('2')
  })
  it('续跑：水位=1 → 单页推进到 2；到顶=2 → 无计划', () => {
    expect(buildRequests(buildIn({ keyword: 'k' }, '1')).plans).toHaveLength(1)
    expect(buildRequests(buildIn({ keyword: 'k' }, '2')).plans).toHaveLength(0)
  })
  it('user 型走作者主页 URL；缺参抛错', () => {
    const res = buildRequests(buildIn({ type: 'user', authorId: 'abc123' }, null))
    expect(res.plans[0].url).toContain('/user/profile/abc123')
    expect(res.plans[0].context).toEqual({ phase: 'user', page: 1 })
    expect(() => buildRequests(buildIn({}, null))).toThrow('keyword')
    expect(() => buildRequests(buildIn({ type: 'user' }, null))).toThrow('authorId')
  })
})

// ── 离线 fixture：search 首屏态（noteCard 驼峰 + image_list 蛇形混写） ──
const SEARCH_STATE = JSON.stringify({
  search: {
    feeds: [
      {
        id: 'note_1', xsec_token: 'tk',
        noteCard: {
          displayTitle: '落日海岸散步',
          user: { nickname: '阿光' },
          desc: '傍晚六点的海',
          tag_list: [{ name: '风景' }, { name: '黄昏' }],
          image_list: [
            { url_default: 'https://sns.com/1_small.jpg', url_size_large: 'https://sns.com/1_large.jpg@_fw2040.webp' },
            { url: 'https://sns.com/1b.jpg' },
          ],
        },
      },
      { id: 'note_noimg', noteCard: { displayTitle: '纯文字', image_list: [] } }, // 无图→丢
    ],
  },
})
const USER_STATE = JSON.stringify({
  user: { notes: [{ id: 'u1', note_card: { display_title: '作者笔记', user: { nickName: 'YYY' }, images: [{ urlDefault: 'https://sns.com/u1.jpg' }] } }] },
})

describe('xhs parseResponse', () => {
  it('search：抽取标题/作者/标签，url_size_large 优先且去 @尺寸后缀', () => {
    const drafts = parseResponse(parseIn('https://www.xiaohongshu.com/search_result', SEARCH_STATE))
    expect(drafts).toHaveLength(1) // 无图笔记被丢弃
    const d = drafts[0]
    expect(d).toMatchObject({
      sourceUrl: 'https://www.xiaohongshu.com/explore/note_1',
      pageTitle: '落日海岸散步',
      author: '阿光',
      description: '傍晚六点的海',
      tags: ['风景', '黄昏'],
    })
    expect(d.mediaUrls).toEqual(['https://sns.com/1_large.jpg', 'https://sns.com/1b.jpg'])
  })
  it('user：蛇形 note_card + images[].urlDefault 兼容', () => {
    const [d] = parseResponse(parseIn('https://www.xiaohongshu.com/user/profile/x', USER_STATE, { type: 'user', authorId: 'x' }))
    expect(d).toMatchObject({ pageTitle: '作者笔记', author: 'YYY' })
    expect(d.mediaUrls).toEqual(['https://sns.com/u1.jpg'])
  })
  it('登录墙/风控（HTML 非 JSON）→ 零抽取，交宿主退让', () => {
    expect(parseResponse(parseIn('u', '<html>登录查看更多</html>'))).toEqual([])
  })
})

describe('T13b 装载', () => {
  it('manifest：crawler-adapter + crawler.fetch 校验通过', async () => {
    const loader = new PluginLoader(path.resolve(__dirname, '../builtins'))
    await loader.discover()
    const info = loader.getPlugins().find(p => p.manifest.id === XHS_PLUGIN_ID)
    expect(info?.state, `未发现 ${XHS_PLUGIN_ID}`).toBe('valid')
    expect(info?.manifest.contributes?.ops?.map(o => o.id)).toEqual([XHS_OP_BUILD, XHS_OP_PARSE])
  })
})
