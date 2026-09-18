import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import {
  activate,
  applyAutotoneBuffer,
  applyAutotone,
  type AutotoneParams,
} from '../builtins/autotone'
import type { LuukSdk } from '../../../types/plugin'

/** 生成一张纯色测试图（PNG Buffer） */
async function solidPng(r: number, g: number, b: number, w = 8, h = 8): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r, g, b, alpha: 255 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buf)
}

/** 读取 PNG 的通道均值 */
async function channelMeans(bytes: Uint8Array): Promise<{ r: number; g: number; b: number; lum: number }> {
  const { data, info } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true })
  const c = info.channels
  let sr = 0, sg = 0, sb = 0
  const n = info.width * info.height
  for (let i = 0; i < n; i++) {
    sr += data[i * c]
    sg += data[i * c + 1]
    sb += data[i * c + 2]
  }
  const r = sr / n, g = sg / n, b = sb / n
  return { r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b }
}

/** 构造仅含 fs.read / edit.write / progress 的假 SDK */
function fakeSdk(reads: Record<string, Uint8Array>) {
  const writes: Array<{ sourcePath: string; op: string; buffer: Uint8Array; format?: string }> = []
  const sdk = {
    fs: {
      read: async (p: string) => reads[p],
      write: vi.fn(),
    },
    edit: {
      write: async (params: any) => {
        writes.push({ sourcePath: params.sourcePath, op: params.op, buffer: params.outputBuffer, format: params.format })
        return writes.length // editId
      },
    },
    progress: { report: vi.fn().mockResolvedValue(undefined) },
  } as unknown as LuukSdk
  return { sdk, writes }
}

describe('autotone · 契约与黄金样本（G-4 / Task 2b）', () => {
  it('applyAutotoneBuffer 输出合法 PNG', async () => {
    const input = await solidPng(120, 120, 120)
    const out = await applyAutotoneBuffer(input)
    const meta = await sharp(Buffer.from(out)).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(8)
    expect(meta.height).toBe(8)
  })

  it('暗图提亮：亮度均值向目标靠拢', async () => {
    const dark = await solidPng(60, 60, 60)
    const before = await channelMeans(dark)
    const out = await applyAutotoneBuffer(dark)
    const after = await channelMeans(out)
    // 更暗（均值低于目标）应被提亮
    expect(after.lum).toBeGreaterThan(before.lum)
  })

  it('灰图白平衡后通道趋于一致', async () => {
    const cast = await solidPng(150, 120, 90) // 偏暖
    const out = await applyAutotoneBuffer(cast, { exposure: false, contrast: false, whiteBalance: true })
    const m = await channelMeans(out)
    expect(Math.abs(m.r - m.b)).toBeLessThan(Math.abs(150 - 90))
  })

  it('参数关闭时保持近似原值', async () => {
    const img = await solidPng(100, 110, 120)
    const params: AutotoneParams = { exposure: false, contrast: false, whiteBalance: false }
    const out = await applyAutotoneBuffer(img, params)
    const m = await channelMeans(out)
    expect(Math.abs(m.r - 100)).toBeLessThan(2)
    expect(Math.abs(m.g - 110)).toBeLessThan(2)
    expect(Math.abs(m.b - 120)).toBeLessThan(2)
  })

  it('activate().executeOp 读取→处理→写编辑链', async () => {
    const png = await solidPng(70, 70, 70)
    const { sdk, writes } = fakeSdk({ 'C:\\lib\\a.png': png })
    const inst = activate(sdk)
    const res = (await inst.executeOp!(sdk, 'autotone.auto', {
      paths: ['C:\\lib\\a.png'],
      libraryId: 1,
      imageId: 2,
    })) as { results: Array<{ path: string; editId: number }> }

    expect(res.results).toHaveLength(1)
    expect(res.results[0].editId).toBe(1)
    expect(writes[0].op).toBe('autotone.auto')
    expect(writes[0].format).toBe('png')
    // 输出为合法 PNG
    const meta = await sharp(Buffer.from(writes[0].buffer)).metadata()
    expect(meta.format).toBe('png')
  })

  it('executeOp 未知 op 抛错', async () => {
    const { sdk } = fakeSdk({})
    const inst = activate(sdk)
    await expect(inst.executeOp!(sdk, 'nope', { paths: [] })).rejects.toThrow(/未知 op/)
  })

  it('executeOp 空输入跳过', async () => {
    const { sdk } = fakeSdk({})
    const inst = activate(sdk)
    const res = await inst.executeOp!(sdk, 'autotone.auto', {})
    expect(res).toMatchObject({ skipped: true })
  })

  it('保留 applyAutotone 文件到文件导出（向后兼容）', async () => {
    // 直接调用旧签名不抛错（写入临时文件）
    const os = await import('os')
    const fs = await import('fs')
    const path = await import('path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotone-'))
    const src = path.join(dir, 'in.png')
    const dst = path.join(dir, 'out.png')
    fs.writeFileSync(src, Buffer.from(await solidPng(80, 80, 80)))
    await applyAutotone(src, dst)
    expect(fs.existsSync(dst)).toBe(true)
  })
})
