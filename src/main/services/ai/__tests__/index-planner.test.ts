import { describe, it, expect } from 'vitest'
import path from 'path'
import { planPendingImages, toAbsolutePath, type IndexableImage } from '../index-planner'

describe('planPendingImages（Phase 9 M5 · T21 增量计划）', () => {
  const imgs: IndexableImage[] = [
    { id: 1, relativePath: 'a/1.jpg' },
    { id: 2, relativePath: 'a/2.jpg' },
    { id: 3, relativePath: 'a/3.jpg' },
  ]

  it('剔除已干净嵌入的 id，保序返回待嵌', () => {
    expect(planPendingImages(imgs, new Set([2]))).toEqual([1, 3])
  })

  it('全部已嵌入 → 空（无脏活）', () => {
    expect(planPendingImages(imgs, new Set([1, 2, 3]))).toEqual([])
  })

  it('全新库（indexed 空）→ 全部待嵌', () => {
    expect(planPendingImages(imgs, new Set())).toEqual([1, 2, 3])
  })

  it('空图片列表 → 空', () => {
    expect(planPendingImages([], new Set([1]))).toEqual([])
  })
})

describe('toAbsolutePath（分隔符归一拼接）', () => {
  it('root 与 relative 用平台分隔符拼接', () => {
    expect(toAbsolutePath(path.join('D:', 'lib'), 'a/b.jpg')).toBe(path.join('D:', 'lib', 'a', 'b.jpg'))
  })
})
