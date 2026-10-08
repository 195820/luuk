// T22 PoC R-c：CLIP 跨模态（文本→图像）召回 sanity —— PoC 主结论。
// 用真实生产同款预处理（sharp 224 cover → CHW CLIP 归一）+ 同款 int8 输出量化（L2×127），
// 对 4 张主体明确的真实照片，验证文本查询能否召回正确图，并对比三档精度的 top-1 一致性：
//   A) fp32 塔 × fp32 塔（基线）
//   B) int8 塔 × int8 塔（权重动态量化，生产图像塔即此）
//   C) 存储 int8（对 A 的 fp32 嵌入做 ×127 量化，模拟 VectorsDB + 查询向量落库路径）
// 用法：node scripts/poc-t22/cross-modal.mjs
import fs from 'fs'
import path from 'path'
import ort from 'onnxruntime-node'
import sharpPkg from 'sharp'

const sharp = sharpPkg.default ?? sharpPkg
const ROOT = path.resolve(import.meta.dirname, '..', '..')
const C = path.join(ROOT, 'cache', 'poc-r2')
const IMG_DIR = path.join(ROOT, 'cache', 'poc-t22', 'images')
const TOKENS = path.join(ROOT, 'cache', 'poc-t22', 'tokens.json')

const V_FP32 = path.join(C, 'clip-vit-b32-fp32.onnx')
const V_INT8 = path.join(C, 'clip-vit-b32-int8.onnx')
const T_FP32 = path.join(C, 'clip-text-b32-fp32.onnx')
const T_INT8 = path.join(C, 'clip-text-b32-int8.onnx')

// CLIP 归一化（对齐 src/main/services/ai/onnx-clip-engine.ts）
const MEAN = [0.48145466, 0.4578275, 0.40821073]
const STD = [0.26862954, 0.26130258, 0.27577711]
const SIZE = 224
const CONTEXT = 77

// 真实照片 ground-truth（已逐张目测确认）
const IMAGES = [
  { id: 'cat', file: 'cat.jpeg' },
  { id: 'bee', file: 'bee.jpg' },
  { id: 'baklava', file: 'baklava.jpg' },
  { id: 'bicycle', file: 'bicycle.png' },
]
// 文本查询 → 期望命中的图像 id
const QUERIES = [
  { q: 'a photo of a fluffy cat', expect: 'cat' },
  { q: 'a bee collecting pollen on a pink flower', expect: 'bee' },
  { q: 'a slice of baklava pastry dessert with pistachio', expect: 'baklava' },
  { q: 'a white bicycle parked on grass', expect: 'bicycle' },
]

function l2(v) { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s) || 1 }
function cosine(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d / (l2(a) * l2(b)) }
// 复刻生产 quantizeEmbedToInt8：L2 归一 ×127、四舍五入、夹 [-128,127]，再反量化回浮点参与余弦
function quantRoundTrip(v) {
  const scale = 127 / l2(v)
  const q = new Array(v.length)
  for (let i = 0; i < v.length; i++) { let x = Math.round(v[i] * scale); if (x > 127) x = 127; else if (x < -128) x = -128; q[i] = x }
  return q
}

async function preprocessImage(fp) {
  const { data } = await sharp(fp).resize(SIZE, SIZE, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const f32 = new Float32Array(3 * SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) for (let c = 0; c < 3; c++) {
    const v = data[(y * SIZE + x) * 3 + c] / 255
    f32[c * SIZE * SIZE + y * SIZE + x] = (v - MEAN[c]) / STD[c]
  }
  return new ort.Tensor('float32', f32, [1, 3, SIZE, SIZE])
}

async function embedImages(modelPath) {
  const s = await ort.InferenceSession.create(modelPath)
  const outName = s.outputNames[0]
  const vecs = {}
  for (const im of IMAGES) {
    const t = await preprocessImage(path.join(IMG_DIR, im.file))
    const r = await s.run({ pixel_values: t })
    vecs[im.id] = Array.from(r[outName].data)
  }
  if (s.release) await s.release()
  return vecs
}

async function embedTexts(modelPath, tokenMap) {
  const s = await ort.InferenceSession.create(modelPath)
  const outName = s.outputNames[0]
  const vecs = {}
  for (const { q } of QUERIES) {
    const raw = tokenMap[q]
    if (!raw) throw new Error(`tokens.json 缺少查询: ${q}`)
    const ids = new BigInt64Array(CONTEXT)
    for (let i = 0; i < CONTEXT; i++) ids[i] = BigInt(raw[i] ?? 0)
    const feed = { input_ids: new ort.Tensor('int64', ids, [1, CONTEXT]) }
    if (s.inputNames.includes('attention_mask')) {
      const am = new BigInt64Array(CONTEXT)
      for (let i = 0; i < CONTEXT; i++) am[i] = raw[i] !== 0 ? 1n : 0n
      feed.attention_mask = new ort.Tensor('int64', am, [1, CONTEXT])
    }
    const r = await s.run(feed)
    vecs[q] = Array.from(r[outName].data)
  }
  if (s.release) await s.release()
  return vecs
}

// 对某一 (textVecs, imageVecs) 精度配对，逐查询算 top-1 + margin
function rank(textVecs, imageVecs, postQuant) {
  const rows = []
  let correct = 0
  for (const { q, expect } of QUERIES) {
    const tv = postQuant ? quantRoundTrip(textVecs[q]) : textVecs[q]
    const scored = IMAGES.map((im) => {
      const iv = postQuant ? quantRoundTrip(imageVecs[im.id]) : imageVecs[im.id]
      return { id: im.id, cos: cosine(tv, iv) }
    }).sort((a, b) => b.cos - a.cos)
    const top1 = scored[0]
    const margin = scored[0].cos - scored[1].cos
    const ok = top1.id === expect
    if (ok) correct++
    rows.push({ q, expect, top1: top1.id, ok, margin: margin.toFixed(4), order: scored.map((x) => x.id).join('>') })
  }
  return { rows, acc: correct / QUERIES.length }
}

;(async () => {
  for (const p of [V_FP32, V_INT8, T_FP32, T_INT8, TOKENS]) if (!fs.existsSync(p)) { console.error('MISSING', p); process.exit(1) }
  const tokenMap = JSON.parse(fs.readFileSync(TOKENS, 'utf8'))
  const t0 = Date.now()
  const [imgFp32, imgInt8, txtFp32, txtInt8] = [
    await embedImages(V_FP32), await embedImages(V_INT8),
    await embedTexts(T_FP32, tokenMap), await embedTexts(T_INT8, tokenMap),
  ]
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  const A = rank(txtFp32, imgFp32, false)
  const B = rank(txtInt8, imgInt8, false)
  const Cs = rank(txtFp32, imgFp32, true)

  const report = (label, r) => {
    console.log(`\n=== ${label}  (top-1 acc=${(r.acc * 100).toFixed(0)}%) ===`)
    for (const x of r.rows) console.log(`  [${x.ok ? 'OK ' : 'MISS'}] "${x.q}"  expect=${x.expect} top1=${x.top1} margin=${x.margin}  | ${x.order}`)
  }
  report('A  fp32 塔 × fp32 塔', A)
  report('B  int8 塔 × int8 塔', B)
  report('C  存储 int8（×127 往返）', Cs)

  // 跨模态余弦是否落在合理区间（正样本 vs 负样本均值）
  const pos = QUERIES.map(({ q, expect }) => cosine(txtFp32[q], imgFp32[expect]))
  const neg = []
  for (const { q, expect } of QUERIES) for (const im of IMAGES) if (im.id !== expect) neg.push(cosine(txtFp32[q], imgFp32[im.id]))
  const mean = (a) => (a.reduce((s, x) => s + x, 0) / a.length)
  console.log(`\n[余弦分布 fp32] 正样本 mean=${mean(pos).toFixed(4)} min=${Math.min(...pos).toFixed(4)} | 负样本 mean=${mean(neg).toFixed(4)} max=${Math.max(...neg).toFixed(4)}`)
  console.log(`[int8 权重保真] 同图 fp32↔int8 余弦: ` + IMAGES.map((im) => `${im.id}=${cosine(imgFp32[im.id], imgInt8[im.id]).toFixed(4)}`).join(' '))
  console.log(`[int8 权重保真] 同文 fp32↔int8 余弦: ` + QUERIES.map((x) => cosine(txtFp32[x.q], txtInt8[x.q]).toFixed(4)).join(' '))
  const agreeAB = QUERIES.every(({ q }, i) => A.rows[i].top1 === B.rows[i].top1)
  const agreeAC = QUERIES.every((_, i) => A.rows[i].top1 === Cs.rows[i].top1)
  console.log(`\n[一致性] A vs B top-1 全一致=${agreeAB} | A vs C top-1 全一致=${agreeAC} | 耗时=${secs}s`)
})().catch((e) => { console.error('ERR', e); process.exit(1) })
