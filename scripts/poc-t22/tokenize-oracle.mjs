// T22 PoC R-b 参照实现：用 transformers.js 从本地分词文件产出 CLIP token id（作我实现的对齐基准）。
// 用法：node scripts/poc-t22/tokenize-oracle.mjs
import path from 'path'
import { AutoTokenizer } from '@huggingface/transformers'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TOK = path.join(ROOT, 'cache', 'poc-r2', 'clip-token')

const samples = ['a photo of a cat', 'a picture of a dog', 'a photo of a red car', 'hello world', 'cat']

;(async () => {
  const tok = await AutoTokenizer.from_pretrained(TOK)
  console.log('tokenizer type:', tok?.constructor?.name)
  console.log('model_input_names:', tok.model_input_names)
  for (const s of samples) {
    const enc = await tok(s, { padding: 'max_length', max_length: 77, truncation: true })
    const ids = enc.input_ids.data ? Array.from(enc.input_ids.data) : Array.from(enc.input_ids)
    const nz = ids.filter((x) => x !== 0)
    console.log(`\n[${s}] len(nonzero)=${nz.length} first8=${ids.slice(0, 8)} tail=${ids.slice(nz.length - 2, nz.length + 2)}`)
    console.log(`  decode(kept)=${await tok.decode(nz)}`)
  }
})().catch((e) => { console.error('ERR', e); process.exit(1) })
