// Phase 9 M5 · T21 运行时实测：真 CLIP ViT-B/32 int8 模型 → 引擎推理链 → int8 量化 → USearch HNSW 召回
// 目的：验证「model load(ort ABI) + sharp 预处理 + quantizeEmbedToInt8 + USearch Cos(I8)」端到端一致，
//       并回填 PoC 遗留的“召回一致性待 Phase 9 单独验证”。逻辑与 src/main/services/ai/onnx-clip-engine.ts 对齐。
// 用法：node scripts/verify-clip-int8.mjs [--limit N] [--dir test-data/large-library]
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ort = require('onnxruntime-node')
const sharp = require('sharp')
const { Index, MetricKind, ScalarKind } = require('usearch')

const ROOT = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const getArg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
const limit = parseInt(getArg('limit', '8'), 10)
const modelPath = path.join(ROOT, 'cache', 'poc-r2', 'clip-vit-b32-int8.onnx')
const sampleDir = path.join(ROOT, getArg('dir', 'test-data/large-library'))

const MEAN = [0.48145466, 0.4578275, 0.40821073]
const STD = [0.26862954, 0.26130258, 0.27577711]
const SIZE = 224
const DIM = 512

// —— 与 onnx-clip-engine.ts 逐字对齐的量化 ——
function quantizeEmbedToInt8(embed) {
  const n = embed.length
  let norm = 0
  for (let i = 0; i < n; i++) norm += embed[i] * embed[i]
  norm = Math.sqrt(norm)
  const out = new Int8Array(n)
  if (norm === 0) return out
  const scale = 127 / norm
  for (let i = 0; i < n; i++) {
    let q = Math.round(embed[i] * scale)
    if (q > 127) q = 127; else if (q < -128) q = -128
    out[i] = q
  }
  return out
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d === 0 ? 0 : dot / d
}

const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i
function collect(dir) {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    if (!fs.existsSync(cur)) continue
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const fp = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(fp)
      else if (IMG_EXT.test(e.name)) out.push(fp)
    }
  }
  return out.sort()
}

async function preprocess(fp) {
  const { data } = await sharp(fp)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const f32 = new Float32Array(3 * SIZE * SIZE)
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      for (let c = 0; c < 3; c++) {
        const v = data[(y * SIZE + x) * 3 + c] / 255
        f32[c * SIZE * SIZE + y * SIZE + x] = (v - MEAN[c]) / STD[c]
      }
  return new ort.Tensor('float32', f32, [1, 3, SIZE, SIZE])
}

async function main() {
  const files = collect(sampleDir).slice(0, limit)
  if (files.length === 0) throw new Error(`样本目录无图片：${sampleDir}`)
  const t0 = Date.now()
  const session = await ort.InferenceSession.create(modelPath)
  console.log(`model load: ${Date.now() - t0}ms, 图片数=${files.length}`)

  const floatEmbs = []
  const int8Embs = []
  const names = []
  for (const fp of files) {
    const tensor = await preprocess(fp)
    const res = await session.run({ pixel_values: tensor }, ['image_embeds'])
    const emb = res.image_embeds
    if (emb.data.length !== DIM) throw new Error(`bad dim ${emb.data.length}`)
    floatEmbs.push(Float32Array.from(emb.data))
    int8Embs.push(quantizeEmbedToInt8(emb.data))
    names.push(path.basename(fp))
  }

  // 1) int8 量化对余弦的保真：float 域相似度 vs int8 域相似度
  let maxCosErr = 0
  for (let i = 0; i < floatEmbs.length; i++)
    for (let j = 0; j < floatEmbs.length; j++) {
      const cf = cosine(floatEmbs[i], floatEmbs[j])
      const ci = cosine(int8Embs[i], int8Embs[j])
      maxCosErr = Math.max(maxCosErr, Math.abs(cf - ci))
    }

  // 2) USearch I8 + Cos ANN：每张查询，最近邻应是自身（距离≈0）
  const idx = new Index(DIM, MetricKind.Cos, ScalarKind.I8)
  int8Embs.forEach((v, i) => idx.add(BigInt(i), v))
  let selfTopOk = 0
  const rows = []
  for (let i = 0; i < int8Embs.length; i++) {
    const m = idx.search(int8Embs[i], 3, 0)
    const hits = []
    for (let k = 0; k < m.keys.length; k++) {
      if (!Number.isFinite(m.distances[k])) continue
      hits.push({ id: Number(m.keys[k]), dist: +m.distances[k].toFixed(4) })
    }
    if (hits[0] && hits[0].id === i) selfTopOk++
    rows.push({ q: names[i], top: hits.map(h => `${names[h.id]}(${h.dist})`).join(', ') })
  }

  console.log(`int8 vs float 余弦最大偏差: ${maxCosErr.toFixed(5)}`)
  console.log(`自检索命中自身: ${selfTopOk}/${int8Embs.length}`)
  for (const r of rows) console.log(`  ${r.q} → ${r.top}`)

  const pass = maxCosErr < 0.02 && selfTopOk === int8Embs.length
  console.log(pass ? '===VERIFY PASS===' : '===VERIFY FAIL===')
  await session.release()
  process.exit(pass ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
