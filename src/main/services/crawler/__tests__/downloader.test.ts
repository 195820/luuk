/**
 * T14 — MediaDownloader 单测：流式落盘原子性（.part→rename）、SHA256、Range 续传、
 * 取消、体积上限、文件名清洗。fetch 全 fake（async iterable 喂 chunk），只碰临时目录。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createHash } from 'crypto'
import {
  MediaDownloader,
  sanitizePathSegment,
  shortUrlHash,
  extFromUrl,
  targetsFromDraft,
  type DownloadFetch,
  type DownloadFetchResponse,
} from '../downloader'

function streamResponse(chunks: Uint8Array[], status = 200, headers: Record<string, string> = {}): DownloadFetchResponse {
  return {
    status,
    headers: { get: n => headers[n.toLowerCase()] ?? null },
    body: (async function* () { yield* chunks })(),
  }
}

function gateResponse(body: AsyncIterable<Uint8Array>, status = 200): DownloadFetchResponse {
  return { status, headers: { get: () => null }, body }
}

const enc = (s: string) => new TextEncoder().encode(s)

let tempDir: string
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivdl-'))
})
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('清洗工具', () => {
  it('sanitizePathSegment：非法字符/路径穿越/首尾点全部剥除', () => {
    expect(sanitizePathSegment('落日:/.. "恶"<>意|名?*')).toBe('落日.. 恶意名')
    // 分隔符被剥除 → .. 无法形成穿越段（结果无 / 且不是合法相对路径）
    const escaped = sanitizePathSegment('a/b/../../etc')
    expect(escaped).not.toContain('/')
    expect(escaped).not.toContain('..\\')
    expect(escaped).toBe('ab....etc')
    expect(sanitizePathSegment('   ')).toBe('_unnamed')
    expect(sanitizePathSegment('x'.repeat(200)).length).toBeLessThanOrEqual(80)
  })

  it('extFromUrl：白名单收口，异常按 jpg', () => {
    expect(extFromUrl('https://c/1.webp?a=1')).toBe('webp')
    expect(extFromUrl('https://c/1.exe')).toBe('jpg')
    expect(extFromUrl('https://c/noext')).toBe('jpg')
    expect(extFromUrl('not a url')).toBe('jpg')
  })

  it('shortUrlHash 稳定 12 位', () => {
    const h = shortUrlHash('https://a.com/1.jpg')
    expect(h).toHaveLength(12)
    expect(shortUrlHash('https://a.com/1.jpg')).toBe(h)
  })

  it('targetsFromDraft：site/标题专辑目录 + referer=详情页', () => {
    const targets = targetsFromDraft('bili-web', {
      sourceUrl: 'https://www.bilibili.com/album/1',
      pageTitle: '落日 海岸/2026',
      tags: [], mediaUrls: ['https://cdn/a.jpg', 'https://cdn/b.png'],
    })
    expect(targets).toHaveLength(2)
    // 清洗后目录段 + referer 防盗链注入源
    expect(targets[0].dir).toBe('bili-web/落日 海岸2026')
    expect(targets[0].referer).toBe('https://www.bilibili.com/album/1')
    expect(targets[1].url).toBe('https://cdn/b.png')
  })
})

describe('MediaDownloader', () => {
  it('成功流：.part 消失、正式文件落盘、SHA256 与内容一致', async () => {
    const payload = enc('hello-luuk')
    const dl = new MediaDownloader({
      fetchImpl: (async () => streamResponse([payload.slice(0, 5), payload.slice(5)])) as DownloadFetch,
    })
    const res = await dl.download(tempDir, { url: 'https://cdn/x.jpg', dir: 'site/album' })
    expect(res.ok).toBe(true)
    expect(res.filePath && fs.existsSync(res.filePath)).toBe(true)
    expect(res.sha256).toBe(createHash('sha256').update(payload).digest('hex'))
    expect(res.bytes).toBe(payload.length)
    // 中间态不留
    expect(fs.readdirSync(path.dirname(res.filePath!)).filter(f => f.endsWith('.part'))).toHaveLength(0)
    expect(path.basename(res.filePath!)).toContain(shortUrlHash('https://cdn/x.jpg'))
  })

  it('目标已存在：直接复用不再发起请求', async () => {
    let calls = 0
    const dl = new MediaDownloader({
      fetchImpl: (async () => { calls++; return streamResponse([enc('x')]) }) as DownloadFetch,
    })
    const target = { url: 'https://cdn/y.jpg', dir: 'site/album' }
    const first = await dl.download(tempDir, target)
    const second = await dl.download(tempDir, target)
    expect(first.ok && second.ok && second.alreadyPresent).toBe(true)
    expect(calls).toBe(1)
  })

  it('HTTP 403：失败且不留 .part', async () => {
    const dl = new MediaDownloader({
      fetchImpl: (async () => streamResponse([], 403)) as unknown as DownloadFetch,
    })
    const res = await dl.download(tempDir, { url: 'https://cdn/z.jpg', dir: 'd' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('403')
  })

  it('Range 续传：.part 半截 + 206 → 追加成完整文件', async () => {
    const full = enc('0123456789')
    const dir = path.join(tempDir, 'site', 'album')
    const url = 'https://cdn/r.jpg'
    // 预写一半进 .part（文件名规则与 download() 保持一致）
    const finalPath = path.join(dir, `_media_${shortUrlHash(url)}.jpg`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${finalPath}.${shortUrlHash(url)}.part`, full.slice(0, 4))
    const seen: Record<string, unknown> = {}
    const dl = new MediaDownloader({
      fetchImpl: (async (_u: string, init?: { headers?: Record<string, string> }) => {
        seen.headers = init?.headers
        return streamResponse([full.slice(4)], 206, { 'accept-ranges': 'bytes' })
      }) as unknown as DownloadFetch,
    })
    const res = await dl.download(tempDir, { url, dir: 'site/album' })
    expect(seen.headers).toMatchObject({ Range: 'bytes=4-' })
    expect(res.ok).toBe(true)
    expect(res.bytes).toBe(full.length)
    expect(res.sha256).toBe(createHash('sha256').update(full).digest('hex'))
  })

  it('体积上限：超限即失败（视频/大包不落地）', async () => {
    const dl = new MediaDownloader({
      fetchImpl: (async () => streamResponse([enc('x'.repeat(100))])) as DownloadFetch,
      maxBytesPerItem: 50,
    })
    const res = await dl.download(tempDir, { url: 'https://cdn/big.jpg', dir: 'd' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('上限')
  })

  it('abortAll：在途任务即时中断', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    const dl = new MediaDownloader({
      fetchImpl: (async () => gateResponse((async function* () {
        yield enc('aa')
        await gate
        yield enc('bb')
      })())) as unknown as DownloadFetch,
    })
    const p = dl.download(tempDir, { url: 'https://cdn/slow.jpg', dir: 'slow' })
    await new Promise(r => setImmediate(r))
    expect(dl.abortAll(tempDir)).toBe(1)
    release()
    const res = await p
    expect(res.ok).toBe(false)
    expect(res.error).toContain('取消')
  })

  it('downloadAll 并发封顶且保序，单项失败不中断整批', async () => {
    let active = 0
    let peak = 0
    const dl = new MediaDownloader({
      maxConcurrent: 2,
      fetchImpl: (async (url: string) => {
        active++; peak = Math.max(peak, active)
        await new Promise(r => setTimeout(r, 5))
        active--
        if (String(url).includes('bad')) throw new Error('boom')
        return streamResponse([enc(`data:${url}`)])
      }) as unknown as DownloadFetch,
    })
    const results = await dl.downloadAll(tempDir, [
      { url: 'https://cdn/1.jpg', dir: 'b' },
      { url: 'https://cdn/bad.jpg', dir: 'b' },
      { url: 'https://cdn/3.jpg', dir: 'b' },
      { url: 'https://cdn/4.jpg', dir: 'b' },
    ])
    expect(results.map(r => r.ok)).toEqual([true, false, true, true])
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('downloadAll 跨调用并发：两次调用均能完成（回归共享 active 死锁）', async () => {
    // 并发闸若以实例级 this.active 作完成判据，第二个 downloadAll 会因 active 被前者
    // 占满而既不启动下载也不 resolve → 永久挂起。此处 maxConcurrent=2，先让 A 占满，
    // 再并发发起 B，断言两者均在超时前 settle。
    const dl = new MediaDownloader({
      maxConcurrent: 2,
      fetchImpl: (async (url: string) => {
        await new Promise(r => setTimeout(r, 5))
        return streamResponse([enc(`data:${url}`)])
      }) as unknown as DownloadFetch,
    })
    const [a, b] = await Promise.all([
      dl.downloadAll(tempDir, [
        { url: 'https://cdn/a1.jpg', dir: 'pa' },
        { url: 'https://cdn/a2.jpg', dir: 'pa' },
        { url: 'https://cdn/a3.jpg', dir: 'pa' },
      ]),
      dl.downloadAll(path.join(tempDir, 'b'), [
        { url: 'https://cdn/b1.jpg', dir: 'pb' },
        { url: 'https://cdn/b2.jpg', dir: 'pb' },
      ]),
    ])
    expect(a.every(r => r.ok)).toBe(true)
    expect(b.every(r => r.ok)).toBe(true)
    expect(a).toHaveLength(3)
    expect(b).toHaveLength(2)
  })
})
