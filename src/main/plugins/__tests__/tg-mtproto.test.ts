/**
 * T13c — builtin.tg-mtproto 单测：注入替身 TgClient，零网络。
 * 覆盖游标推进 / 媒体落盘 file:// / 无 media 跳但游标仍进 / 缺客户端拒跑 / 缺 chatId 抛错 / manifest。
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  discover,
  configureTgClientFactory,
  activate,
  TG_PLUGIN_ID,
  TG_OP_DISCOVER,
  type TgClient,
  type TgMessageLike,
  type TgDiscoverInput,
} from '../builtins/tg-mtproto'
import { PluginLoader } from '../plugin-loader'

const input = (watermark: string | null, params: Record<string, unknown> = {}): TgDiscoverInput => ({
  sourceConfig: { params: { chatId: 'chan1', downloadDir: 'D:/dl', ...params } } as TgDiscoverInput['sourceConfig'],
  watermark,
})

/** 依序返回消息、可断言 afterId/limit 的替身客户端 */
function fakeClient(msgs: TgMessageLike[], spy: { afterId?: number; limit?: number } = {}): TgClient {
  return {
    async *iterMessages(_chatId, afterId, limit) {
      spy.afterId = afterId
      spy.limit = limit
      for (const m of msgs) yield m
    },
    async downloadMedia(msg, dir) {
      return msg.media.map(ref => ({ path: `${dir}/${ref.fileId}.jpg` }))
    },
  }
}

describe('tg-mtproto discover', () => {
  it('首轮：枚举→下载图片→产 file:// 草稿，游标推进到末条', async () => {
    const spy: { afterId?: number; limit?: number } = {}
    const client = fakeClient([
      { id: 10, date: '2024-01-01T00:00:00Z', text: '一张', senderName: '阿光', media: [{ kind: 'photo', fileId: 'a' }] },
      { id: 11, media: [] }, // 无 media → 跳，但游标仍进
      { id: 12, media: [{ kind: 'photo', fileId: 'b' }, { kind: 'photo', fileId: 'c' }] },
    ], spy)
    const res = await discover(input(null), client, 'D:/dl')
    expect(spy.afterId).toBe(0)
    expect(res.drafts).toHaveLength(2)
    const [d0, d1] = res.drafts
    expect(d0.sourceUrl).toBe('tg-mtproto://10')
    expect(d0.mediaUrls).toEqual([pathToFileURL('D:/dl/telegram/chan1/a.jpg').href])
    expect(d0.description).toBe('一张')
    expect(d0.author).toBe('阿光')
    expect(d0.publishedAt).toBe('2024-01-01T00:00:00Z')
    expect(d1.mediaUrls).toHaveLength(2)
    expect(res.nextWatermark).toBe('12')
  })

  it('续跑：watermark=12 只处理其后；无新消息不推进游标', async () => {
    const client = fakeClient([{ id: 13, media: [{ kind: 'photo', fileId: 'd' }] }])
    const res = await discover(input('12'), client, 'D:/dl')
    expect(res.drafts).toHaveLength(1)
    expect(res.nextWatermark).toBe('13')
    const none = await discover(input('13'), fakeClient([{ id: 13, media: [] }]), 'D:/dl')
    expect(none.drafts).toHaveLength(0)
    expect(none.nextWatermark).toBeUndefined()
  })

  it('limit 保守 clamp 到 1..200', async () => {
    const spy: { limit?: number } = {}
    await discover(input(null, { limit: 9999 }), fakeClient([], spy), 'D:/dl')
    expect(spy.limit).toBe(200)
    await discover(input(null, { limit: 0 }), fakeClient([], spy), 'D:/dl')
    expect(spy.limit).toBe(1)
  })

  it('缺客户端 → 拒跑（宁拒勿假成功）；缺 chatId → 抛错', async () => {
    await expect(discover(input(null), null, 'D:/dl')).rejects.toThrow('客户端未就绪')
    const client = fakeClient([])
    await expect(discover(input(null, { chatId: '' }), client, 'D:/dl')).rejects.toThrow('chatId')
  })

  it('activate：经 configureTgClientFactory 注入的工厂取客户端执行 discover', async () => {
    const client = fakeClient([{ id: 1, media: [{ kind: 'photo', fileId: 'x' }] }])
    configureTgClientFactory(async () => client)
    try {
      const ops = activate()
      const res = (await ops[TG_OP_DISCOVER](input(null))) as { drafts: unknown[]; nextWatermark?: string }
      expect(res.drafts).toHaveLength(1)
      expect(res.nextWatermark).toBe('1')
    } finally {
      configureTgClientFactory(null)
    }
  })
})

describe('T13c 装载', () => {
  it('manifest：crawler-adapter + crawler.protocol/write.media，op=tg.discover', async () => {
    const loader = new PluginLoader(path.resolve(__dirname, '../builtins'))
    await loader.discover()
    const info = loader.getPlugins().find(p => p.manifest.id === TG_PLUGIN_ID)
    expect(info?.state, `未发现 ${TG_PLUGIN_ID}`).toBe('valid')
    expect(info?.manifest.kind).toBe('crawler-adapter')
    expect(info?.manifest.permissions).toEqual(['crawler.protocol', 'crawler.write.media'])
    expect(info?.manifest.contributes?.ops?.map(o => o.id)).toEqual([TG_OP_DISCOVER])
  })
})
