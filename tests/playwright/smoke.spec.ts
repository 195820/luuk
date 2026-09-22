/**
 * E2E 冒烟测试（§5.5 门禁）——确定性的生产包核心链路冒烟。
 * 流程：启动 shell → 建库+扫描（IPC）→ DB 落库直读 → media:// 缩略图渲染层解码 → 退出 <5s。
 * 前置：需先 npm run build:dir 产生 dist-electron/main.js + dist/index.html（默认生产模式，无需 dev server）。
 *
 * 说明：
 * - 全流程用同一 Electron 实例（单 test），避免 fixture 每 test 独立 tmpUserData 导致状态不连续。
 * - 不依赖 UI 选库导航（App 启动默认 currentLibrary=收藏夹，网格驱动脆弱），改以 IPC+media:// 确定性断言；
 *   网格/查看器/收藏的 UI 行为由组件测试 + scripts/cdp-verify-media.mjs 探针 + M-C 人工覆盖。
 */
import { electronTest as test, expect } from './fixtures'
import path from 'path'

const PROJECT_ROOT = process.cwd()
// 统一用正斜杠传给 IPC（与库 root_path 存储口径一致）
const TEST_LIBRARY = path.join(PROJECT_ROOT, 'test-library').replace(/\\/g, '/')

test('冒烟流程：启动→建库扫描→DB直读→media://解码→退出', async ({ page, electronApp }) => {
  test.setTimeout(150000)

  // 1) 启动：app shell 渲染（标题栏 heading 稳定存在）
  await expect(page.locator('body')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '图片查看器' }).first()
  ).toBeVisible({ timeout: 20000 })

  // 2) 建库 + 触发扫描（裸 IPC，绕过原生 dialog）。addLibrary(autoScan=true) 在主进程内
  //    await 扫描完成才 resolve，故返回时 library 已落库。
  const addResult = await page.evaluate(async (libPath: string) => {
    const api = (window as any).electronAPI
    const libs = await api.getLibraries()
    const existing = libs.find((l: any) => (l.root_path || l.rootPath) === libPath)
    if (existing) {
      await api.scanLibrary(existing.id)
      return { id: existing.id, status: 'rescanned' as const }
    }
    const lib = await api.addLibrary('冒烟测试库', libPath, true)
    return { id: lib?.id ?? lib, status: 'added' as const }
  }, TEST_LIBRARY)
  expect(addResult.status).toMatch(/added|rescanned/)

  // 3) DB 落库直读（getImages 需同时传 limit+offset，offset 缺失会触发 SQLite datatype mismatch）
  const probe = await page.evaluate(async (libId: number) => {
    const api = (window as any).electronAPI
    const res = await api.getImages(libId, { limit: 50, offset: 0 })
    const arr = Array.isArray(res) ? res : res?.images ?? []
    const first = arr[0]
    const thumb = first ? await api.getThumbnail(libId, first.id, 'small') : null
    return { count: arr.length, firstId: first?.id, thumb: thumb as string | null }
  }, addResult.id)
  expect(probe.count).toBeGreaterThan(0)

  // 4) media:// 协议链：getThumbnail 返回 media:// URL，渲染层 new Image 能解码
  //    （证明主进程协议处理器 + sharp 缩略图在 Electron 生产 ABI 下工作）
  expect(String(probe.thumb)).toMatch(/^media:\/\//)
  const thumbUrl = probe.thumb as string
  const decoded = await page.evaluate((url: string) =>
    new Promise<boolean>((resolve) => {
      const img = new Image()
      const timer = setTimeout(() => resolve(false), 10000)
      img.onload = () => { clearTimeout(timer); resolve(true) }
      img.onerror = () => { clearTimeout(timer); resolve(false) }
      img.src = url
    }), thumbUrl)
  expect(decoded).toBe(true)

  // 5) 退出耗时 < 5s（方案红线 162ms，E2E 环境放宽至 5s）
  const t0 = Date.now()
  await electronApp.close()
  expect(Date.now() - t0).toBeLessThan(5000)
})
