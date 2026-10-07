// T22 PoC R-c 前置：抓取若干「主体明确的真实照片」作跨模态语义召回的 ground-truth。
// 仅走已验证可达的 hf-mirror；下载到 gitignore 的 cache/poc-t22/images/，不入库、不注册 ModelManager。
// 用法：node scripts/poc-t22/fetch-real-images.mjs
import fs from 'fs'
import path from 'path'
import https from 'https'
import { URL } from 'url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, 'cache', 'poc-t22', 'images')
const DI = 'https://hf-mirror.com/datasets/huggingface/documentation-images/resolve/main'

// 候选：subject 仅为临时标签（不可信），真实主体靠事后逐张目测确认
const candidates = [
  { subject: 'cat', urls: [`${DI}/pipeline-cat-chonk.jpeg`] },
  { subject: 'bee', urls: [`${DI}/bee.jpg`] },
  { subject: 'baklava', urls: [`${DI}/baklava.jpg`] },
  { subject: 'vines', urls: [`${DI}/blog/121_model-cards/vines_idea.jpg`] },
  { subject: 'bicycle', urls: [`${DI}/blog/124_ml-for-games/gaussian/bicycle.png`] },
  { subject: 'landscape', urls: [`${DI}/blog/121_model-cards/MC_landscape.png`] },
]

function get(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'poc/1.0' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && depth < 6) {
        res.resume()
        const next = new URL(res.headers.location, url).href
        return resolve(get(next, dest, depth + 1))
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const bufs = []
      res.on('data', (c) => bufs.push(c))
      res.on('error', reject)
      res.on('end', () => {
        const buf = Buffer.concat(bufs)
        // JPEG (FFD8FF) 或 PNG (89504E4E) 魔数校验，防把 HTML 错误页当图片存下
        const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
        if (!isJpg && !isPng) return reject(new Error(`not-image (${buf.length}B head=${buf.subarray(0, 8).toString('hex')})`))
        if (buf.length < 2048) return reject(new Error(`too-small (${buf.length}B)`))
        fs.writeFileSync(dest, buf)
        resolve(buf.length)
      })
    }).on('error', reject)
  })
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const manifest = []
  for (const c of candidates) {
    let got = null
    for (const [i, u] of c.urls.entries()) {
      const ext = (new URL(u).pathname.match(/\.(jpe?g|png)$/i) || ['.png'])[0]
      const dest = path.join(OUT, `${c.subject}${i === 0 ? '' : `-${i}`}${ext}`)
      try {
        const size = await get(u, dest)
        got = { url: u, file: path.basename(dest), size }
        break
      } catch (e) {
        console.log(`  miss [${c.subject}] ${u} -> ${e.message}`)
      }
    }
    if (got) {
      manifest.push({ subject: c.subject, ...got })
      console.log(`OK   [${c.subject}] ${(got.size / 1024).toFixed(1)} KB <- ${got.url}`)
    } else {
      console.log(`FAIL [${c.subject}] no candidate reachable`)
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nDONE. ${manifest.length}/${candidates.length} subjects -> ${OUT}`)
  if (manifest.length < 2) {
    console.log('WARN: fewer than 2 distinct subjects — cross-modal ranking sanity needs >=2')
    process.exit(2)
  }
})().catch((e) => { console.error('FETCH FAILED:', e); process.exit(1) })
