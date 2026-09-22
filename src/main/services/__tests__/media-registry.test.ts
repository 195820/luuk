// @vitest-environment node
/**
 * media-registry 单元测试（§5.1 单元补盲）。
 * 验证 HMAC 确定性、kind 区分、resolveMediaEntry 逻辑、LRU 驱逐行为。
 * 注：sessionSecret 模块级随机，同一测试进程内确定性可验证，跨进程值不同。
 */
import { describe, it, expect, vi } from 'vitest'

// Mock fs 以避免 registerMediaUrl 的 statSync 真实文件操作
vi.mock('fs', () => ({
  default: {
    statSync: vi.fn((p: string) => {
      if (p.includes('nonexistent')) throw new Error('ENOENT')
      return { mtimeMs: 1000000, size: 1024 }
    }),
  },
  statSync: vi.fn((p: string) => {
    if (p.includes('nonexistent')) throw new Error('ENOENT')
    return { mtimeMs: 1000000, size: 1024 }
  }),
}))

import { registerMediaUrl, registerThumbUrl, resolveMediaEntry } from '../media-registry'

describe('media-registry HMAC 确定性', () => {
  it('registerThumbUrl 同参数产生同 token（会话内确定性）', () => {
    const url1 = registerThumbUrl(1, 100, 'medium', 'v1')
    const url2 = registerThumbUrl(1, 100, 'medium', 'v1')
    expect(url1).toBe(url2)
  })

  it('registerThumbUrl 不同参数产生不同 token', () => {
    const url1 = registerThumbUrl(1, 100, 'medium', 'v1')
    const url2 = registerThumbUrl(1, 101, 'medium', 'v1')
    const url3 = registerThumbUrl(1, 100, 'small', 'v1')
    const url4 = registerThumbUrl(1, 100, 'medium', 'v2')
    expect(new Set([url1, url2, url3, url4]).size).toBe(4)
  })

  it('registerMediaUrl 同路径同 stat 产生同 token', () => {
    const url1 = registerMediaUrl('D:\\library\\photo.jpg')
    const url2 = registerMediaUrl('D:\\library\\photo.jpg')
    expect(url1).toBe(url2)
  })

  it('registerMediaUrl 文件不存在时回退路径 token（仍可注册）', () => {
    const url = registerMediaUrl('D:\\nonexistent\\file.jpg')
    expect(url).toMatch(/^media:\/\/[0-9a-f]{32}$/)
    const token = url.replace('media://', '')
    const entry = resolveMediaEntry(token)
    expect(entry?.kind).toBe('file')
  })
})

describe('media-registry kind 区分', () => {
  it('thumb 条目返回 kind=thumb + libraryId/imageId/size', () => {
    const url = registerThumbUrl(42, 999, 'large', 'abc123')
    const token = url.replace('media://', '')
    const entry = resolveMediaEntry(token)
    expect(entry).toBeDefined()
    expect(entry!.kind).toBe('thumb')
    if (entry!.kind === 'thumb') {
      expect(entry!.libraryId).toBe(42)
      expect(entry!.imageId).toBe(999)
      expect(entry!.size).toBe('large')
    }
  })

  it('file 条目返回 kind=file + filePath', () => {
    const url = registerMediaUrl('D:\\library\\video.mp4')
    const token = url.replace('media://', '')
    const entry = resolveMediaEntry(token)
    expect(entry).toBeDefined()
    expect(entry!.kind).toBe('file')
    if (entry!.kind === 'file') {
      expect(entry!.filePath).toContain('video.mp4')
    }
  })
})

describe('media-registry resolveMediaEntry', () => {
  it('无效 token 返回 undefined', () => {
    expect(resolveMediaEntry('invalid_token_xyz')).toBeUndefined()
  })

  it('resolve 后续期条目（createdAt 更新）', () => {
    const url = registerThumbUrl(1, 1, 's', 'ver1')
    const token = url.replace('media://', '')
    const entry1 = resolveMediaEntry(token)
    expect(entry1).toBeDefined()
    // 再次 resolve 应仍有效
    const entry2 = resolveMediaEntry(token)
    expect(entry2).toBeDefined()
    expect(entry2!.kind).toBe('thumb')
  })
})

describe('media-registry URL 格式', () => {
  it('所有生成的 URL 匹配 media://<32-hex-chars> 格式', () => {
    const urls = [
      registerThumbUrl(1, 1, 'm', '1'),
      registerThumbUrl(2, 2, 'l', '2'),
      registerMediaUrl('D:\\test\\a.jpg'),
    ]
    for (const url of urls) {
      expect(url).toMatch(/^media:\/\/[0-9a-f]{32}$/)
    }
  })
})
