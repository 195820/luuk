import { describe, it, expect } from 'vitest'
import { highlightMatch, getHighlightKeyword } from '../highlight'

/** 将 ReactNode[] 拍平为纯文本（验证不丢失内容、不注入 HTML） */
function toText(nodes: ReturnType<typeof highlightMatch>): string {
  return nodes
    .map((n) => {
      if (typeof n === 'string') return n
      if (n && typeof n === 'object' && 'props' in n) {
        const el = n as { props: { children?: unknown } }
        return String(el.props.children ?? '')
      }
      return ''
    })
    .join('')
}

describe('highlightMatch', () => {
  it('空关键词/纯空白关键词原样返回单节点', () => {
    expect(highlightMatch('photo.jpg', '')).toEqual(['photo.jpg'])
    expect(highlightMatch('photo.jpg', '   ')).toEqual(['photo.jpg'])
  })

  it('命中关键词时产出 <mark> 节点且内容完整还原', () => {
    const nodes = highlightMatch('sunset_beach.jpg', 'beach')
    expect(toText(nodes)).toBe('sunset_beach.jpg')
    const mark = nodes.find((n) => typeof n === 'object' && n && 'type' in n && n.type === 'mark')
    expect(mark).toBeTruthy()
  })

  it('大小写不敏感匹配', () => {
    const nodes = highlightMatch('Sunset_Beach.JPG', 'beach')
    const marks = nodes.filter((n) => typeof n === 'object' && n && 'type' in n && (n as { type: unknown }).type === 'mark')
    expect(marks).toHaveLength(1)
  })

  it('多次命中全部高亮', () => {
    const nodes = highlightMatch('cat_cat_cat', 'cat')
    const marks = nodes.filter((n) => typeof n === 'object' && n && 'type' in n && (n as { type: unknown }).type === 'mark')
    expect(marks).toHaveLength(3)
    expect(toText(nodes)).toBe('cat_cat_cat')
  })

  it('正则特殊字符关键词按字面量转义（不抛异常不误匹配）', () => {
    const nodes = highlightMatch('file[1].jpg', '[1]')
    expect(toText(nodes)).toBe('file[1].jpg')
    const marks = nodes.filter((n) => typeof n === 'object' && n && 'type' in n && (n as { type: unknown }).type === 'mark')
    expect(marks).toHaveLength(1)
    // 不抛异常即证明转义生效（未把关键词当 regex 语法编译失败）
    expect(() => highlightMatch('a+b*c', '+*')).not.toThrow()
  })

  it('XSS 防护：文件名含 <script> 时仅作为文本节点/children 渲染，不产生 HTML 注入', () => {
    const malicious = '<script>alert(1)</script>photo.jpg'
    const nodes = highlightMatch(malicious, 'photo')
    // React 元素树中脚本内容只存在于 children 字符串，序列化后仍被转义
    expect(toText(nodes)).toBe(malicious)
    expect(JSON.stringify(nodes)).not.toContain('dangerouslySetInnerHTML')
    // 文本节点本身是原始字符串，由 React 负责转义渲染
    const rawTexts = nodes.filter((n) => typeof n === 'string') as string[]
    expect(rawTexts.some((t) => t.includes('<script>'))).toBe(true)
  })
})

describe('getHighlightKeyword', () => {
  it('取 fileName 并 trim', () => {
    expect(getHighlightKeyword({ fileName: '  cat  ' })).toBe('cat')
  })

  it('无 fileName 返回空串', () => {
    expect(getHighlightKeyword({})).toBe('')
    expect(getHighlightKeyword({ fileName: undefined })).toBe('')
  })
})
