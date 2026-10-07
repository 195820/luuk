// 从 cache/poc-r2/clip-token/tokenizer.json 抽取 ClipTokenizer.fromTokenizerJson 实际读取的字段，
// 固化为入库 fixture（使纯 JS BPE 黄金对齐测在 CI/全新克隆上可跑，不再依赖 gitignore 的 cache 资产）。
// 用法：node scripts/poc-t22/make-tokenizer-fixture.mjs
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SRC = path.join(ROOT, 'cache', 'poc-r2', 'clip-token', 'tokenizer.json')
const OUT = path.join(ROOT, 'src', 'main', 'services', 'ai', '__tests__', '__fixtures__', 'clip-tokenizer.json')

const j = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const pattern = j.pre_tokenizer?.pretokenizers?.[0]?.pattern?.Regex
const trimmed = {
  model: { vocab: j.model.vocab, merges: j.model.merges },
  pre_tokenizer: { pretokenizers: [{ pattern: { Regex: pattern } }] },
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(trimmed))
console.log(
  'WROTE', OUT,
  'vocab=', Object.keys(trimmed.model.vocab).length,
  'merges=', trimmed.model.merges.length,
  'pattern?', !!pattern,
  'bytes=', fs.statSync(OUT).size,
)
