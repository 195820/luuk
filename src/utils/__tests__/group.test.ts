import { describe, it, expect } from 'vitest'
import { groupImages } from '../group'

describe('groupImages', () => {
  const sampleImages = [
    { id: 1, created_time: '2026-01-15T10:00:00Z', format: 'jpg', width: 1920, height: 1080 },
    { id: 2, created_time: '2026-01-15T12:00:00Z', format: 'png', width: 800, height: 600 },
    { id: 3, created_time: '2026-02-20T08:00:00Z', format: 'jpg', width: 600, height: 900 },
    { id: 4, created_time: '2026-02-20T15:00:00Z', format: 'webp', width: 1000, height: 500 },
    { id: 5, created_time: undefined, format: 'jpg', width: 100, height: 100 },
  ]

  it('none 模式返回单组包含所有图片', () => {
    const result = groupImages(sampleImages, 'none')
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('all')
    expect(result[0].items).toHaveLength(5)
  })

  it('day 模式按日期分组', () => {
    const result = groupImages(sampleImages, 'day')
    expect(result.length).toBeGreaterThan(1)
    // 应该包含 '2026-01-15', '2026-02-20', 'unknown-date' 三个组
    const keys = result.map(g => g.key)
    expect(keys).toContain('2026-01-15')
    expect(keys).toContain('2026-02-20')
    expect(keys).toContain('unknown-date')
    // 按日期倒序
    expect(result[0].key).toBe('unknown-date') // unknown 排最后（字典序）
  })

  it('month 模式按月份分组', () => {
    const result = groupImages(sampleImages, 'month')
    const keys = result.map(g => g.key)
    expect(keys).toContain('2026-01')
    expect(keys).toContain('2026-02')
    expect(keys).toContain('unknown-month')
  })

  it('format 模式按格式分组', () => {
    const result = groupImages(sampleImages, 'format')
    const keys = result.map(g => g.key)
    expect(keys).toContain('JPG')
    expect(keys).toContain('PNG')
    expect(keys).toContain('WEBP')
  })

  it('aspect 模式按纵横比分组', () => {
    const result = groupImages(sampleImages, 'aspect')
    const keys = result.map(g => g.key)
    expect(keys).toContain('landscape') // width >= height
    expect(keys).toContain('portrait')  // width < height
    // id:5 (100x100) 应该是 landscape（width >= height）
  })

  it('空数组返回空分组', () => {
    const result = groupImages([], 'day')
    expect(result).toHaveLength(1)
    expect(result[0].items).toHaveLength(0)
  })

  it('缺失字段归入 unknown 组', () => {
    const imagesWithMissing = [
      { id: 1, created_time: undefined, format: undefined, width: undefined, height: undefined },
    ]
    const dayResult = groupImages(imagesWithMissing, 'day')
    expect(dayResult[0].key).toBe('unknown-date')

    const formatResult = groupImages(imagesWithMissing, 'format')
    expect(formatResult[0].key).toBe('UNKNOWN')

    const aspectResult = groupImages(imagesWithMissing, 'aspect')
    expect(aspectResult[0].key).toBe('unknown-aspect')
  })

  it('组标签正确', () => {
    const result = groupImages(sampleImages, 'day')
    const unknownGroup = result.find(g => g.key === 'unknown-date')
    expect(unknownGroup?.label).toBe('未知日期')

    const landscapeGroup = groupImages(sampleImages, 'aspect').find(g => g.key === 'landscape')
    expect(landscapeGroup?.label).toBe('横向')
  })
})
