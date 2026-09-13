import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// database.ts 顶部 import { app } from 'electron'
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import { MasterDB } from '../database'

describe('数据库迁移与文件夹封面', () => {
  let db: MasterDB
  let tempDir: string
  let libDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivmig-'))
    libDir = path.join(tempDir, 'library')
    fs.mkdirSync(libDir, { recursive: true })
    db = new MasterDB()
    db.initialize(tempDir) // 触发 createTables + ensureSchemaVersion（迁移 v1）
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('迁移后 folder_covers 可用（写入/读取往返）', () => {
    db.addLibrary('测试库', libDir)
    db.setFolderCover(1, 'photos', 'photos/cover.jpg')
    expect(db.getFolderCovers(1)).toEqual({ photos: 'photos/cover.jpg' })
  })

  it('路径分隔符归一化为正斜杠', () => {
    db.addLibrary('测试库', libDir)
    db.setFolderCover(1, 'photos\\2024', 'photos\\2024\\c.jpg')
    expect(db.getFolderCovers(1)).toEqual({ 'photos/2024': 'photos/2024/c.jpg' })
  })

  it('UNIQUE(library_id, folder_path)：重复设置以最新值覆盖', () => {
    db.addLibrary('测试库', libDir)
    db.setFolderCover(1, 'photos', 'a.jpg')
    db.setFolderCover(1, 'photos', 'b.jpg')
    expect(db.getFolderCovers(1)).toEqual({ photos: 'b.jpg' })
  })

  it('removeFolderCover 仅删除指定文件夹封面', () => {
    db.addLibrary('测试库', libDir)
    db.setFolderCover(1, 'p1', 'p1/c.jpg')
    db.setFolderCover(1, 'p2', 'p2/c.jpg')
    db.removeFolderCover(1, 'p1')
    expect(db.getFolderCovers(1)).toEqual({ p2: 'p2/c.jpg' })
  })

  it('封面按库隔离：不同 library_id 互不干扰', () => {
    db.addLibrary('库A', libDir)
    db.addLibrary('库B', path.join(tempDir, 'lib2'))
    db.setFolderCover(1, 'photos', 'a.jpg')
    db.setFolderCover(2, 'photos', 'b.jpg')
    expect(db.getFolderCovers(1)).toEqual({ photos: 'a.jpg' })
    expect(db.getFolderCovers(2)).toEqual({ photos: 'b.jpg' })
  })

  it('删除库时 ON DELETE CASCADE 清空其封面', () => {
    db.addLibrary('测试库', libDir)
    db.setFolderCover(1, 'photos', 'photos/c.jpg')
    db.removeLibrary(1)
    expect(db.getFolderCovers(1)).toEqual({})
  })

  it('迁移幂等：同路径重复初始化不报错且数据保留', () => {
    db.addLibrary('测试库', libDir)
    db.setFolderCover(1, 'photos', 'photos/c.jpg')
    db.close()
    // 模拟老用户升级/重启：以同一数据目录再次初始化
    const db2 = new MasterDB()
    expect(() => db2.initialize(tempDir)).not.toThrow()
    expect(db2.getFolderCovers(1)).toEqual({ photos: 'photos/c.jpg' })
    db = db2 // 交给 afterEach 关闭
  })
})

describe('MasterDB migration v2 — Phase 8', () => {
  let db: MasterDB

  beforeEach(() => {
    db = new MasterDB()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-test-'))
    db.initialize(tmpDir)
  })

  afterEach(() => {
    db.close()
  })

  it('创建 jobs 表', () => {
    const tables = (db as any).db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
    ).get()
    expect(tables).toBeTruthy()
  })

  it('创建 job_items 表', () => {
    const tables = (db as any).db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='job_items'"
    ).get()
    expect(tables).toBeTruthy()
  })

  it('创建 edits 表', () => {
    const tables = (db as any).db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='edits'"
    ).get()
    expect(tables).toBeTruthy()
  })

  it('jobs 表插入和查询', () => {
    const now = new Date().toISOString()
    ;(db as any).db.prepare(`
      INSERT INTO jobs (id, kind, state, priority, total, done, failed, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('job-1', 'ai.upscale', 'pending', 0, 10, 0, 0, '{}', now, now)

    const job = (db as any).db.prepare('SELECT * FROM jobs WHERE id = ?').get('job-1')
    expect(job).toBeTruthy()
    expect(job.kind).toBe('ai.upscale')
  })

  it('edits 表支持 parent_edit_id', () => {
    const now = new Date().toISOString()
    ;(db as any).db.prepare(`
      INSERT INTO edits (library_id, image_id, plugin_id, op, output_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(1, 1, 'builtin.upscale', 'upscale.x4', '/output/x4.png', now)

    const edit = (db as any).db.prepare('SELECT * FROM edits ORDER BY id DESC LIMIT 1').get()
    expect(edit.parent_edit_id).toBeNull()
  })

  it('createJob / getJob 方法', () => {
    db.createJob('test-job', 'test.kind', 0, 5, '{"key":"value"}')
    const job = db.getJob('test-job')
    expect(job).toBeTruthy()
    expect(job!.kind).toBe('test.kind')
    expect(job!.state).toBe('pending')
    expect(job!.total).toBe(5)
  })

  it('createJobItems / getJobItems 方法', () => {
    db.createJob('j1', 'test', 0, 3, '{}')
    db.createJobItems('j1', [
      { libraryId: 1, imageId: 10 },
      { libraryId: 1, imageId: 20 },
    ])
    const items = db.getJobItems('j1')
    expect(items).toHaveLength(2)
    expect(items[0].state).toBe('pending')
  })

  it('updateJobItemState 方法', () => {
    db.createJob('j2', 'test', 0, 2, '{}')
    db.createJobItems('j2', [{ libraryId: 1, imageId: 1 }])
    const items = db.getJobItems('j2')
    db.updateJobItemState([items[0].id], 'done')
    const updated = db.getJobItems('j2', 'done')
    expect(updated).toHaveLength(1)
  })

  it('recoverInterruptedJobs 恢复中断作业', () => {
    db.createJob('j3', 'test', 0, 1, '{}')
    db.updateJobState('j3', 'running')
    const recovered = db.recoverInterruptedJobs()
    expect(recovered).toBe(1)
    const job = db.getJob('j3')
    expect(job!.state).toBe('paused')
  })

  it('createEdit / getEditsForImage 方法', () => {
    const editId = db.createEdit({
      libraryId: 1,
      imageId: 1,
      pluginId: 'builtin.upscale',
      op: 'upscale.x4',
      params: null,
      modelId: null,
      outputPath: '/output/test.png',
      parentEditId: null,
    })
    expect(editId).toBeGreaterThan(0)

    const edits = db.getEditsForImage(1, 1)
    expect(edits).toHaveLength(1)
    expect(edits[0].op).toBe('upscale.x4')
  })
})
