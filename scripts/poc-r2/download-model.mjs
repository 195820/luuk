// R2 前置：从 hf-mirror 下载 CLIP ViT-B/32 vision encoder（fp32 + int8 双份，作对照数据点）
// 用法：node scripts/poc-r2/download-model.mjs
import fs from 'fs'
import path from 'path'
import https from 'https'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, 'cache', 'poc-r2')
const BASE = 'https://hf-mirror.com/Xenova/clip-vit-base-patch32/resolve/main'

const files = [
  { url: `${BASE}/onnx/vision_model.onnx`, name: 'clip-vit-b32-fp32.onnx', minMB: 300 },
  { url: `${BASE}/onnx/vision_model_int8.onnx`, name: 'clip-vit-b32-int8.onnx', minMB: 60 },
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
  // 完整性判据用期望体积下限（而非 1MB），防断流残包被当有效模型跳过；不完整则重下
  if (fs.existsSync(dest) && fs.statSync(dest).size > f.minMB * 1048576) {
    console.log('skip (exists):', f.name, (fs.statSync(dest).size / 1048576).toFixed(1), 'MB')
    continue
  }
  const t0 = Date.now()
  await get(f.url, dest)
  const ms = Date.now() - t0
  const size = fs.statSync(dest).size
  console.log('downloaded:', f.name, (size / 1048576).toFixed(1), 'MB in', (ms / 1000).toFixed(1), 's =>', (size / 1048576 / (ms / 1000)).toFixed(2), 'MB/s')
}
