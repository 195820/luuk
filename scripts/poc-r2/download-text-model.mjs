// T22 PoC 前置：下载 CLIP 文本编码器（int8 + fp32）与分词文件，用于跨模态可行性验证。
// 沿用 scripts/poc-r2/download-model.mjs 的 hf-mirror + 期望体积下限完整性范式。
// 用法：node scripts/poc-r2/download-text-model.mjs
import fs from 'fs'
import path from 'path'
import https from 'https'
import { URL } from 'url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const MODEL_OUT = path.join(ROOT, 'cache', 'poc-r2')
const TOK_OUT = path.join(ROOT, 'cache', 'poc-r2', 'clip-token')
const BASE = 'https://hf-mirror.com/Xenova/clip-vit-base-patch32/resolve/main'

// 模型：期望体积下限（MB）作完整性判据，防断流残包被当有效模型跳过
const models = [
  { url: `${BASE}/onnx/text_model_int8.onnx`, name: 'clip-text-b32-int8.onnx', minMB: 40 },
  { url: `${BASE}/onnx/text_model.onnx`, name: 'clip-text-b32-fp32.onnx', minMB: 200 },
]
// 分词文件（根目录，纯文本小文件，仅要求非空）
const tokens = [
  { url: `${BASE}/vocab.json`, name: 'vocab.json', minKB: 100 },
  { url: `${BASE}/merges.txt`, name: 'merges.txt', minKB: 100 },
  { url: `${BASE}/tokenizer.json`, name: 'tokenizer.json', minKB: 200 },
  { url: `${BASE}/special_tokens_map.json`, name: 'special_tokens_map.json', minKB: 0 },
  { url: `${BASE}/tokenizer_config.json`, name: 'tokenizer_config.json', minKB: 0 },
]

function get(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && depth < 5) {
        res.resume()
        // Location 可能是相对路径 → 基于当前 url 归一化，避免 https.get 抛 "Invalid URL"
        const next = new URL(res.headers.location, url).href
        return resolve(get(next, dest, depth + 1))
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

async function fetchAll(items, dir, unit) {
  fs.mkdirSync(dir, { recursive: true })
  for (const f of items) {
    const dest = path.join(dir, f.name)
    const min = (f.minMB ? f.minMB * 1048576 : (f.minKB || 0) * 1024)
    if (fs.existsSync(dest) && fs.statSync(dest).size > min) {
      console.log('skip (exists):', f.name, (fs.statSync(dest).size / 1024).toFixed(1), 'KB')
      continue
    }
    const t0 = Date.now()
    await get(f.url, dest)
    const ms = Date.now() - t0
    const size = fs.statSync(dest).size
    console.log('downloaded:', f.name, (size / 1024).toFixed(1), 'KB in', (ms / 1000).toFixed(1), 's')
  }
}

;(async () => {
  try {
    await fetchAll(models, MODEL_OUT, 'MB')
    await fetchAll(tokens, TOK_OUT, 'KB')
    console.log('DONE. models ->', MODEL_OUT, '\n      tokens ->', TOK_OUT)
  } catch (e) {
    console.error('DOWNLOAD FAILED:', e.message)
    process.exit(1)
  }
})()
