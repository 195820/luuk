import type { ReactNode } from 'react'

/**
 * 高亮文本中匹配的关键词（React 节点方案，避免 XSS）
 * @param text 原始文本
 * @param keyword 要高亮的关键词
 * @returns React 节点数组，匹配部分用 <mark> 包裹
 */
export function highlightMatch(text: string, keyword: string): ReactNode[] {
  if (!keyword || !keyword.trim()) return [text]

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))

  return parts.map((part, i) => {
    if (part.toLowerCase() === keyword.toLowerCase()) {
      return (
        <mark
          key={i}
          className="bg-accent/40 text-foreground rounded-sm px-0.5"
        >
          {part}
        </mark>
      )
    }
    return part
  })
}

/**
 * 从搜索条件中提取用于高亮的关键词（目前仅支持 fileName）
 * @param criteria 搜索条件
 * @returns 高亮关键词，无则返回空字符串
 */
export function getHighlightKeyword(criteria: { fileName?: string }): string {
  return (criteria.fileName || '').trim()
}
