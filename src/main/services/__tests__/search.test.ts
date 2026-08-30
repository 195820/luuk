import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// 在导入 database.ts 前模拟 electron 模块（仅 MasterDB 用到 app，此处占位即可）
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { ThumbnailsDB, MasterDB } from '../database'

/**
 * 测试辅助：创建临时目录并初始化 ThumbnailsDB
 */
function createTestDB(): { db: ThumbnailsDB; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-search-test-'))
  const db = new ThumbnailsDB()
  db.initialize(tmpDir)
  return { db, tmpDir }
}

/**
 * 插入测试图片数据（直接准备 known 数据集）
 */
function seedImages(db: ThumbnailsDB): void {
  db.addImages([
    {
      relative_path: 'photos/IMG_001.jpg',
      file_hash: 'aaa111',
      width: 1920, height: 1080,
      file_size: 500_000,
      format: 'jpg',
      modified_time: '2026-01-15T10:00:00Z',
      media_type: 'image',
    },
    {
      relative_path: 'photos/IMG_002.png',
      file_hash: 'aaa222',
      width: 800, height: 600,
      file_size: 120_000,
      format: 'png',
      modified_time: '2026-02-20T12:00:00Z',
      media_type: 'image',
    },
    {
      relative_path: 'videos/clip.mp4',
      file_hash: 'aaa333',
      width: 1280, height: 720,
      file_size: 5_000_000,
      format: 'mp4',
      modified_time: '2026-03-01T08:00:00Z',
      media_type: 'video',
      duration: 30,
      codec: 'h264',
    },
    {
      relative_path: 'photos/portrait.webp',
      file_hash: 'aaa444',
      width: 600, height: 900,
      file_size: 80_000,
      format: 'webp',
      modified_time: '2026-04-10T15:00:00Z',
      media_type: 'image',
    },
    {
      relative_path: 'photos/landscape.jpg',
      file_hash: 'aaa555',
      width: 3000, height: 2000,
      file_size: 2_000_000,
      format: 'jpg',
      modified_time: '2026-05-05T09:00:00Z',
      created_time: '2026-05-05',
      media_type: 'image',
    },
  ])
}

describe('ThumbnailsDB.searchImages', () => {
  let db: ThumbnailsDB
  let tmpDir: string

  beforeAll(() => {
    const ctx = createTestDB()
    db = ctx.db
    tmpDir = ctx.tmpDir
    seedImages(db)
  })

  afterAll(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('空条件返回全量（is_deleted=0）', () => {
    const { images, total } = db.searchImages({}, { limit: 100, offset: 0 })
    expect(total).toBe(5)
    expect(images).toHaveLength(5)
  })

  it('文件名模糊匹配', () => {
    const { images, total } = db.searchImages({ fileName: 'IMG' }, { limit: 100, offset: 0 })
    expect(total).toBe(2)
    expect(images.map(i => i.relative_path).sort()).toEqual([
      'photos/IMG_001.jpg',
      'photos/IMG_002.png',
    ])
  })

  it('格式过滤（多格式）', () => {
    const { images, total } = db.searchImages({ formats: ['jpg', 'webp'] }, { limit: 100, offset: 0 })
    expect(total).toBe(3)
    const formats = images.map(i => i.format).sort()
    expect(formats).toEqual(['jpg', 'jpg', 'webp'])
  })

  it('宽度范围', () => {
    const { total } = db.searchImages({ minWidth: 1000 }, { limit: 100, offset: 0 })
    // 1920, 1280, 3000 → 3 条
    expect(total).toBe(3)
  })

  it('高度范围', () => {
    const { total } = db.searchImages({ minHeight: 800 }, { limit: 100, offset: 0 })
    // 1080, 900, 2000 → 3 条
    expect(total).toBe(3)
  })

  it('文件大小范围', () => {
    const { total } = db.searchImages(
      { minFileSize: 100_000, maxFileSize: 1_000_000 },
      { limit: 100, offset: 0 }
    )
    // 500_000, 120_000 → 2 条（80_000 低于下限，2M 和 5M 高于上限）
    expect(total).toBe(2)
  })

  it('拍摄日期范围', () => {
    const { images, total } = db.searchImages(
      { createdFrom: '2026-05-01', createdTo: '2026-05-31' },
      { limit: 100, offset: 0 }
    )
    // 仅 landscape.jpg 有 created_time = '2026-05-05'
    expect(total).toBe(1)
    expect(images[0].relative_path).toBe('photos/landscape.jpg')
  })

  it('媒体类型过滤', () => {
    const { images, total } = db.searchImages({ mediaType: 'video' }, { limit: 100, offset: 0 })
    expect(total).toBe(1)
    expect(images[0].relative_path).toBe('videos/clip.mp4')
  })

  it('组合条件：格式 + 宽度', () => {
    const { total } = db.searchImages(
      { formats: ['jpg'], minWidth: 1000 },
      { limit: 100, offset: 0 }
    )
    // jpg 且 width>=1000 → IMG_001(1920) + landscape(3000) = 2
    expect(total).toBe(2)
  })

  it('收藏路径交集：命中', () => {
    const { images, total } = db.searchImages(
      { favoritePaths: ['photos/IMG_001.jpg', 'photos/portrait.webp'] },
      { limit: 100, offset: 0 }
    )
    expect(total).toBe(2)
    const paths = images.map(i => i.relative_path).sort()
    expect(paths).toEqual(['photos/IMG_001.jpg', 'photos/portrait.webp'])
  })

  it('收藏路径为空数组 → 直接返回空', () => {
    const { images, total } = db.searchImages(
      { favoritePaths: [] },
      { limit: 100, offset: 0 }
    )
    expect(total).toBe(0)
    expect(images).toHaveLength(0)
  })

  it('收藏路径为 null → 不加收藏条件', () => {
    const { total } = db.searchImages(
      { favoritePaths: null },
      { limit: 100, offset: 0 }
    )
    expect(total).toBe(5)
  })

  it('分页：limit/offset 与 total 一致', () => {
    const page1 = db.searchImages({}, { limit: 2, offset: 0 })
    const page2 = db.searchImages({}, { limit: 2, offset: 2 })
    expect(page1.total).toBe(5)
    expect(page1.images).toHaveLength(2)
    expect(page2.images).toHaveLength(2)
    // 两次结果不重叠
    const ids1 = new Set(page1.images.map(i => i.id))
    const ids2 = new Set(page2.images.map(i => i.id))
    expect([...ids1].some(id => ids2.has(id))).toBe(false)
  })

  it('无命中返回空结果', () => {
    const { images, total } = db.searchImages(
      { formats: ['tiff'] },
      { limit: 100, offset: 0 }
    )
    expect(total).toBe(0)
    expect(images).toHaveLength(0)
  })

  it('分块：>900 条收藏路径正确拼接', () => {
    // 先插入 950 条额外记录
    const bulkImages = Array.from({ length: 950 }, (_, i) => ({
      relative_path: `bulk/img_${String(i).padStart(4, '0')}.jpg`,
      file_hash: `bulk_${i}`,
      width: 100, height: 100,
      file_size: 1000,
      format: 'jpg',
      modified_time: '2026-06-01T00:00:00Z',
      media_type: 'image',
    }))
    db.addImages(bulkImages)

    // 构造 950 条路径的收藏列表（包含前 10 条以验证命中）
    const favPaths = bulkImages.slice(0, 10).map(img => img.relative_path)
    const { images, total } = db.searchImages(
      { favoritePaths: favPaths },
      { limit: 100, offset: 0 }
    )
    expect(total).toBe(10)
    expect(images).toHaveLength(10)
  })
})

describe('MasterDB.getFavoritePathsByMinRating', () => {
  let masterDB: MasterDB
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-master-search-test-'))
    masterDB = new MasterDB()
    masterDB.initialize(tmpDir)
    // 创建测试库并添加收藏
    masterDB.addLibrary('TestLib', '/tmp/testlib')
  })

  afterAll(() => {
    masterDB.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('有命中：返回评分 >= minRating 的路径', () => {
    masterDB.addFavorite(1, '/tmp/testlib/a.jpg', [], 3)
    masterDB.addFavorite(1, '/tmp/testlib/b.jpg', [], 5)
    masterDB.addFavorite(1, '/tmp/testlib/c.jpg', [], 0)

    const paths = masterDB.getFavoritePathsByMinRating(1, 3)
    expect(paths.sort()).toEqual(['/tmp/testlib/a.jpg', '/tmp/testlib/b.jpg'])
  })

  it('无命中：返回空数组', () => {
    const paths = masterDB.getFavoritePathsByMinRating(999, 1)
    expect(paths).toEqual([])
  })
})
