/**
 * T11 — robots.txt 最小解析（§12.9 可配置尊重）
 * 只识别通配 UA（*）与当前爬虫 UA 的 Disallow 规则，够用即可，不做完整协议实现。
 * 纯函数，无依赖，单测直接喂文本。
 */

/** 支持的前缀匹配后缀通配：路径以 * 结尾表示前缀匹配 */
function toMatcher(rule: string): { prefix: string; exact: boolean; priority: number } {
  // 空规则（Disallow:）表示允许全部，调用侧过滤
  if (rule.endsWith('*')) {
    return { prefix: rule.slice(0, -1), exact: false, priority: rule.length - 1 }
  }
  return { prefix: rule, exact: true, priority: rule.length }
}

export interface RobotsDirectives {
  disallow: string[]
  allow: string[]
}

/**
 * 解析 robots.txt，抽取通用组（User-agent: * 或匹配本站 UA）的 allow/disallow 路径。
 * 解析失败或无匹配组返回空数组（等同不限制）。
 */
export function parseRobotsTxt(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const disallow: string[] = []
  let relevant = false
  for (const raw of lines) {
    const line = raw.split('#')[0].trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (field === 'user-agent') {
      // 命中 * 或 luuk 专属组即视为与己相关
      relevant = value === '*' || /luuk/i.test(value)
    } else if (relevant && field === 'disallow' && value) {
      disallow.push(value)
    }
  }
  return disallow
}

/**
 * 判定路径是否被允许。
 * 最具体匹配优先（robots 惯例）：更长的规则先决定；allow 与 disallow 同长时 allow 胜出。
 * @param disallow 来自 parseRobotsTxt 的禁止路径列表
 */
export function isAllowedByRobots(disallow: string[], pathname: string): boolean {
  let best: { matcher: ReturnType<typeof toMatcher>; allow: boolean } | null = null
  for (const rule of disallow) {
    const m = toMatcher(rule)
    if (pathname.startsWith(m.prefix)) {
      if (!best || m.priority > best.matcher.priority) {
        best = { matcher: m, allow: false }
      }
    }
  }
  return best === null ? true : best.allow
}
