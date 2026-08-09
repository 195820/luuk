import { describe, it, expect } from 'vitest'
import { formatFileSize } from '../utils/format'

describe('formatFileSize', () => {
  it('null/undefined/0 返回空字符串', () => {
    expect(formatFileSize(null)).toBe('')
    expect(formatFileSize(undefined)).toBe('')
    expect(formatFileSize(0)).toBe('')
  })

  it('字节', () => {
    expect(formatFileSize(500)).toBe('500 B')
  })

  it('KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('MB', () => {
    expect(formatFileSize(1048576)).toBe('1 MB')
    expect(formatFileSize(2621440)).toBe('2.5 MB')
  })

  it('GB', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB')
  })

  it('自定义精度', () => {
    expect(formatFileSize(1536, 1)).toBe('1.5 KB')
    expect(formatFileSize(1536, 0)).toBe('2 KB')
  })
})
