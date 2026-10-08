/**
 * T13a — builtin.bili-web 单测：分页/水位/签名计划、动态与相册 JSON 解析、
 * 风控体零抽取（交宿主退让）、wbi 纯函数确定性、manifest 校验。全离线 fixture，零网络。
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  buildRequests,
  parseResponse,
  mixinKey,
  wbiSign,
  BILI_PLUGIN_ID,
  BILI_OP_BUILD,
  BILI_OP_PARSE,
} from '../builtins/bili-web'
import { PluginLoader } from '../plugin-loader'
import type { BuildRequestsInput, ParseResponseInput, CrawlSourceConfig } from '../../../types/agent'

const cfg = (params: Record<string, unknown>): CrawlSourceConfig => ({
  connectorType: 'web-http', params,
  ops: { buildRequests: BILI_OP_BUILD, parseResponse: BILI_OP_PARSE },
})
const buildIn = (params: Record<string, unknown>, watermark: string | null): BuildRequestsInput =>
  ({ sourceConfig: cfg(params), watermark })
const parseIn = (url: string, body: string, params: Record<string, unknown> = { mid: '1' }): ParseResponseInput =>
  ({ plan: { url, context: { phase: 'list' } }, response: { status: 200, url, body }, ctx: { sourceId: 1, params } })

describe('bili buildRequests', () => {
  it('首轮无签名 key：跑满 maxPages、needsBrowser 降级、水位=末页', () => {
    const res = buildRequests(buildIn({ mid: '2233', maxPages: 3 }, null))
    expect(res.plans).toHaveLength(3)
    expect(res.plans.every(p => p.needsBrowser === true)).toBe(true)
    expect(res.plans[0].url).toContain('host_mid=2233')
    expect(res.plans[0].headers).toEqual({ Referer: 'https://www.bilibili.com/' })
    expect(res.nextWatermark).toBe('3')
  })
  it('带 wbi key：产出 wts/w_rid 签名、不再 needsBrowser', () => {
    const res = buildRequests(buildIn({ mid: '2233', maxPages: 1, wbiImgKey: 'imgkey', wbiSubKey: 'subkey' }, null))
    expect(res.plans[0].needsBrowser).toBeUndefined()
    expect(res.plans[0].url).toMatch(/wts=\d+&w_rid=[0-9a-f]{32}$/)
  })
  it('续跑：水位=1 → 按 pageSize 补页', () => {
    const res = buildRequests(buildIn({ mid: '1', maxPages: 5, pageSize: 2 }, '1'))
    expect(res.plans).toHaveLength(2)
    expect(res.nextWatermark).toBe('3')
  })
  it('水位到顶 → 无计划；缺 mid → 抛错', () => {
    expect(buildRequests(buildIn({ mid: '1', maxPages: 2 }, '1')).plans).toHaveLength(1) // 水位=1 → 只补第2页
    expect(buildRequests(buildIn({ mid: '1', maxPages: 2 }, '2')).plans).toHaveLength(0) // 已到顶
    expect(() => buildRequests(buildIn({ maxPages: 2 }, null))).toThrow('mid')
  })
})

describe('wbi 纯函数', () => {
  it('mixinKey 取置乱前 32 位、确定性', () => {
    const k = mixinKey('7d0a00a8bc0f14c4fdb56493f0d7e07f', 'e0e5f1d0e5c04d6f8c0e0e0e0e0e0e0e')
    expect(k).toHaveLength(32)
    expect(mixinKey('a'.repeat(64), 'b'.repeat(64))).toBe(mixinKey('a'.repeat(64), 'b'.repeat(64)))
  })
  it('wbiSign 同输入同 w_rid，且按 key 排序、过滤特殊字符', () => {
    const s1 = wbiSign({ b: 'x(y)z', a: '1' }, 'IMGKEY', 'SUBKEY', 1700000000)
    expect(s1).toContain('a=1&b=xyz') // 值里的 () 被签名前过滤
    expect(s1).toMatch(/w_rid=[0-9a-f]{32}$/)
    const s2 = wbiSign({ b: 'x(y)z', a: '1' }, 'IMGKEY', 'SUBKEY', 1700000000)
    expect(s2).toBe(s1)
  })
})

// ── 离线 fixture（脱敏真实响应结构快照） ──
const DYNAMIC_FIXTURE = JSON.stringify({
  code: 0, message: '0',
  data: {
    items: [
      {
        id: 111, id_str: '111', type: DYNAMIC_TYPE(),
        modules: {
          module_author: { name: '落日UP', pub_ts: 1700000000 },
          module_dynamic: {
            desc: { text: '图集' },
            content: { text: '傍晚六点的海岸线' },
            major: { draw: { item: [
              { src: 'https://i0.hdslb.com/bfs/album/a.jpg@480w.webp', width: 1000, height: 800 },
              { src: 'https://i0.hdslb.com/bfs/album/b.png' },
            ] } },
          },
        },
      },
      { id_str: '222', modules: { module_dynamic: { major: { draw: { item: [] } } } } }, // 无媒体→丢
    ],
  },
})
function DYNAMIC_TYPE() { return 'DYNAMIC_TYPE_DRAW' }

const ALBUM_FIXTURE = JSON.stringify({
  code: 0,
  data: {
    list: [
      { pic_id: 900, name: '海岸Album', uname: '阿光', description: '相册描述',
        pictures: [{ img_src: 'https://i0.hdslb.com/bfs/album/p1.jpg@1e_1c.jpg' }, { img_src: 'https://i0.hdslb.com/bfs/album/p2.jpg' }] },
    ],
  },
})

describe('bili parseResponse', () => {
  it('动态 feed：抽取作者/时间/正文/多图，无媒体条目被丢弃', () => {
    const drafts = parseResponse(parseIn('https://api.bilibili.com/x/feed', DYNAMIC_FIXTURE))
    expect(drafts).toHaveLength(1)
    const d = drafts[0]
    expect(d.author).toBe('落日UP')
    expect(d.pageTitle).toBe('图集')
    expect(d.description).toBe('傍晚六点的海岸线')
    expect(d.publishedAt).toBe(new Date(1700000000 * 1000).toISOString())
    expect(d.sourceUrl).toBe('https://www.bilibili.com/opus/111')
    // 去 @大小后缀取原图
    expect(d.mediaUrls).toEqual([
      'https://i0.hdslb.com/bfs/album/a.jpg',
      'https://i0.hdslb.com/bfs/album/b.png',
    ])
  })
  it('相册：pictures[].img_src 抽取 + name/uname 字段', () => {
    const [d] = parseResponse(parseIn('https://api.bilibili.com/x/album', ALBUM_FIXTURE))
    expect(d).toMatchObject({
      sourceUrl: 'https://www.bilibili.com/opus/900',
      pageTitle: '海岸Album', author: '阿光', description: '相册描述',
    })
    expect(d.mediaUrls).toEqual([
      'https://i0.hdslb.com/bfs/album/p1.jpg',
      'https://i0.hdslb.com/bfs/album/p2.jpg',
    ])
  })
  it('风控体（code=-412）/非 JSON（挑战页 HTML）→ 零抽取，退让归宿主', () => {
    expect(parseResponse(parseIn('u', JSON.stringify({ code: -412, message: '禁止访问' }))).length).toBe(0)
    expect(parseResponse(parseIn('u', '<html>checking your browser</html>'))).toEqual([])
  })
})

describe('T13a 装载', () => {
  it('manifest：crawler-adapter + crawler.fetch 校验通过，op 齐备', async () => {
    const loader = new PluginLoader(path.resolve(__dirname, '../builtins'))
    await loader.discover()
    const info = loader.getPlugins().find(p => p.manifest.id === BILI_PLUGIN_ID)
    expect(info?.state, `未发现 ${BILI_PLUGIN_ID}`).toBe('valid')
    expect(info?.manifest.kind).toBe('crawler-adapter')
    expect(info?.manifest.permissions).toEqual(['crawler.fetch'])
    expect(info?.manifest.contributes?.ops?.map(o => o.id)).toEqual([BILI_OP_BUILD, BILI_OP_PARSE])
  })
})
