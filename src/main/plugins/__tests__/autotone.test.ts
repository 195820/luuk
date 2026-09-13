import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { applyAutotone } from '../builtins/autotone'
import { calculateHistogram, getHistogramStats } from '../../utils/histogram'

describe('autotone 插件', () => {
  let testDir: string

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotone-test-'))
  })

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('处理欠曝图片：亮度提升', async () => {
    const inputPath = path.join(testDir, 'underexposed.png')
    const outputPath = path.join(testDir, 'underexposed-out.png')

    // 创建偏暗图片（带噪声，亮度约 60）
    const width = 100, height = 100
    const channels = 3
    const data = Buffer.alloc(width * height * channels)
    for (let i = 0; i < data.length; i += channels) {
      const noise = Math.random() * 20 - 10 // ±10 噪声
      data[i] = Math.max(0, Math.min(255, 60 + noise))     // R
      data[i + 1] = Math.max(0, Math.min(255, 60 + noise)) // G
      data[i + 2] = Math.max(0, Math.min(255, 60 + noise)) // B
    }
    await sharp(data, { raw: { width, height, channels } }).png().toFile(inputPath)

    // 记录输入亮度
    const inputHist = await calculateHistogram(inputPath)
    const inputMean = getHistogramStats(inputHist.luminance).mean

    await applyAutotone(inputPath, outputPath)

    const histogram = await calculateHistogram(outputPath)
    const stats = getHistogramStats(histogram.luminance)

    // 亮度应该被提升，向 128 靠拢
    expect(stats.mean).toBeGreaterThan(inputMean)
    // 不应过度补偿（超过目标值太多）
    expect(stats.mean).toBeLessThan(200)
  })

  it('处理过曝图片：亮度降低', async () => {
    const inputPath = path.join(testDir, 'overexposed.png')
    const outputPath = path.join(testDir, 'overexposed-out.png')

    // 创建偏亮图片（带噪声，亮度约 200）
    const width = 100, height = 100
    const channels = 3
    const data = Buffer.alloc(width * height * channels)
    for (let i = 0; i < data.length; i += channels) {
      const noise = Math.random() * 20 - 10
      data[i] = Math.max(0, Math.min(255, 200 + noise))
      data[i + 1] = Math.max(0, Math.min(255, 200 + noise))
      data[i + 2] = Math.max(0, Math.min(255, 200 + noise))
    }
    await sharp(data, { raw: { width, height, channels } }).png().toFile(inputPath)

    const inputHist = await calculateHistogram(inputPath)
    const inputMean = getHistogramStats(inputHist.luminance).mean

    await applyAutotone(inputPath, outputPath)

    const histogram = await calculateHistogram(outputPath)
    const stats = getHistogramStats(histogram.luminance)

    // 亮度应该被降低，向 128 靠拢
    expect(stats.mean).toBeLessThan(inputMean)
    expect(stats.mean).toBeGreaterThan(50)
  })

  it('参数控制：关闭白平衡后色偏保留', async () => {
    const inputPath = path.join(testDir, 'color-cast.png')
    const outputWithWB = path.join(testDir, 'with-wb.png')
    const outputWithoutWB = path.join(testDir, 'without-wb.png')

    // 创建蓝色偏色图片（带噪声，B > R = G）
    const width = 100, height = 100
    const channels = 3
    const data = Buffer.alloc(width * height * channels)
    for (let i = 0; i < data.length; i += channels) {
      const noise = Math.random() * 20 - 10
      data[i] = Math.max(0, Math.min(255, 100 + noise))     // R
      data[i + 1] = Math.max(0, Math.min(255, 100 + noise)) // G
      data[i + 2] = Math.max(0, Math.min(255, 160 + noise)) // B（偏高）
    }
    await sharp(data, { raw: { width, height, channels } }).png().toFile(inputPath)

    // 启用白平衡
    await applyAutotone(inputPath, outputWithWB, { whiteBalance: true })
    // 关闭白平衡
    await applyAutotone(inputPath, outputWithoutWB, { whiteBalance: false })

    const histWB = await calculateHistogram(outputWithWB)
    const histNoWB = await calculateHistogram(outputWithoutWB)

    const rWB = getHistogramStats(histWB.r).mean
    const bWB = getHistogramStats(histWB.b).mean
    const rNoWB = getHistogramStats(histNoWB.r).mean
    const bNoWB = getHistogramStats(histNoWB.b).mean

    // 启用白平衡后，R-B 通道差异应缩小（色偏被校正）
    const diffWithWB = Math.abs(rWB - bWB)
    const diffWithoutWB = Math.abs(rNoWB - bNoWB)

    expect(diffWithWB).toBeLessThan(diffWithoutWB)
  })

  it('plugin.json 格式正确', () => {
    const manifestPath = path.join(__dirname, '../builtins/autotone/plugin.json')
    const content = fs.readFileSync(manifestPath, 'utf-8')
    const manifest = JSON.parse(content)

    // 必需字段
    expect(manifest.id).toBe('builtin.autotone')
    expect(manifest.name).toBe('自动调色')
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.apiVersion).toBe('^1.0.0')
    expect(manifest.kind).toBe('ai-transform')
    expect(manifest.entry).toBe('index.js')

    // 能力声明
    expect(manifest.capabilities).toContain('image.autotone')

    // 零模型依赖
    expect(manifest.requires.runtime).toBe('none')
    expect(manifest.requires.gpu).toBe(false)
    expect(manifest.requires.models).toEqual([])

    // 权限
    expect(manifest.permissions).toContain('library.read')
    expect(manifest.permissions).toContain('fs.write.output')
    expect(manifest.permissions).toContain('image')

    // 贡献的 ops 和菜单项
    expect(manifest.contributes.ops).toHaveLength(1)
    expect(manifest.contributes.ops[0].id).toBe('autotone.auto')
    expect(manifest.contributes.ops[0].capability).toBe('image.autotone')
    expect(manifest.contributes.menuItems).toHaveLength(1)
    expect(manifest.contributes.menuItems[0].op).toBe('autotone.auto')
  })
})
