import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ExportService } from '../export-service'

describe('ExportService', () => {
  let dir: string
  let outDir: string
  let img1: string // 40x40 png
  let img2: string // 60x30 jpg

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'))
    outDir = path.join(dir, 'out')
    fs.mkdirSync(outDir, { recursive: true })
    img1 = path.join(dir, 'img1.png')
    img2 = path.join(dir, 'img2.jpg')
    await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png().toFile(img1)
    await sharp({ create: { width: 60, height: 30, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .jpeg().toFile(img2)
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  describe('exportSingle', () => {
    it("format='original' 保留原扩展名并复制文件", async () => {
      const svc = new ExportService()
      const out = await svc.exportSingle(img1, { format: 'original', outputPath: outDir }, 's1')
      expect(out).toBe(path.join(outDir, 'img1.png'))
      expect(fs.existsSync(out)).toBe(true)
    })

    it("format='jpg' 转换扩展名并按 maxWidth 缩放", async () => {
      const svc = new ExportService()
      const out = await svc.exportSingle(
        img1,
        { format: 'jpg', maxWidth: 20, quality: 80, outputPath: outDir },
        's2'
      )
      expect(out).toBe(path.join(outDir, 'img1.jpg'))
      const meta = await sharp(out).metadata()
      expect(meta.width).toBe(20)
    })
  })

  describe('exportBatch', () => {
    it('生成合法 ZIP（PK 魔数），进度回调收尾于 (n,n)', async () => {
      const svc = new ExportService()
      const zipPath = path.join(outDir, 'batch.zip')
      const progress: Array<[number, number]> = []
      await svc.exportBatch(
        [img1, img2],
        { format: 'png', outputPath: zipPath },
        'b1',
        (d, t) => progress.push([d, t])
      )
      expect(fs.existsSync(zipPath)).toBe(true)
      const buf = fs.readFileSync(zipPath)
      expect(buf.slice(0, 2).toString()).toBe('PK') // ZIP 魔数，证明 archiver 工厂正常工作
      expect(buf.length).toBeGreaterThan(0)
      expect(progress[progress.length - 1]).toEqual([2, 2])
    })

    it('单文件失败不中断批量', async () => {
      const svc = new ExportService()
      const zipPath = path.join(outDir, 'batch2.zip')
      const onProgress = vi.fn()
      const ghost = path.join(dir, 'ghost.png') // 不存在
      await svc.exportBatch(
        [img1, ghost, img2],
        { format: 'png', outputPath: zipPath },
        'b2',
        onProgress
      )
      expect(fs.existsSync(zipPath)).toBe(true)
      // 三个条目均推进进度（失败项被跳过但仍计数）
      expect(onProgress).toHaveBeenCalledTimes(3)
      expect(onProgress).toHaveBeenLastCalledWith(3, 3)
    })

    it('取消：提前中止，清理输出文件', async () => {
      const svc = new ExportService()
      const zipPath = path.join(outDir, 'cancel.zip')
      const progress: number[] = []
      let cancelled = false
      await svc.exportBatch(
        [img1, img2, img1],
        { format: 'png', outputPath: zipPath },
        'cancel-task',
        (done) => {
          progress.push(done)
          if (done === 1 && !cancelled) {
            cancelled = true
            svc.cancel('cancel-task')
          }
        }
      )
      // 取消后循环在第 2 个文件前中止
      expect(progress).toEqual([1])
      // 输出文件被清理
      expect(fs.existsSync(zipPath)).toBe(false)
    })
  })

  describe('cancel', () => {
    it('取消未知任务不抛错（幂等）', () => {
      const svc = new ExportService()
      expect(() => svc.cancel('nope')).not.toThrow()
    })
  })
})
