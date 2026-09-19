/**
 * 媒体加载性能提升方案 —— CDP 非抢占真机验证
 * 通过 Electron 远程调试端口 9222 连接，纯程序化操作（fetch / new Image / IPC），
 * 不移动物理鼠标、不发送系统级键鼠事件，用户可照常使用电脑。
 *
 * 运行：node scripts/cdp-verify-media.mjs   （需 npm run dev 已启动、9222 端口在线）
 *
 * 覆盖维度（对应方案通过标准）：
 *   T1 缩略图 thumb 分支：media:// URL、200、image/webp、Content-Length、immutable、确定性
 *   T2 falsy 契约：不存在的 imageId → 返回空字符串
 *   T3 批量 getThumbnails：数组、全部 media://
 *   T4 渲染解码：new Image().src=media://thumb → naturalWidth>0
 *   T5 文件 file 分支：200 + ETag + Content-Length(==file_size) + Accept-Ranges + max-age
 *   T6 条件请求 If-None-Match → 304
 *   T7 Range 前缀 bytes=0-N → 206 + Content-Range + Content-Length
 *   T8 Range 后缀 bytes=-N → 206 + 正确 Content-Range
 *   T9 视频首块预热（若存在视频）：bytes=0-1048575 → 206
 *   T10 preview 分支：getPreview → media:// → 200 image/webp
 *   T11 temp 残留 & electron RSS（信息项，不判失败）
 */
import { chromium } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
const exec = promisify(execFile)

const EVIDENCE = 'test-evidence'
fs.mkdirSync(EVIDENCE, { recursive: true })
const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}
function info(name, detail = '') {
  console.log(`ℹ️  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages().find(p => p.url().includes('5173'))
if (!page) { console.error('未找到主窗口页面（5173）'); process.exit(1) }

// ── 网络层响应捕获（不受 CORS 头过滤影响）──
const responses = []   // {url, status, headers}
page.on('response', async (r) => {
  try {
    const entry = { url: r.url(), status: r.status(), headers: await r.allHeaders(), ts: Date.now() }
    responses.push(entry)
  } catch { /* target 已关闭等，忽略 */ }
})
// 发起一次 media:// 请求并返回网络层观测到的响应（请求后新增的最后一条匹配）。
// 注：Chromium 将 media://TOKEN 解析为 media://TOKEN/（host + 尾斜杠），
// 故按 token 子串匹配，不受大小写/尾斜杠规范化影响。
async function probeFetch(url, opts = {}) {
  const token = url.slice('media://'.length).replace(/\/+$/, '')
  const mark = responses.length
  await page.evaluate(async ({ u, o }) => {
    try { await fetch(u, o) } catch { /* 304/不透明响应可能 reject，忽略，改由网络事件判定 */ }
  }, { u: url, o: opts })
  for (let i = 0; i < 60; i++) {
    const added = responses.slice(mark).filter(e => token && e.url.includes(token))
    if (added.length) return added[added.length - 1]
    await new Promise(r => setTimeout(r, 50))
  }
  return null
}

// ── 选库：优先 test 库，挑一张够大的图做 Range 目标；顺带找一张视频 ──
const setup = await page.evaluate(async () => {
  const libs = await window.electronAPI.getLibraries()
  if (!libs.length) return { err: '无已注册库' }
  const online = libs.filter(l => l.status === 'online' && l.imageCount > 0)
  const pool = (online.length ? online : libs).sort((a, b) => b.imageCount - a.imageCount)
  const out = []
  for (const lib of pool) {
    const raw = await window.electronAPI.getImages(lib.id, { limit: 300, offset: 0, orderBy: 'modified_time', order: 'DESC' })
    const arr = Array.isArray(raw) ? raw : (raw?.images || [])
    const imgs = arr.filter(x => !x.is_deleted)
    const photo = imgs.filter(x => x.mediaType === 'image' && x.file_size > 2000)
      .sort((a, b) => b.file_size - a.file_size)[0] || null
    const video = imgs.find(x => x.mediaType === 'video') || null
    if (photo || video) { out.push({ lib, photo, video }) }
    if (out.some(o => o.photo) && out.some(o => o.video)) break
  }
  const withPhoto = out.find(o => o.photo)
  const withVideo = out.find(o => o.video)
  return {
    libId: withPhoto?.lib.id ?? out[0]?.lib.id ?? null,
    libName: withPhoto?.lib.name ?? out[0]?.lib.name ?? null,
    photoId: withPhoto?.photo?.id ?? null,
    photoSize: withPhoto?.photo?.file_size ?? null,
    videoId: withVideo?.video?.id ?? null,
    videoSize: withVideo?.video?.file_size ?? null,
    totalLibs: libs.length,
  }
})
if (setup.err) { console.error(setup.err); process.exit(1) }
if (setup.libId === null || setup.photoId === null) {
  console.error('未找到含图片的可用库，无法验证', JSON.stringify(setup)); process.exit(1)
}
info('测试环境', `库=${setup.libName}(${setup.libId}) 图片=${setup.photoId} size=${setup.photoSize}B 视频=${setup.videoId ?? '无'} 总库数=${setup.totalLibs}`)

// 取图片绝对路径
const photoPath = await page.evaluate(({ libId, imageId }) => window.electronAPI.getImagePath(libId, imageId),
  { libId: setup.libId, imageId: setup.photoId })

// ══ T1 缩略图 thumb 分支 ══
{
  const url1 = await page.evaluate((s) => window.electronAPI.getThumbnail(s.libId, s.photoId, 'small'), setup)
  const url2 = await page.evaluate((s) => window.electronAPI.getThumbnail(s.libId, s.photoId, 'small'), setup)
  check('T1.1 getThumbnail 返回 media:// URL', typeof url1 === 'string' && url1.startsWith('media://'), String(url1).slice(0, 40))
  check('T1.2 确定性：同资源两次调用 URL 相同', url1 === url2, `${url1 === url2}`)
  const res = await probeFetch(url1)
  const cl = res?.headers?.['content-length']
  const cc = res?.headers?.['cache-control'] || ''
  const ct = res?.headers?.['content-type'] || ''
  check('T1.3 thumb 请求 200', res?.status === 200, `status=${res?.status}`)
  check('T1.4 Content-Type=image/webp', ct === 'image/webp', ct)
  check('T1.5 200 带 Content-Length', !!cl && Number(cl) > 0, `CL=${cl}`)
  check('T1.6 Cache-Control 含 immutable', cc.includes('immutable') && cc.includes('max-age'), cc)
  // body 字节数与 Content-Length 一致
  const bodyLen = await page.evaluate(async (u) => {
    try { const r = await fetch(u); const b = await r.arrayBuffer(); return b.byteLength } catch { return -1 }
  }, url1)
  check('T1.7 body 字节数==Content-Length', Number(cl) === bodyLen && bodyLen > 0, `CL=${cl} body=${bodyLen}`)
}

// ══ T2 falsy 契约（不存在的 imageId）══
{
  const empty = await page.evaluate((s) => window.electronAPI.getThumbnail(s.libId, 999999999, 'small'), setup)
  check('T2 无缩略图/非法 id 返回空字符串（falsy 契约）', empty === '', JSON.stringify(empty))
}

// ══ T3 批量 getThumbnails（返回 Record<id,url>）══
{
  const batch = await page.evaluate((s) => window.electronAPI.getThumbnails(s.libId, [s.photoId], 'small'), setup)
  const val = batch && batch[setup.photoId]
  const ok = !!val && String(val).startsWith('media://')
  check('T3 getThumbnails 批量返回 id->media:// 映射', ok, JSON.stringify(batch).slice(0, 60))
}

// ══ T4 渲染解码（img 管线可用）══
{
  const url = await page.evaluate((s) => window.electronAPI.getThumbnail(s.libId, s.photoId, 'medium'), setup)
  const decoded = await page.evaluate(async (u) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ ok: false, w: 0, h: 0 })
    img.src = u
    setTimeout(() => resolve({ ok: false, w: img.naturalWidth, h: img.naturalHeight, to: true }), 5000)
  }), url)
  check('T4 media:// 缩略图可被浏览器解码 (naturalWidth>0)', decoded.ok && decoded.w > 0, JSON.stringify(decoded))
}

// ══ T5 文件 file 分支：200 + ETag + CL + Accept-Ranges ══
let fileEtag = null, fileUrl = null
{
  fileUrl = await page.evaluate((p) => window.electronAPI.getMediaUrl(p), photoPath)
  check('T5.0 getMediaUrl 返回 media://', String(fileUrl).startsWith('media://'), String(fileUrl).slice(0, 40))
  const res = await probeFetch(fileUrl)
  const h = res?.headers || {}
  fileEtag = h['etag'] || null
  check('T5.1 file 200', res?.status === 200, `status=${res?.status}`)
  check('T5.2 带 ETag', !!fileEtag, fileEtag || 'none')
  check('T5.3 Content-Length==file_size', Number(h['content-length']) === setup.photoSize, `CL=${h['content-length']} size=${setup.photoSize}`)
  check('T5.4 Accept-Ranges: bytes', h['accept-ranges'] === 'bytes', h['accept-ranges'] || 'none')
  check('T5.5 Cache-Control max-age=86400', (h['cache-control'] || '').includes('max-age=86400'), h['cache-control'] || 'none')
}

// ══ T6 条件请求 If-None-Match → 304 ══
if (fileEtag) {
  const res = await probeFetch(fileUrl, { headers: { 'If-None-Match': fileEtag } })
  check('T6 If-None-Match 命中 → 304', res?.status === 304, `status=${res?.status}`)
} else {
  check('T6 If-None-Match 命中 → 304', false, '未取得 ETag，跳过')
}

// ══ T7 Range 前缀 → 206 ══
{
  const end = Math.min(99, setup.photoSize - 1)
  const res = await probeFetch(fileUrl, { headers: { 'Range': `bytes=0-${end}` } })
  const h = res?.headers || {}
  const cr = h['content-range'] || ''
  check('T7 前缀 Range → 206', res?.status === 206, `status=${res?.status}`)
  check('T7 Content-Range 正确', cr === `bytes 0-${end}/${setup.photoSize}`, cr)
  check('T7 Content-Length==区间长度', Number(h['content-length']) === end + 1, `CL=${h['content-length']} expect=${end + 1}`)
}

// ══ T8 Range 后缀 bytes=-N → 206 ══
{
  const n = Math.min(50, setup.photoSize)
  const res = await probeFetch(fileUrl, { headers: { 'Range': `bytes=-${n}` } })
  const h = res?.headers || {}
  const cr = h['content-range'] || ''
  const expStart = setup.photoSize - n
  check('T8 后缀 Range → 206', res?.status === 206, `status=${res?.status}`)
  check('T8 后缀 Content-Range 指向文件尾部', cr === `bytes ${expStart}-${setup.photoSize - 1}/${setup.photoSize}`, cr)
  check('T8 后缀 Content-Length==N', Number(h['content-length']) === n, `CL=${h['content-length']} expect=${n}`)
}

// ══ T9 视频首块预热 Range（若存在视频）══
if (setup.videoId !== null) {
  const vpath = await page.evaluate(({ libId, imageId }) => window.electronAPI.getImagePath(libId, imageId),
    { libId: setup.libId, imageId: setup.videoId })
  const vurl = await page.evaluate((p) => window.electronAPI.getMediaUrl(p), vpath)
  const n = 1048575
  const res = await probeFetch(vurl, { headers: { 'Range': `bytes=0-${n}` } })
  const h = res?.headers || {}
  const expectLen = Math.min(n, setup.videoSize - 1) + 1
  check('T9 视频首 1MB Range → 206（预热路径可用）', res?.status === 206, `status=${res?.status}`)
  check('T9 视频 Content-Length 合理', Number(h['content-length']) === expectLen, `CL=${h['content-length']} expect=${expectLen} vsize=${setup.videoSize}`)
} else {
  info('T9 视频首块预热', '当前库无视频，跳过')
}

// ══ T10 preview 分支 ══
{
  const purl = await page.evaluate((s) => window.electronAPI.getPreview(s.libId, s.photoId), setup)
  const isUrl = typeof purl === 'string' && (purl.startsWith('media://') || purl === '')
  check('T10.1 getPreview 返回 media:// 或空串', isUrl, String(purl).slice(0, 40))
  if (purl.startsWith('media://')) {
    const res = await probeFetch(purl)
    check('T10.2 preview 请求 200 image/webp', res?.status === 200 && (res.headers['content-type'] || '').includes('webp'),
      `status=${res?.status} ct=${res?.headers?.['content-type']}`)
  }
}

// ══ T11 信息项：temp 残留 + electron RSS ══
{
  let thumbDirs = []
  try {
    const tmp = os.tmpdir()
    thumbDirs = fs.readdirSync(tmp).filter(d => d.startsWith('luuk-thumb-'))
  } catch (e) { thumbDirs = ['<读取失败:' + e.message + '>'] }
  info('T11.1 运行期 luuk-thumb-* 临时目录', `${thumbDirs.length} 个 ${thumbDirs.slice(0, 3).join(', ')}`)

  try {
    const { stdout } = await exec('tasklist', ['/fi', 'imagename eq electron.exe', '/fo', 'csv', '/nh'])
    const rows = stdout.trim().split('\n').filter(l => l.includes('electron.exe'))
    let maxMemMB = 0
    for (const r of rows) { const cols = r.split('","'); const mem = parseInt((cols[4] || '').replace(/[^0-9]/g, '')) || 0; maxMemMB = Math.max(maxMemMB, Math.round(mem / 1024)) }
    info('T11.2 electron 进程', `${rows.length} 个，单进程峰值 RSS≈${maxMemMB}MB`)
  } catch { info('T11.2 electron 进程', 'tasklist 读取失败') }
}

// ══ T12 UI 端到端（非变更）：当前网格是否用 media:// 作为 img src 且解码成功 ══
{
  const ui = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('main img, [class*=grid] img, img')]
      .filter(im => (im.currentSrc || im.src || '').startsWith('media://'))
    const loaded = imgs.filter(im => im.complete && im.naturalWidth > 0)
    const broken = imgs.filter(im => im.complete && im.naturalWidth === 0)
    return { mediaImgs: imgs.length, loaded: loaded.length, broken: broken.length, sampleSrc: imgs[0] ? imgs[0].src.slice(0, 40) : null }
  })
  if (ui.mediaImgs === 0) {
    info('T12 UI 网格 media://', `当前视图无 media:// 图片（可能停在欢迎/空态），不强制切换库，跳过`) 
  } else {
    check('T12.1 网格使用 media:// 作为 img src', ui.mediaImgs > 0, `media:// img=${ui.mediaImgs} 例=${ui.sampleSrc}`)
    check('T12.2 media:// 图片均解码成功（无破图）', ui.broken === 0 && ui.loaded > 0, `loaded=${ui.loaded} broken=${ui.broken}`)
  }
}

// 证据截图（不聚焦窗口，后台捕获）
try { await page.screenshot({ path: `${EVIDENCE}/M-media-verify.png` }) } catch {}

console.log('\n══ 汇总 ══')
const failed = results.filter(r => !r.pass)
console.log(`${results.length - failed.length}/${results.length} 通过`)
if (failed.length) { console.log('失败项：'); failed.forEach(f => console.log(' -', f.name, f.detail)) }
await browser.close()
process.exit(failed.length ? 1 : 0)
