import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { ThumbnailsDB } from '../database'

describe('ThumbnailsDB 索引可嵌入图片查询（Phase 9 M5 · T21）', () => {
  let db: ThumbnailsDB
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-thumb-idx-'))
    db = new ThumbnailsDB()
    db.initialize(tmpDir)
    db.addImages([
      { relative_path: 'a/1.jpg', file_hash: 'h1', width: 10, height: 10, file_size: 1, format: 'jpg', modified_time: '2026-01-01T00:00:00Z', media_type: 'image' },
      { relative_path: 'a/2.jpg', file_hash: 'h2', width: 10, height: 10, file_size: 1, format: 'jpg', modified_time: '2026-01-01T00:00:00Z', media_type: 'image' },
      { relative_path: 'v/clip.mp4', file_hash: 'h3', width: 10, height: 10, file_size: 1, format: 'mp4', modified_time: '2026-01-01T00:00:00Z', media_type: 'video' },
      { relative_path: 'a/3.jpg', file_hash: 'h4', width: 10, height: 10, file_size: 1, format: 'jpg', modified_time: '2026-01-01T00:00:00Z', media_type: 'image' },
    ])
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('listIndexableImages 只回 image、按 id 升序、剔除 video', () => {
    const list = db.listIndexableImages()
    expect(list.map((x) => x.relativePath)).toEqual(['a/1.jpg', 'a/2.jpg', 'a/3.jpg'])
    expect(list.every((x) => x.relativePath !== 'v/clip.mp4')).toBe(true)
    // id 升序
    const ids = list.map((x) => x.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })

  it('getImageRelativePath 命中返回路径、未命中返回 null', () => {
    const first = db.listIndexableImages()[0]
    expect(db.getImageRelativePath(first.id)).toBe(first.relativePath)
    expect(db.getImageRelativePath(999999)).toBeNull()
  })
})
