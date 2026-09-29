/**
 * T11 — robots.txt 最小解析单测
 */
import { describe, it, expect } from 'vitest'
import { parseRobotsTxt, isAllowedByRobots } from '../robots'

describe('parseRobotsTxt', () => {
  it('抽取通用组 Disallow，忽略 Allow 与其他 UA 组', () => {
    const rules = parseRobotsTxt([
      'User-agent: *',
      'Disallow: /private/',
      'Allow: /private/ok.html',
      'Disallow: /admin',
      '# 注释行 Disallow: /nope',
      '',
      'User-agent: googlebot',
      'Disallow: /google-only',
    ].join('\n'))
    expect(rules).toEqual(['/private/', '/admin'])
  })

  it('luuk 专属 UA 组同样生效', () => {
    const rules = parseRobotsTxt('User-agent: luuk-bot\nDisallow: /members\n')
    expect(rules).toEqual(['/members'])
  })

  it('空 Disallow 表示全允许', () => {
    expect(parseRobotsTxt('User-agent: *\nDisallow:\n')).toEqual([])
  })

  it('乱输入不抛错（等同无限制）', () => {
    expect(parseRobotsTxt('garbage\n::::\n')).toEqual([])
  })
})

describe('isAllowedByRobots', () => {
  it('前缀命中即禁，未命中允许', () => {
    expect(isAllowedByRobots(['/private/'], '/private/a.jpg')).toBe(false)
    expect(isAllowedByRobots(['/private/'], '/public/a.jpg')).toBe(true)
  })

  it('通配 * 截断为前缀匹配', () => {
    expect(isAllowedByRobots(['/secret*'], '/secret/1')).toBe(false)
  })

  it('空规则集全允许', () => {
    expect(isAllowedByRobots([], '/anything')).toBe(true)
  })
})
