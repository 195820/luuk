import { describe, it, expect, vi } from 'vitest'
import { activate } from '../builtins/upscale'
import type { LuukSdk } from '../../../types/plugin'

/**
 * 构造仅覆盖到像素预算守卫之前调用链的假 SDK：
 * progress.report / fs.read / image.decode / inference.createSession。
 * 守卫在 createSession 之后、inference.run 之前触发，故无需 mock 推理本体。
 */
function fakeSdkDecode(width: number, height: number, channels = 3) {
  return {
    progress: { report: vi.fn().mockResolvedValue(undefined) },
    fs: { read: vi.fn().mockResolvedValue(new Uint8Array(0)) },
    image: {
      decode: vi.fn().mockResolvedValue({
        width,
        height,
        channels,
        // 守卫在 buildTileTensor 之前触发，data 不会被读取 → 无需按尺寸分配真实像素
        data: new Uint8Array(0),
      }),
      encode: vi.fn().mockResolvedValue(new Uint8Array(0)),
    },
    inference: {
      createSession: vi.fn().mockResolvedValue({ inputNames: ['image'] }),
      run: vi.fn(),
    },
    edit: { write: vi.fn() },
  } as unknown as LuukSdk & Record<string, any>
}

describe('P0-2 · upscale 输出像素预算守卫（防 OOM 熔断）', () => {
  it('4K 源 @4x（≈133M 输出像素）超限：抛可展示错误且不调用推理', async () => {
    const sdk = fakeSdkDecode(3840, 2160) // 8.3M 源 → 4x = 33M 像素*? 16 倍像素面积
    const plugin = activate(sdk)

    await expect(
      plugin.executeOp!(sdk, 'upscale.x4', {
        paths: ['D:/lib/a.jpg'],
        params: { scale: 4 },
        libraryId: 1,
        imageId: 1,
      }),
    ).rejects.toThrow(/输出过大/)

    // 关键：守卫必须在推理/编码/分配前拦截，杜绝打爆 Worker
    expect(sdk.inference.run).not.toHaveBeenCalled()
    expect(sdk.image.encode).not.toHaveBeenCalled()
  })

  it('2x 输出仍超 40M：同样拒绝（源 6000x6000）', async () => {
    const sdk = fakeSdkDecode(6000, 6000)
    const plugin = activate(sdk)

    await expect(
      plugin.executeOp!(sdk, 'upscale.x4', {
        paths: ['D:/lib/big.jpg'],
        params: { scale: 2 }, // 12000x12000 = 144M > 40M
        libraryId: 1,
        imageId: 1,
      }),
    ).rejects.toThrow(/输出过大/)
  })

  it('paths 为空：返回 skipped（供 P0-1 handler 判失败，不再假成功）', async () => {
    const sdk = fakeSdkDecode(64, 64)
    const plugin = activate(sdk)

    const res = (await plugin.executeOp!(sdk, 'upscale.x4', {
      libraryId: 1,
      imageId: 1,
    })) as { skipped?: boolean }

    expect(res.skipped).toBe(true)
  })
})
