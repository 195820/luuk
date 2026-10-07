// @vitest-environment node
/**
 * Phase 9 M5 · T22 — CLIP 分词器黄金对齐测（纯 JS，零原生）。
 *
 * 判据：自实现 ClipTokenizer 的输出，须与 transformers.js（HF 快分词器）对同一样本集产出的黄金 token id
 * 序列**逐位完全一致**。样本含边界：空串、纯标点/大小写、Unicode（重音 + 破折号）、控制字符（换行/制表）、
 * `endoftext` 字面、超长截断、多余空白。
 *
 * 黄金 fixture：src/main/services/ai/__tests__/__fixtures__/clip-tokens.json（由 scripts/poc-t22/make-fixture.mjs 生成固化）。
 * 分词数据源：src/main/services/ai/__tests__/__fixtures__/clip-tokenizer.json（入库裁剪 fixture，由 make-tokenizer-fixture.mjs 从 cache tokenizer.json 抽取 fromTokenizerJson 实读字段），故 CI/全新克隆也能实跑（不再依赖 gitignore 的 cache）。
 */
import { describe, it, expect } from 'vitest'
import { ClipTokenizer, CLIP_CONTEXT, CLIP_SOT_ID, CLIP_EOT_ID } from '../clip-tokenizer'
import fixture from './__fixtures__/clip-tokens.json'
import tokenizerJson from './__fixtures__/clip-tokenizer.json'

describe('T22 ClipTokenizer 黄金对齐（逐位比对 transformers.js 产出）', () => {
  const tok = ClipTokenizer.fromTokenizerJson(tokenizerJson as never)
  const samples = Object.entries(fixture as Record<string, number[]>)

  it(`fixture 覆盖 ${samples.length} 个样本`, () => {
    expect(samples.length).toBeGreaterThanOrEqual(14)
  })

  for (const [text, expected] of samples) {
    it(`对齐 ${JSON.stringify(text.length > 28 ? text.slice(0, 28) + '…' : text)}`, () => {
      const got = tok.encode(text)
      expect(got.length).toBe(CLIP_CONTEXT)
      expect(got).toEqual(expected)
    })
  }

  it('结构不变量：首=SOT、其余至多一处 EOT 收尾后全 pad(EOT)', () => {
    const ids = tok.encode('a photo of a cat')
    expect(ids[0]).toBe(CLIP_SOT_ID)
    const firstEot = ids.indexOf(CLIP_EOT_ID, 1)
    expect(firstEot).toBeGreaterThan(0)
    for (let i = firstEot; i < CLIP_CONTEXT; i++) expect(ids[i]).toBe(CLIP_EOT_ID)
  })

  // 回归锁：词表 miss（无 byte_fallback/fuse_unk）按 HF 声明的 unk_token=<|endoftext|> 回落为 EOT，非 '!'/0。
  // 此 CLIP 变体 vocab 无 Ġ 空格 token（pre_tokenizer 丢弃空白）。
  // 用空词表确定性触发该防御分支（真实 byte-level 词表覆盖全字节，正常情况下不命中 miss）。
  it('词表 miss 回落 unk_token=EOT(49407)（防御分支，对齐 HF 而非 0）', () => {
    const emptyTok = new ClipTokenizer({ vocab: {}, merges: [] })
    const ids = emptyTok.encode('cat')
    expect(ids[0]).toBe(CLIP_SOT_ID)
    expect(ids.slice(1).every((id) => id === CLIP_EOT_ID)).toBe(true)
  })
})
