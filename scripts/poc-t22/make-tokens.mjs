// T22 PoC R-c 辅助：在「仅 transformers.js（不加载顶层 sharp）」的独立进程里，
// 用本地 CLIP 分词文件把查询文本编成 token id，落盘 tokens.json 供 cross-modal.mjs 读取。
// 之所以独立进程：transformers.js 自带嵌套 sharp，与主项目顶层 sharp 同进程加载会原生符号冲突。
// 用法：node scripts/poc-t22/make-tokens.mjs
import fs from 'fs'
import path from 'path'
import { AutoTokenizer } from '@huggingface/transformers'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TOK = path.join(ROOT, 'cache', 'poc-r2', 'clip-token')
const OUT = path.join(ROOT, 'cache', 'poc-t22', 'tokens.json')
const CONTEXT = 77

const QUERIES = [
  'a photo of a fluffy cat',
  'a bee collecting pollen on a pink flower',
  'a slice of baklava pastry dessert with pistachio',
  'a white bicycle parked on grass',
]

;(async () => {
  const tok = await AutoTokenizer.from_pretrained(TOK)
  const out = {}
  for (const q of QUERIES) {
    const enc = await tok(q, { padding: 'max_length', max_length: CONTEXT, truncation: true })
    const raw = enc.input_ids.data ? Array.from(enc.input_ids.data) : Array.from(enc.input_ids)
    out[q] = raw.map(Number)
    const nz = raw.filter((x) => Number(x) !== 0).length
    console.log(`[${q}] nonzero=${nz} head=${raw.slice(0, 8)}`)
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log('WROTE', OUT)
})().catch((e) => { console.error('ERR', e); process.exit(1) })
