// R2 PoC：CLIP ViT-B/32 在 4650U 级 CPU 上的吞吐实测（方向文档 §15 R2）
// 协议：固定 1000 张样本集（test-data/large-library），测张/秒 → 换算 1M 张 ETA
// Prereq：npm i onnxruntime-node@^1.30.0 --no-save；node scripts/poc-r2/download-model.mjs（下模型到 cache/poc-r2）；
//         需 test-data/large-library（gitignore 的本地测试库，1000 张）
// 用法：node scripts/bench-poc-r2.mjs [--model fp32|int8] [--limit N]
// 口径注明：预处理用 sharp 默认 lanczos3，非官方 bicubic——吞吐结论不受影响，但 embedding 与
//         torchvision 管线不保证逐位一致，召回一致性待 Phase 9 单独验证
// 说明：单线程会话（§7.5 并发上限=1），intra_op 线程由 ort 默认（=物理核感知）；
//       sharp 解码+224 预处理与推理耗时分开计，另计端到端吞吐
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ort = require('onnxruntime-node')
const sharp = require('sharp')

const ROOT = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const getArg = (name, def) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : def
}
const modelKind = getArg('model', 'fp32')
const limit = parseInt(getArg('limit', '1000'), 10)
const modelPath = path.join(ROOT, 'cache', 'poc-r2', modelKind === 'int8' ? 'clip-vit-b32-int8.onnx' : 'clip-vit-b32-fp32.onnx')
const sampleDir = path.join(ROOT, 'test-data', 'large-library')

const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i
function collect(dir) {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const fp = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(fp)
      else if (IMG_EXT.test(e.name)) out.push(fp)
    }
  }
  return out.sort()
}

// CLIP 标准归一化参数（openai/clip preprocessor_config.json）
const MEAN = [0.48145466, 0.4578275, 0.40821073]
const STD = [0.26862954, 0.26130258, 0.27577711]
const SIZE = 224

async function preprocess(fp) {
  const { data } = await sharp(fp)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const f32 = new Float32Array(3 * SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      for (let c = 0; c < 3; c++) {
        const v = data[(y * SIZE + x) * 3 + c] / 255
        f32[c * SIZE * SIZE + y * SIZE + x] = (v - MEAN[c]) / STD[c]
      }
    }
  }
  return new ort.Tensor('float32', f32, [1, 3, SIZE, SIZE])
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

async function main() {
  const files = collect(sampleDir).slice(0, limit)
  const tLoad0 = Date.now()
  const session = await ort.InferenceSession.create(modelPath)
  const loadMs = Date.now() - tLoad0

  const preMs = []
  const runMs = []
  const fail = []
  let rssPeak = 0
  const t0 = Date.now()
  for (let i = 0; i < files.length; i++) {
    try {
      const a = Date.now()
      const tensor = await preprocess(files[i])
      const b = Date.now()
      const res = await session.run({ pixel_values: tensor }, ['image_embeds'])
      const c = Date.now()
      const emb = res.image_embeds
      if (emb.dims.length !== 2 || emb.data.length !== 512) throw new Error(`bad output: dims=${JSON.stringify(emb.dims)} len=${emb.data.length}`)
      preMs.push(b - a)
      runMs.push(c - b)
    } catch (e) {
      fail.push({ file: path.basename(files[i]), err: String(e).slice(0, 120) })
    }
    const rss = process.memoryUsage().rss
    if (rss > rssPeak) rssPeak = rss
    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - t0) / 1000
      console.log(`progress ${i + 1}/${files.length} elapsed=${elapsed.toFixed(0)}s rate=${((i + 1) / elapsed).toFixed(2)} img/s`)
    }
  }
  const totalMs = Date.now() - t0

  const n = runMs.length
  const sum = (a) => a.reduce((x, y) => x + y, 0)
  const result = {
    model: modelKind,
    machine: 'AMD Ryzen 5 PRO 4650U (6c/12t)',
    sessionLoadMs: loadMs,
    requested: files.length,
    succeeded: n,
    failed: fail.length,
    failSample: fail.slice(0, 3),
    totalMs,
    imgsPerSec: +(n / (totalMs / 1000)).toFixed(2),
    preMs: { p50: pct(preMs, 50), p95: pct(preMs, 95), avg: +(sum(preMs) / n).toFixed(1) },
    runMs: { p50: pct(runMs, 50), p95: pct(runMs, 95), avg: +(sum(runMs) / n).toFixed(1) },
    // 1M 张 ETA：按端到端实测吞吐换算（含解码/预处理失败剔除的净吞吐另附）
    eta1M_hours_byE2E: +((1_000_000 / (n / (totalMs / 1000))) / 3600).toFixed(1),
    rssPeakMB: Math.round(rssPeak / 1048576),
  }
  console.log('===JSON===')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
