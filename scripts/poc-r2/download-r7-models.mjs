// R7 前置：下载 u2netp（抠图）与 realesr-general-x4v3（超分）ONNX 模型
// 用法：node scripts/poc-r2/download-r7-models.mjs
import fs from 'fs'
import path from 'path'
import https from 'https'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, 'cache', 'poc-r2')
const files = [
  { url: 'https://hf-mirror.com/AIvocado/u2netp/resolve/main/u2netp.onnx', name: 'u2netp.onnx', minMB: 3 },
  { url: 'https://hf-mirror.com/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx', name: 'realesr-x4v3.onnx', minMB: 3 },
]
function get(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && depth < 5) {
        res.resume()
        return resolve(get(res.headers.location, dest, depth + 1))
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      const part = dest + '.part'
      const out = fs.createWriteStream(part)
      out.on('error', (e) => { fs.rmSync(part, { force: true }); reject(e) })
      res.on('error', (e) => { fs.rmSync(part, { force: true }); out.destroy(); reject(e) })
      res.pipe(out)
      out.on('finish', () => out.close(() => { fs.renameSync(part, dest); resolve() }))
    }).on('error', (e) => { fs.rmSync(dest + '.part', { force: true }); reject(e) })
  })
}
fs.mkdirSync(OUT, { recursive: true })
for (const f of files) {
  const dest = path.join(OUT, f.name)
  // 同 download-model.mjs：期望体积下限判据，防断流残包被当有效模型跳过
  if (fs.existsSync(dest) && fs.statSync(dest).size > f.minMB * 1048576) { console.log('skip', f.name); continue }
  const t0 = Date.now()
  await get(f.url, dest)
  console.log('downloaded:', f.name, (fs.statSync(dest).size / 1048576).toFixed(1), 'MB in', Date.now() - t0, 'ms')
}
