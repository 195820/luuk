// T22 PoC R-c：拉取少量「已知主体」真实图（Wikimedia Commons Special:FilePath，跟随重定向），存 cache/poc-t22/imgs。
// 用法：node scripts/poc-t22/fetch-imgs.mjs
import fs from 'fs'
import path from 'path'
import https from 'https'
import { URL } from 'url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, 'cache', 'poc-t22', 'imgs')
fs.mkdirSync(OUT, { recursive: true })

// Special:FilePath 按文件名解析并 302 到实际缩略图；width 控制尺寸
const imgs = [
  { name: 'cat.jpg', file: 'Cat_November_2010-1a.jpg' },
  { name: 'dog.jpg', file: 'YellowLabradorLooking_new.jpg' },
  { name: 'bird.jpg', file: 'Male house sparrow, London.jpg' },
  { name: 'car.jpg', file: '2018 Tesla Model 3, Front, 12.04.2020, Dusseldorf.jpg' },
]

function get(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'luuk-poc/1.0' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && depth < 6) {
        res.resume()
        return resolve(get(new URL(res.headers.location, url).href, dest, depth + 1))
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${url}`))
      const part = dest + '.part'
      const out = fs.createWriteStream(part)
      out.on('error', (e) => { fs.rmSync(part, { force: true }); reject(e) })
      res.on('error', (e) => { fs.rmSync(part, { force: true }); out.destroy(); reject(e) })
      res.pipe(out)
      out.on('finish', () => out.close(() => { fs.renameSync(part, dest); resolve() }))
    }).on('error', (e) => { fs.rmSync(dest + '.part', { force: true }); reject(e) })
  })
}

;(async () => {
  for (const im of imgs) {
    const dest = path.join(OUT, im.name)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 20 * 1024) { console.log('skip', im.name); continue }
    const u = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(im.file)}?width=640`
    try {
      await get(u, dest)
      console.log('ok', im.name, (fs.statSync(dest).size / 1024).toFixed(1), 'KB')
    } catch (e) {
      console.log('FAIL', im.name, e.message)
    }
  }
})()
