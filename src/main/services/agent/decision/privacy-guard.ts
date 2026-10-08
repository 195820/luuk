/**
 * T10 — 隐私护栏（D9 落地为宿主侧强制代码约束）
 *
 * Jev 是云端 API，发往远端的 state 只允许**文本元数据白名单**（标签、文件名 stem、
 * 候选项文本描述、结构化选项）。本模块在宿主适配器出站前过滤，不依赖插件自觉：
 * - 疑似绝对路径 / UNC 路径 / POSIX 路径 → 剔除
 * - 疑似 base64 或 data URL（长串） → 剔除
 * - 嵌入向量类长数值数组 → 剔除
 * - 敏感字段名（embedding / phash / filePath / gps / exif / 凭据类） → 整个字段剔除
 *
 * 策略：**逐字段剔除并留痕**，不因单个脏字段阻断整个判断（可用性优先），
 * 过滤后 state 为空时由适配器判定不可用并回落本地规则。
 */
import type { DecisionContext } from '../../../../types/agent'

/** 护栏超参与黑名单：集中定义便于审计与调参 */
export const PRIVACY_GUARD_PARAMS = {
  /** 单字符串长度上限（超过视为 base64/二进制片段等疑似图片数据） */
  MAX_STRING_LENGTH: 1024,
  /** 数值数组长度上限（超过视为 embedding 向量） */
  MAX_NUMBER_ARRAY_LENGTH: 64,
  /**
   * 敏感字段名黑名单：比对前字段名会做归一化（小写 + 去非字母数字），
   * 故 filePath / file_path / ABSOLUTE.PATH 均命中；keywords 不误伤
   */
  BLOCKED_FIELDS: [
    'embedding',
    'embeddings',
    'vector',
    'vectors',
    'phash',
    'hash',
    'filepath',
    'fullpath',
    'absolutepath',
    'path',
    'dir',
    'directory',
    'image',
    'imagebytes',
    'thumbnail',
    'base64',
    'dataurl',
    'gps',
    'gpslat',
    'gpslon',
    'latitude',
    'longitude',
    'location',
    'exif',
    'apikey',
    'token',
    'secret',
    'password',
    'cookie',
    'authorization',
  ] as readonly string[],
} as const

/** 被剔除的一项：路径（对象层级定位）与原因 */
export interface RejectedField {
  path: string
  reason: string
}

export interface StateFilterResult {
  state: Record<string, unknown>
  rejected: RejectedField[]
}

/** 字段名归一化：小写并去掉分隔符，便于黑名单精确匹配 */
export function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 字段名是否命中黑名单 */
export function isBlockedFieldName(name: string): boolean {
  return (PRIVACY_GUARD_PARAMS.BLOCKED_FIELDS as readonly string[]).includes(normalizeFieldName(name))
}

/** 疑似文件系统路径（Windows 盘符 / UNC / POSIX 绝对路径） */
export function looksLikePath(value: string): boolean {
  const trimmed = value.trim()
  if (/^[a-z]:[\\/]/i.test(trimmed)) return true          // C:\ 或 C:/
  if (trimmed.startsWith('\\\\')) return true              // UNC
  if (/^\/[^/]+\/.*/.test(trimmed)) return true            // /usr/xxx、/mnt/d/xxx
  if (/^~[\\/]/.test(trimmed)) return true                 // ~/xxx
  return false
}

/** 疑似内联图片数据（data URL 或长 base64 片段） */
export function looksLikeBinaryBlob(value: string): boolean {
  const trimmed = value.trim()
  if (/^data:[^;]+;base64/i.test(trimmed)) return true
  if (trimmed.length > 256 && /^[A-Za-z0-9+/=\s]+$/.test(trimmed) && !/\s/.test(trimmed)) return true
  return false
}

/** 字符串是否可出站 */
function isStringAllowed(value: string): { ok: boolean; reason?: string } {
  if (value.length > PRIVACY_GUARD_PARAMS.MAX_STRING_LENGTH) {
    return { ok: false, reason: `超长字符串（${value.length} > ${PRIVACY_GUARD_PARAMS.MAX_STRING_LENGTH}）疑似二进制` }
  }
  if (looksLikePath(value)) return { ok: false, reason: '疑似文件路径' }
  if (looksLikeBinaryBlob(value)) return { ok: false, reason: '疑似 base64/内联图片' }
  return { ok: true }
}

/**
 * 递归过滤单个值
 * @returns 可出站的克隆值；null 表示该字段应被剔除（配合 reason 留痕）
 */
function filterValue(value: unknown, path: string, rejected: RejectedField[]): { keep: boolean; value?: unknown } {
  if (value === null || value === undefined) return { keep: false }

  if (typeof value === 'string') {
    const check = isStringAllowed(value)
    if (!check.ok) {
      rejected.push({ path, reason: check.reason ?? '字符串不满足出站白名单' })
      return { keep: false }
    }
    return { keep: true, value }
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? { keep: true, value } : { keep: false }
  }

  if (typeof value === 'boolean') return { keep: true, value }

  if (Array.isArray(value)) {
    // 长数值数组：嵌入向量的典型形态
    if (value.every(v => typeof v === 'number') && value.length > PRIVACY_GUARD_PARAMS.MAX_NUMBER_ARRAY_LENGTH) {
      rejected.push({ path, reason: `数值数组过长（${value.length} > ${PRIVACY_GUARD_PARAMS.MAX_NUMBER_ARRAY_LENGTH}）疑似嵌入向量` })
      return { keep: false }
    }
    const kept: unknown[] = []
    for (let i = 0; i < value.length; i++) {
      const item = filterValue(value[i], `${path}[${i}]`, rejected)
      if (item.keep) kept.push(item.value)
    }
    return kept.length > 0 ? { keep: true, value: kept } : { keep: false }
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`
      if (isBlockedFieldName(key)) {
        rejected.push({ path: childPath, reason: `字段名命中敏感黑名单（${key}）` })
        continue
      }
      const filtered = filterValue(v, childPath, rejected)
      if (filtered.keep) out[key] = filtered.value
    }
    return Object.keys(out).length > 0 ? { keep: true, value: out } : { keep: false }
  }

  // function / symbol / bigint 等一律不出站
  rejected.push({ path, reason: `不支持的值类型（${typeof value}）` })
  return { keep: false }
}

/** 过滤 state：返回可出站副本与被剔除字段清单 */
export function filterStateForRemote(state: Record<string, unknown>): StateFilterResult {
  const rejected: RejectedField[] = []
  const result = filterValue(state, 'state', rejected)
  return {
    state: result.keep ? (result.value as Record<string, unknown>) : {},
    rejected,
  }
}

/**
 * 过滤整个 DecisionContext 的问题定义
 * instructions/criteria 文本同样可能带路径（如文件名 stem 拼的绝对路径），一并按规则剔除
 */
export function filterContextForRemote(ctx: DecisionContext): { questions: DecisionContext['questions']; rejected: RejectedField[] } {
  const rejected: RejectedField[] = []
  const questions: DecisionContext['questions'] = {}

  for (const [key, q] of Object.entries(ctx.questions)) {
    const instructions = filterValue(q.instructions, `questions.${key}.instructions`, rejected)
    const safeInstructions = typeof instructions.value === 'string' ? instructions.value : ''
    if (instructions.keep === false) {
      // 指令文本被整体剔除的问题没有意义，丢弃该题
      continue
    }
    if (q.type === 'choice') {
      const criteria: Record<string, string | null> = {}
      for (const [opt, desc] of Object.entries(q.criteria)) {
        if (isBlockedFieldName(opt)) {
          rejected.push({ path: `questions.${key}.criteria.${opt}`, reason: `选项名命中敏感黑名单（${opt}）` })
          continue
        }
        const d = desc === null ? { keep: true, value: null as unknown } : filterValue(desc, `questions.${key}.criteria.${opt}`, rejected)
        criteria[opt] = d.keep ? (d.value as string | null) : null
      }
      if (Object.keys(criteria).length > 0) {
        questions[key] = { type: 'choice', instructions: safeInstructions, criteria }
      }
    } else if (q.type === 'score') {
      const criteria: string[] = []
      q.criteria.forEach((c, i) => {
        const r = filterValue(c, `questions.${key}.criteria[${i}]`, rejected)
        if (r.keep) criteria.push(r.value as string)
      })
      if (criteria.length > 0) questions[key] = { type: 'score', instructions: safeInstructions, criteria }
    } else {
      questions[key] = { type: 'noul', instructions: safeInstructions }
    }
  }

  return { questions, rejected }
}

/** 合并后的整体过滤入口：适配器只需调用这一个 */
export function filterDecisionContextForRemote(ctx: DecisionContext): {
  state: Record<string, unknown>
  questions: DecisionContext['questions']
  rejected: RejectedField[]
} {
  const stateResult = filterStateForRemote(ctx.state)
  const questionsResult = filterContextForRemote(ctx)
  return {
    state: stateResult.state,
    questions: questionsResult.questions,
    rejected: [...stateResult.rejected, ...questionsResult.rejected],
  }
}
