// T22 黄金 token fixture 生成器：用 transformers.js（CLIPTokenizer，本地分词文件）对多样本（含边界）
// 编码为 pad 到 77 的 token id 序列，固化为测试用静态 JSON（此后测试不再依赖 transformers.js）。
// 独立进程跑（仅 transformers，不加载顶层 sharp，避免原生冲突）。
// 用法：node scripts/poc-t22/make-fixture.mjs
import fs from 'fs'
import path from 'path'
import { AutoTokenizer } from '@huggingface/transformers'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TOK = path.join(ROOT, 'cache', 'poc-r2', 'clip-token')
const OUT = path.join(ROOT, 'src', 'main', 'services', 'ai', '__tests__', '__fixtures__', 'clip-tokens.json')
const CONTEXT = 77

const samples = [
  'a photo of a cat',
  'a photo of a fluffy cat',
  'a bee collecting pollen on a pink flower',
  'a slice of baklava pastry dessert with pistachio',
  'a white bicycle parked on grass',
  'hello world',
  '',
  'Comprehensive, multi-modal representation!',
  'the quick brown fox jumps over the lazy dog',
  'naïve café — résumé',
  'endoftext',
  '  leading and trailing   spaces  ',
  'new\nline and\ttab',
  'word '.repeat(120),
]

;(async () => {
  const tok = await AutoTokenizer.from_pretrained(TOK)
  const out = {}
  for (const s of samples) {
    const enc = await tok(s, { padding: 'max_length', max_length: CONTEXT, truncation: true })
    const raw = enc.input_ids.data ? Array.from(enc.input_ids.data) : Array.from(enc.input_ids)
    out[s] = raw.map(Number)
    const key = JSON.stringify(s.length > 30 ? s.slice(0, 30) + '…' : s)
    console.log(`${key} -> len(nonpad-to-EOT)=${raw.indexOf(49407) + 1 || raw.length} head=${raw.slice(0, 6)}`)
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log('WROTE', OUT, Object.keys(out).length, 'samples')
})().catch((e) => { console.error('ERR', e); process.exit(1) })
