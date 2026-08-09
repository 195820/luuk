import { describe, it, expect } from 'vitest'
import { LRUCache } from '../main/services/cache'

describe('LRUCache', () => {
  it('set/get 基本操作', () => {
    const cache = new LRUCache(1)
    cache.set(1, 'medium', 'value1')
    expect(cache.get(1, 'medium')).toBe('value1')
  })

  it('has 检查存在', () => {
    const cache = new LRUCache(1)
    cache.set(1, 'medium', 'value1')
    expect(cache.has(1, 'medium')).toBe(true)
    expect(cache.has(2, 'medium')).toBe(false)
  })

  it('delete 删除条目', () => {
    const cache = new LRUCache(1)
    cache.set(1, 'medium', 'value1')
    expect(cache.delete(1, 'medium')).toBe(true)
    expect(cache.has(1, 'medium')).toBe(false)
  })

  it('delete 不存在条目返回 false', () => {
    const cache = new LRUCache(1)
    expect(cache.delete(99, 'medium')).toBe(false)
  })

  it('clear 清空缓存', () => {
    const cache = new LRUCache(1)
    cache.set(1, 'medium', 'v1')
    cache.set(2, 'medium', 'v2')
    cache.clear()
    expect(cache.get(1, 'medium')).toBeUndefined()
    expect(cache.get(2, 'medium')).toBeUndefined()
    expect(cache.getStats().count).toBe(0)
  })

  it('容量满时自动淘汰最久未使用的条目', () => {
    const cache = new LRUCache(0.00001) // 极小容量（约 10 字节）
    cache.set(1, 's', 'a'.repeat(50)) // 约 37 字节
    cache.set(2, 's', 'b'.repeat(50)) // 约 37 字节
    cache.set(3, 's', 'c'.repeat(50)) // 约 37 字节
    // 前两条应被挤出
    expect(cache.has(1, 's')).toBe(false)
    expect(cache.has(2, 's')).toBe(false)
    expect(cache.has(3, 's')).toBe(true)
  })

  it('get 更新访问时间（LRU 行为）', () => {
    const cache = new LRUCache(1) // 1 MB，足够容纳多条
    cache.set(1, 's', 'a')
    cache.set(2, 's', 'b')
    cache.set(3, 's', 'c')
    // 访问第 1 条，使其变为最近使用
    const val = cache.get(1, 's')
    expect(val).toBe('a')
    // keys 顺序反映 LRU：最近访问的在末尾
    const keys = cache.keys()
    expect(keys[keys.length - 1]).toBe('1:s')
  })

  it('getStats 返回正确统计', () => {
    const cache = new LRUCache(1)
    cache.set(1, 's', 'test')
    const stats = cache.getStats()
    expect(stats.count).toBe(1)
    expect(stats.maxSizeMB).toBe(1)
    expect(stats.sizeBytes).toBeGreaterThan(0)
  })

  it('keys 返回所有缓存键', () => {
    const cache = new LRUCache(1)
    cache.set(1, 's', 'a')
    cache.set(2, 'm', 'b')
    expect(cache.keys()).toEqual(['1:s', '2:m'])
  })

  it('相同键更新覆盖旧值', () => {
    const cache = new LRUCache(1)
    cache.set(1, 's', 'old')
    cache.set(1, 's', 'new')
    expect(cache.get(1, 's')).toBe('new')
    expect(cache.getStats().count).toBe(1)
  })
})
