// T22 PoC R-a：自省文本塔 ONNX 的输入/输出契约，判定 text_projection 是否已折叠（512）还是需手动投影（768）。
// 用法：node scripts/poc-t22/introspect.mjs
import path from 'path'
import ort from 'onnxruntime-node'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const P_INT8 = path.join(ROOT, 'cache', 'poc-r2', 'clip-text-b32-int8.onnx')
const P_FP32 = path.join(ROOT, 'cache', 'poc-r2', 'clip-text-b32-fp32.onnx')
const P_VIS = path.join(ROOT, 'cache', 'poc-r2', 'clip-vit-b32-int8.onnx')

const CONTEXT = 77
const SOT = 49406
const EOT = 49407

function dummyInput() {
  // 仅用于探形状：填充合法 id 范围，SOT 首位、EOT 第 6 位（模拟短句），其余 pad 0
  const ids = new BigInt64Array(CONTEXT)
  ids[0] = BigInt(SOT)
  ids[1] = 1547n // 任意合法 token
  ids[2] = BigInt(EOT)
  const mask = new BigInt64Array(CONTEXT)
  for (let i = 0; i < 3; i++) mask[i] = 1n
  return { input_ids: new ort.Tensor('int64', ids, [1, CONTEXT]), attention_mask: new ort.Tensor('int64', mask, [1, CONTEXT]) }
}

async function probe(label, file, feedAsText) {
  const s = await ort.InferenceSession.create(file)
  console.log(`\n=== ${label} ===`)
  console.log('inputs :', s.inputNames)
  console.log('outputs:', s.outputNames)
  try {
    const feed = feedAsText ? dummyInput() : {}
    if (!feedAsText) {
      // 视觉塔：喂一张极小 dummy pixel_values 只为看输出 dim
      const px = new Float32Array(1 * 3 * 224 * 224)
      feed.pixel_values = new ort.Tensor('float32', px, [1, 3, 224, 224])
    }
    const runFeed = {}
    for (const name of s.inputNames) if (feed[name]) runFeed[name] = feed[name]
    const res = await s.run(runFeed)
    for (const name of s.outputNames) {
      const t = res[name]
      console.log(`  out ${name}: dims=${JSON.stringify(t.dims)} type=${t.type} len=${t.data?.length}`)
    }
  } catch (e) {
    console.log('  (run skipped/failed:', e.message, ')')
  }
  if (s.release) await s.release()
}

;(async () => {
  await probe('TEXT int8', P_INT8, true)
  await probe('TEXT fp32', P_FP32, true)
  await probe('VISION int8 (参照)', P_VIS, false)
})().catch((e) => { console.error('ERR', e); process.exit(1) })
