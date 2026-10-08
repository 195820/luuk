/**
 * Phase 9 M5 · T23 — AI 标签零样本建议（CLIP zero-shot，纯函数、纯 DI、零模型可测）。
 *
 * 链路口径（§2.3，D-2 决策）：候选词表 = 本库已有标签 ∪ 内置通用视觉类别；
 * prompt 模板 `"a photo of a {label}"` 经 TextEncoder（int8 量化，方向保真 → 与图像 int8
 * 直接算余弦，非对称精度只影响绝对尺度不影响排序）→ cosine → logits(×100) → softmax
 * → 阈值取 top-N。**只产建议，不写 image_tags**（Q7 人在回路，落库走提案采纳链）。
 *
 * 本文件顶层零原生依赖，vitest 可直接喂合成向量覆盖全链。
 */

/** 调参中心（仿 SCORER_PARAMS / QUALITY_PARAMS 风格） */
export const TAG_PARAMS = {
  /** CLIP 标准 logit 温度：logits = cosine × 100 后做 softmax */
  LOGIT_SCALE: 100,
  /** 建议最低置信度（softmax 概率），低于此值丢弃 */
  MIN_CONFIDENCE: 0.15,
  /** 单图最多建议数 */
  MAX_SUGGESTIONS: 5,
}

/**
 * 内置通用视觉类别（英文，与 CLIP 文本塔训练分布一致；中文词表留后续切片 §16 Q2）。
 */
export const BUILTIN_LABELS: readonly string[] = [
  'portrait', 'landscape', 'food', 'architecture', 'animal', 'plant',
  'artwork', 'screenshot', 'document', 'night', 'urban', 'nature',
  'vehicle', 'interior', 'water', 'sky', 'macro', 'beach', 'mountain',
  'forest', 'cityscape', 'street', 'sports', 'concert', 'party',
  'family', 'wedding', 'pet', 'bird', 'fish', 'insect', 'flower',
  'snow', 'sunset', 'fireworks', 'abstract', 'minimalist', 'vintage',
  'cartoon', 'map',
]

/** 标签候选 prompt 模板（CLIP zero-shot 惯例句式） */
export function buildLabelPrompt(label: string): string {
  return `a photo of a ${label.trim().toLowerCase()}`
}

/** 标签候选（词表项 + 编码用 prompt，promptVecs 与之 1:1 对应） */
export interface TagCandidate {
  tagName: string
  prompt: string
}

/** 单条建议：仅 {tagName, confidence}，不含任何写库语义 */
export interface TagSuggestion {
  tagName: string
  confidence: number
}

/**
 * 构建候选词表：已有标签 ∪ 内置类别，大小写不敏感去重（已有标签保原名优先）。
 */
export function buildTagCandidates(existingTagNames: string[]): TagCandidate[] {
  const seen = new Set<string>()
  const out: TagCandidate[] = []
  const push = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ tagName: trimmed, prompt: buildLabelPrompt(trimmed) })
  }
  for (const n of existingTagNames) push(n)
  for (const n of BUILTIN_LABELS) push(n)
  return out
}

/**
 * int8 字节视图（二补码）余弦：与 quantizeEmbedToInt8 产出对齐。
 * 长度不符视为编程错误直接抛（跨模型维度一致性由调用方 §9.7 绑定断言）。
 */
export function int8Cosine(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error(`int8Cosine 维度不符: ${a.length} vs ${b.length}`)
  const sa = new Int8Array(a.buffer, a.byteOffset, a.length)
  const sb = new Int8Array(b.buffer, b.byteOffset, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < sa.length; i++) {
    dot += sa[i] * sb[i]
    na += sa[i] * sa[i]
    nb += sb[i] * sb[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

/**
 * 零样本建议：cosine → softmax(logits×100) → 阈值 + top-N（置信度降序）。
 * candidates 与 promptVecs 必须 1:1；全候选 softmax（含未入选者），保证概率竞争语义。
 */
export function suggestTags(
  imageVec: Uint8Array,
  candidates: TagCandidate[],
  promptVecs: Uint8Array[],
): TagSuggestion[] {
  if (candidates.length === 0 || promptVecs.length !== candidates.length) {
    throw new Error(`suggestTags 入参不齐: candidates=${candidates.length} vecs=${promptVecs.length}`)
  }
  const logits = candidates.map((_, i) => int8Cosine(imageVec, promptVecs[i]) * TAG_PARAMS.LOGIT_SCALE)
  // 数值稳定 softmax
  const maxLogit = Math.max(...logits)
  const exps = logits.map((l) => Math.exp(l - maxLogit))
  const sum = exps.reduce((a, b) => a + b, 0)
  const out: TagSuggestion[] = []
  for (let i = 0; i < candidates.length; i++) {
    const p = exps[i] / sum
    if (p >= TAG_PARAMS.MIN_CONFIDENCE) {
      out.push({ tagName: candidates[i].tagName, confidence: Math.round(p * 1000) / 1000 })
    }
  }
  out.sort((a, b) => b.confidence - a.confidence)
  return out.slice(0, TAG_PARAMS.MAX_SUGGESTIONS)
}
