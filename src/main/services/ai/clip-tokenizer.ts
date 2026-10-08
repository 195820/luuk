/**
 * Phase 9 M5 · T22 — Node 端 CLIP 分词器（byte-level BPE，纯 JS，零原生/零新依赖）。
 *
 * 严格镜像 HF 快分词器（tokenizer.json）对 CLIP 的处理链，产出与 transformers.js 参照逐位一致的 token id：
 *  1) normalizer：NFC → `\s+`→单空格 → 小写
 *  2) pre_tokenizer：Split(OpenAI CLIP 正则, invert=true → 保留匹配、丢弃空白) → ByteLevel(byte→unicode)
 *  3) BPE：每个词元末符号追加 `</w>`（end_of_word_suffix），按 merges 秩自底向上贪心合并
 *  4) post_processor：cls=`<|startoftext|>`(49406) + sep=`<|endoftext|>`(49407)，补齐/截断到 77
 *
 * 数据源用 tokenizer.json（transformers.js 即据此产出黄金 fixture，单一权威源，避免 vocab/merges 双文件漂移）。
 * 顶层零依赖：文件读取由调用方（生产 ai-wiring / 测试）传入已解析对象，本模块纯计算。
 */

export const CLIP_SOT_ID = 49406
export const CLIP_EOT_ID = 49407
export const CLIP_CONTEXT = 77
const END_OF_WORD = '</w>'

/** GPT-2/CLIP byte→unicode 可见映射（可打印 ASCII 原样，其余映射到高位区） */
function buildByteToUnicode(): Map<number, string> {
  let bs: number[] = []
  for (let b = 33; b <= 126; b++) bs.push(b)
  for (let b = 161; b <= 172; b++) bs.push(b)
  for (let b = 174; b <= 255; b++) bs.push(b)
  const cs = [...bs]
  const inSet = new Set(bs)
  let n = 0
  for (let b = 0; b < 256; b++) {
    if (!inSet.has(b)) {
      bs.push(b)
      cs.push(256 + n)
      n++
    }
  }
  const map = new Map<number, string>()
  for (let i = 0; i < bs.length; i++) map.set(bs[i], String.fromCodePoint(cs[i]))
  return map
}

export interface ClipTokenizerData {
  /** 词元字符串 → id（含 `</w>` 后缀形态） */
  vocab: Record<string, number>
  /** 有序合并对，形如 "a b"（秩 = 下标） */
  merges: string[]
  /** pre_tokenizer 的 Split 正则源（缺省用 OpenAI CLIP 标准式） */
  pattern?: string
}

const DEFAULT_PATTERN =
  "<\\|startoftext\\|>|<\\|endoftext\\|>|'s|'t|'re|'ve|'m|'ll|'d|[\\p{L}]+|[\\p{N}]|[^\\s\\p{L}\\p{N}]+"

export class ClipTokenizer {
  private readonly byteToUnicode = buildByteToUnicode()
  private readonly vocab: Record<string, number>
  private readonly mergeRanks = new Map<string, number>()
  private readonly regex: RegExp

  constructor(data: ClipTokenizerData) {
    this.vocab = data.vocab
    data.merges.forEach((mk, rank) => {
      const sp = mk.indexOf(' ')
      if (sp < 0) return
      const left = mk.slice(0, sp)
      const right = mk.slice(sp + 1)
      this.mergeRanks.set(`${left}\u0001${right}`, rank)
    })
    this.regex = new RegExp(data.pattern ?? DEFAULT_PATTERN, 'gu')
  }

  /** 从 tokenizer.json 解析出的对象构造（model.vocab / model.merges / pre_tokenizer 正则） */
  static fromTokenizerJson(json: {
    model: { vocab: Record<string, number>; merges: string[] }
    pre_tokenizer?: { pretokenizers?: Array<{ pattern?: { Regex?: string } }> }
  }): ClipTokenizer {
    const pattern = json.pre_tokenizer?.pretokenizers?.[0]?.pattern?.Regex
    return new ClipTokenizer({ vocab: json.model.vocab, merges: json.model.merges, pattern })
  }

  /** 归一化：NFC → 折叠空白 → 小写 */
  private normalize(text: string): string {
    return text.normalize('NFC').replace(/\s+/g, ' ').toLowerCase()
  }

  /** 词元 → byte-level 符号数组（末符号加 `</w>`） */
  private toSymbols(word: string): string[] {
    const bytes = new TextEncoder().encode(word)
    const syms: string[] = []
    for (const b of bytes) syms.push(this.byteToUnicode.get(b)!)
    if (syms.length > 0) syms[syms.length - 1] += END_OF_WORD
    return syms
  }

  /** 单符号序列上的贪心 BPE（每轮取全局最小秩相邻对，合并其全部出现） */
  private bpe(symbols: string[]): string[] {
    let syms = symbols
    while (syms.length >= 2) {
      let bestRank = Infinity
      let best: [string, string] | null = null
      for (let i = 0; i < syms.length - 1; i++) {
        const r = this.mergeRanks.get(`${syms[i]}\u0001${syms[i + 1]}`)
        if (r !== undefined && r < bestRank) {
          bestRank = r
          best = [syms[i], syms[i + 1]]
        }
      }
      if (!best) break
      const [a, b] = best
      const out: string[] = []
      let i = 0
      while (i < syms.length) {
        if (i < syms.length - 1 && syms[i] === a && syms[i + 1] === b) {
          out.push(a + b)
          i += 2
        } else {
          out.push(syms[i])
          i += 1
        }
      }
      syms = out
    }
    return syms
  }

  /** 文本 → 定长 77 的 token id 序列（SOT 首位、EOT 收尾、pad=EOT） */
  encode(text: string): number[] {
    const pieces = this.normalize(text).match(this.regex) ?? []
    const content: number[] = []
    // 早停：保头截断只取决于前 CLIP_CONTEXT 个内容 token，超出的长查询不再参入 BPE（避免主进程 O(长文本) 阻塞）
    outer: for (const p of pieces) {
      for (const sym of this.bpe(this.toSymbols(p))) {
        const id = this.vocab[sym]
        content.push(id === undefined ? CLIP_EOT_ID : id)
        if (content.length >= CLIP_CONTEXT) break outer
      }
    }
    // 后处理：cls(SOT) + 内容 + sep(EOT)，再按 max_length=77 保头截断（超长时尾 EOT 被切掉，内容填满）
    const seq = [CLIP_SOT_ID, ...content, CLIP_EOT_ID]
    const ids = new Array<number>(CLIP_CONTEXT).fill(CLIP_EOT_ID)
    const cap = seq.length > CLIP_CONTEXT ? seq.slice(0, CLIP_CONTEXT) : seq
    for (let i = 0; i < cap.length; i++) ids[i] = cap[i]
    return ids
  }
}
