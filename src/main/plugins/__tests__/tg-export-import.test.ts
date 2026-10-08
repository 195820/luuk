/**
 * T13c — builtin.tg-export-import 单测：tdesktop 导出目录解析（纯本地，零网络）
 * 覆盖游标推进 / 图片抽取 / 视频跳过 / 缺 exportDir 抛错 / 重导入续跑 / manifest 校验。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  discover,
  TGE_PLUGIN_ID,
  TGE_OP_DISCOVER,
  type DiscoverInput,
} from '../builtins/tg-export-import'
import { PluginLoader } from '../plugin-loader'

let exportDir: string
let mediaDir: string

function writeMedia(name: string): void {
  fs.writeFileSync(path.join(mediaDir, name), Buffer.from([0xff, 0xd8, 0xff]))
}

const input = (watermark: string | null, extra: Record<string, unknown> = {}): DiscoverInput => ({
  sourceConfig: { params: { exportDir, ...extra } } as DiscoverInput['sourceConfig'],
  watermark,
})

beforeAll(() => {
  exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tge-'))
  mediaDir = path.join(exportDir, 'media')
  fs.mkdirSync(mediaDir)
  writeMedia('photo1.jpg')
  writeMedia('photo2.png')
  const result = {
    name: '落日频道',
    chats: [
      {
        name: '落日频道',
        messages: [
          { id: 1, date: 1700000000, from: '阿光', text: '第一张', photo: 'photo1.jpg' },
          { id: 2, file: 'clip.mp4' }, // 视频→跳过
          { id: 3, date_iso: '2023-11-15T00:00:00Z', text: '第三张', photo: 'photo2.png' },
          { id: 4, photo: 'missing.jpg' }, // 文件不存在→丢
          { id: 5, text: '纯文本无媒体' }, // 无媒体
        ],
      },
    ],
  }
  fs.writeFileSync(path.join(exportDir, 'result.json'), JSON.stringify(result))
})

afterAll(() => {
  fs.rmSync(exportDir, { recursive: true, force: true })
})

describe('tg-export-import discover', () => {
  it('首轮：抽取图片消息为 file:// 草稿，跳过视频/缺失/无媒体，游标推进到末条', () => {
    const res = discover(input(null))
    expect(res.drafts).toHaveLength(2)
    const [d0, d1] = res.drafts as Array<{
      sourceUrl: string; mediaUrls: string[]; author?: string; description?: string; publishedAt?: string
    }>
    expect(d0.sourceUrl).toBe('tg-export://落日频道/1')
    expect(d0.mediaUrls).toEqual([pathToFileURL(path.join(mediaDir, 'photo1.jpg')).href])
    expect(d0.author).toBe('阿光')
    expect(d0.description).toBe('第一张')
    expect(d0.publishedAt).toBe(new Date(1700000000 * 1000).toISOString())
    expect(d1.sourceUrl).toBe('tg-export://落日频道/3')
    expect(d1.publishedAt).toBe('2023-11-15T00:00:00Z')
    expect(res.nextWatermark).toBe('5') // 即便末条无图，也消费到此
  })

  it('续跑：watermark=3 只处理其后的新消息，无新增则不推进游标', () => {
    const res = discover(input('3'))
    expect(res.drafts).toHaveLength(0) // id4 缺失、id5 无媒体
    expect(res.nextWatermark).toBe('5')
    const none = discover(input('5'))
    expect(none.drafts).toHaveLength(0)
    expect(none.nextWatermark).toBeUndefined()
  })

  it('缺 exportDir / 缺 result.json → 抛错', () => {
    expect(() => discover({ sourceConfig: { params: {} } as DiscoverInput['sourceConfig'], watermark: null }))
      .toThrow('exportDir')
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tge-empty-'))
    try {
      expect(() => discover(input(null, { exportDir: empty })))
        .toThrow('result.json')
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe('T13c 装载', () => {
  it('manifest：crawler-adapter，无网络权限，op=tge.discover 校验通过', async () => {
    const loader = new PluginLoader(path.resolve(__dirname, '../builtins'))
    await loader.discover()
    const info = loader.getPlugins().find(p => p.manifest.id === TGE_PLUGIN_ID)
    expect(info?.state, `未发现 ${TGE_PLUGIN_ID}`).toBe('valid')
    expect(info?.manifest.kind).toBe('crawler-adapter')
    expect(info?.manifest.permissions).toEqual([])
    expect(info?.manifest.contributes?.ops?.map(o => o.id)).toEqual([TGE_OP_DISCOVER])
  })
})
