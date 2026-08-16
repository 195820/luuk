import { describe, it, expect } from 'vitest'
import {
  extractTextAndNumber,
  extractText,
  extractNumber,
  comparePathStrings,
  sortImages,
  sortFavoriteImages,
} from '../utils/sort'

describe('extractTextAndNumber', () => {
  it('提取括号中的数字', () => {
    expect(extractTextAndNumber('屏幕截图 (10).jpg')).toEqual({ text: '屏幕截图', number: 10 })
  })

  it('提取末尾数字', () => {
    expect(extractTextAndNumber('IMG_001.jpg')).toEqual({ text: 'IMG_', number: 1 })
  })

  it('无数字时返回 0', () => {
    expect(extractTextAndNumber('风景.jpg')).toEqual({ text: '风景', number: 0 })
  })

  it('处理带路径的文件名', () => {
    expect(extractTextAndNumber('/path/to/IMG_002.jpg')).toEqual({ text: 'IMG_', number: 2 })
  })

  it('处理 Windows 路径', () => {
    expect(extractTextAndNumber('C:\\Photos\\IMG_003.jpg')).toEqual({ text: 'IMG_', number: 3 })
  })
})

describe('extractText / extractNumber', () => {
  it('extractText 返回文本部分', () => {
    expect(extractText('IMG_001.jpg')).toBe('IMG_')
  })

  it('extractNumber 返回数字部分', () => {
    expect(extractNumber('IMG_001.jpg')).toBe(1)
  })
})

describe('comparePathStrings', () => {
  it('ASC 升序排序', () => {
    const arr = ['IMG_003', 'IMG_001', 'IMG_002']
    arr.sort((a, b) => comparePathStrings(a, b, 'ASC'))
    expect(arr).toEqual(['IMG_001', 'IMG_002', 'IMG_003'])
  })

  it('DESC 降序排序', () => {
    const arr = ['IMG_001', 'IMG_003', 'IMG_002']
    arr.sort((a, b) => comparePathStrings(a, b, 'DESC'))
    expect(arr).toEqual(['IMG_003', 'IMG_002', 'IMG_001'])
  })

  it('自然排序：数字部分按数值排序', () => {
    const arr = ['IMG_10', 'IMG_2', 'IMG_1']
    arr.sort((a, b) => comparePathStrings(a, b, 'ASC'))
    expect(arr).toEqual(['IMG_1', 'IMG_2', 'IMG_10'])
  })
})

describe('sortImages', () => {
  const images = [
    { relative_path: 'b/IMG_002.jpg', file_size: 200, width: 100, height: 100 },
    { relative_path: 'a/IMG_001.jpg', file_size: 100, width: 200, height: 200 },
    { relative_path: 'c/IMG_003.jpg', file_size: 300, width: 150, height: 150 },
  ]

  it('按 relative_path 升序', () => {
    const sorted = sortImages(images, 'relative_path', 'ASC')
    expect(sorted[0].relative_path).toBe('a/IMG_001.jpg')
    expect(sorted[2].relative_path).toBe('c/IMG_003.jpg')
  })

  it('按 file_size 降序', () => {
    const sorted = sortImages(images, 'file_size', 'DESC')
    expect(sorted[0].file_size).toBe(300)
    expect(sorted[2].file_size).toBe(100)
  })

  it('按 width 升序', () => {
    const sorted = sortImages(images, 'width', 'ASC')
    expect(sorted[0].width).toBe(100)
  })

  it('不修改原数组', () => {
    const original = [...images]
    sortImages(images, 'relative_path', 'ASC')
    expect(images).toEqual(original)
  })

  it('按评分降序（0-5 星）', () => {
    const rated = [
      { relative_path: 'a.jpg', rating: 2 },
      { relative_path: 'b.jpg', rating: 5 },
      { relative_path: 'c.jpg', rating: 0 },
      { relative_path: 'd.jpg', rating: 5 },
    ]
    const sorted = sortImages(rated, 'rating', 'DESC')
    expect(sorted[0].rating).toBe(5)
    expect(sorted[2].rating).toBe(2)
    expect(sorted[3].rating).toBe(0)
  })
})

describe('sortFavoriteImages', () => {
  it('委托给 sortImages 工作', () => {
    const images = [
      { relative_path: 'b.jpg', file_size: 200, width: 100, height: 100 },
      { relative_path: 'a.jpg', file_size: 100, width: 200, height: 200 },
    ]
    const sorted = sortFavoriteImages(images, 'relative_path', 'ASC')
    expect(sorted[0].relative_path).toBe('a.jpg')
  })
})
