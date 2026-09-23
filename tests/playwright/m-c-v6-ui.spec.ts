/**
 * M-C 自动化子集 v6 · A2 纯 UI 断言组（真实渲染 DOM + 交互驱动）
 *
 * 回收卡片（对应手册 §1.2 / §2.2 / §2.3 / §3）——均为可用 DOM 断言、无需外部素材/模型下载者：
 *   - PH8-05-UI  设置面板 → 插件 Tab：插件行显示 + 启用开关（手册"插件行显示已启用"子项）
 *   - MT-UI-03   强调色：预设切换 data-accent + 合法 HEX 生效 / 非法 HEX 拒生效
 *   - MT-IX-02   右键菜单项齐全
 *   - TC-GRID-001 虚拟滚动：渲染卡片数远小于库总数
 *   - TC-GRID-003 缩略图尺寸滑块改变卡片宽度
 *   - MT-IX-03   空库引导文案
 *
 * 运行：node node_modules/@playwright/test/cli.js test --config=tests/playwright.config.ts tests/playwright/m-c-v6-ui.spec.ts
 */
import { electronTest as test, expect } from './fixtures'
import path from 'path'
import fs from 'fs'
import os from 'os'

const PROJECT_ROOT = process.cwd()
const TEST_LIBRARY = path.join(PROJECT_ROOT, 'test-library').replace(/\\/g, '/')

// ─── helpers（沿用 ui-interaction.spec.ts 的库选择模式）───────────────
async function openApp(page: any) {
  await page.waitForSelector('h1:has-text("图片查看器")', { timeout: 20000 })
}

async function selectLibraryByName(page: any, libName: string) {
  const trigger = page.locator('button[role="combobox"]').first()
  const currentText = await trigger.textContent().catch(() => '')
  if (currentText?.includes(libName)) {
    await page.waitForTimeout(1200)
    return
  }
  await trigger.click()
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
  const options = page.locator('[role="option"]')
  const count = await options.count()
  for (let i = 0; i < count; i++) {
    const text = (await options.nth(i).textContent()) || ''
    if (text.includes(libName)) {
      await options.nth(i).click()
      await page.waitForTimeout(1500)
      return
    }
  }
  await page.keyboard.press('Escape')
}

/** 建库（IPC，幂等）+ reload 刷新 React 态 + UI 选库；返回 libId */
async function addAndSelectLibrary(page: any, name: string, libPath: string): Promise<number> {
  const { id, actualName } = await page.evaluate(async ({ name, libPath }: { name: string; libPath: string }) => {
    const api = (window as any).electronAPI
    const libs = await api.getLibraries()
    const existing = libs.find((l: any) => (l.root_path || l.rootPath) === libPath)
    if (existing) return { id: existing.id, actualName: existing.name }
    const lib = await api.addLibrary(name, libPath, true)
    return { id: lib?.id ?? lib, actualName: name }
  }, { name, libPath })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await openApp(page)
  await page.waitForTimeout(1000)
  await selectLibraryByName(page, actualName)
  return id
}

async function waitForGrid(page: any, min = 1, timeout = 30000) {
  await page.waitForFunction(
    (m: number) => document.querySelectorAll('.grid-card').length >= m,
    min,
    { timeout },
  )
}

async function openSettings(page: any) {
  await page.locator('button[title="外观设置"]').first().click()
  await page.waitForSelector('h2:has-text("设置")', { timeout: 5000 })
}

// ═════════════════════════════════════════════════════════════════
test.describe('A2 纯 UI 断言组', () => {
  test.setTimeout(120000)

  // PH8-05-UI：设置 → 插件 Tab → 插件行显示 + 启用开关（真实 Worker）
  test('PH8-05-UI 插件 Tab 显示内置插件并可开关', async ({ page }) => {
    await openApp(page)
    await openSettings(page)
    await page.getByRole('button', { name: '插件', exact: true }).click()

    // 若插件系统未开启，点击引导里的"开启"（setPluginsFeatureEnabled(true)）
    const guide = page.locator('button:has-text("开启")').first()
    if (await guide.isVisible().catch(() => false)) {
      await guide.click()
      await page.waitForTimeout(1500)
    }

    // 插件列表出现：应有 3 个内置插件 + 3 个开关
    await expect(page.locator('text=/共\\s*3\\s*个插件/')).toBeVisible({ timeout: 15000 })
    const switches = page.locator('div.overflow-hidden button[role="switch"]')
    await expect(switches.first()).toBeVisible({ timeout: 10000 })
    expect(await switches.count()).toBe(3)

    // 打开第一个插件（走真实 Worker setEnabled）→ aria-checked 变 true
    const first = switches.first()
    const before = await first.getAttribute('aria-checked')
    if (before !== 'true') {
      await first.click()
      // 轮询 aria-checked（真实 plugin.load RPC，P1-11 顺序）
      const deadline = Date.now() + 25000
      let checked = 'false'
      while (Date.now() < deadline) {
        checked = (await first.getAttribute('aria-checked')) || 'false'
        if (checked === 'true') break
        await page.waitForTimeout(1000)
      }
      expect(checked).toBe('true')
    }
    await page.keyboard.press('Escape')
  })

  // MT-UI-03：强调色预设 + 合法/非法 HEX
  test('MT-UI-03 强调色预设切换 + 合法HEX生效 / 非法HEX不生效', async ({ page }) => {
    await openApp(page)
    await openSettings(page)
    // 外观 Tab 默认选中

    // 1) 预设：点击"蓝色" → data-accent=blue（applyTheme 匹配预设走 CSS 属性选择器）
    await page.locator('button[title="蓝色"]').click()
    await page.waitForTimeout(300)
    let accent = await page.evaluate(() => document.documentElement.dataset.accent)
    expect(accent).toBe('blue')
    // 预设下 --color-accent 由 [data-accent=blue] CSS 规则解析（非空）；记录为基线
    const presetVal = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim().toLowerCase())
    expect(presetVal).toBe('#3b82f6')

    // 2) 非法 HEX "#zzz" → 正则不通过 → 不改强调色（data-accent 仍 blue，--color-accent 仍预设基线）
    const hexInput = page.locator('input[placeholder="#7c6ef0"]')
    await hexInput.fill('#zzz')
    await page.waitForTimeout(300)
    accent = await page.evaluate(() => document.documentElement.dataset.accent)
    const afterIllegal = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim().toLowerCase())
    expect(accent).toBe('blue')        // 未被非法值改动
    expect(afterIllegal).toBe(presetVal) // 强调色保持预设基线，未被非法值覆盖

    // 3) 合法 HEX "#00ff00" → 非预设 → 走 inline --color-accent 覆盖基线
    await hexInput.fill('#00ff00')
    await page.waitForTimeout(300)
    accent = await page.evaluate(() => document.documentElement.dataset.accent)
    const inlineValid = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim().toLowerCase())
    expect(accent).toBeFalsy()          // 自定义色移除 data-accent
    expect(inlineValid).toBe('#00ff00')  // 生效并区别于预设基线
    await page.keyboard.press('Escape')
  })

  // MT-IX-02：右键菜单项齐全
  test('MT-IX-02 网格右键菜单核心项齐全', async ({ page }) => {
    await addAndSelectLibrary(page, 'V6 UI库', TEST_LIBRARY)
    await waitForGrid(page)

    await page.locator('.grid-card').first().click({ button: 'right' })
    await page.waitForSelector('div.bg-popover button', { timeout: 5000 })

    const expected = ['重命名', '移动到', '复制到', '导出为', '在资源管理器中显示', '设为壁纸', '标签', '移入回收站']
    for (const label of expected) {
      await expect(page.locator(`button:has-text("${label}")`).first()).toBeVisible({ timeout: 3000 })
    }
    await page.keyboard.press('Escape')
  })

  // TC-GRID-001：虚拟滚动渲染节点数远小于库总数
  test('TC-GRID-001 虚拟滚动 DOM 卡片数受控', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'V6 UI库', TEST_LIBRARY)
    await waitForGrid(page)
    const total: number = await page.evaluate((id: number) => (window as any).electronAPI.getImageCount(id), libId)
    expect(total).toBeGreaterThan(50) // test-library 共 100 张
    const rendered = await page.locator('.grid-card').count()
    console.log(`  [v6] 虚拟滚动：渲染卡片=${rendered} / 库总数=${total}`)
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(total) // 虚拟化：DOM 只挂可见+overscan
  })

  // TC-GRID-003：缩略图尺寸滑块改变卡片宽度
  test('TC-GRID-003 缩略图尺寸滑块调节布局自适应', async ({ page }) => {
    await addAndSelectLibrary(page, 'V6 UI库', TEST_LIBRARY)
    await waitForGrid(page)

    const setSize = async (v: number) => {
      await page.evaluate((val: number) => {
        const el = document.getElementById('thumbnail-size') as HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
        setter.call(el, String(val))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, v)
      await page.waitForTimeout(600)
    }

    await setSize(400)
    let w: number = await page.evaluate(() => document.querySelector('.grid-card')?.getBoundingClientRect().width ?? 0)
    console.log(`  [v6] 尺寸=400 → 卡片宽=${w}`)
    expect(w).toBeGreaterThanOrEqual(360)
    expect(w).toBeLessThanOrEqual(420)

    await setSize(80)
    w = await page.evaluate(() => document.querySelector('.grid-card')?.getBoundingClientRect().width ?? 0)
    console.log(`  [v6] 尺寸=80 → 卡片宽=${w}`)
    expect(w).toBeGreaterThanOrEqual(70)
    expect(w).toBeLessThanOrEqual(110)
  })

  // MT-IX-03：空库引导文案
  test('MT-IX-03 空库显示引导文案', async ({ page }) => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-empty-lib-'))
    let libId = 0
    try {
      const name = `V6 空库 ${Date.now()}`
      const r = await page.evaluate(async ({ name, dir }: { name: string; dir: string }) => {
        const api = (window as any).electronAPI
        const lib = await api.addLibrary(name, dir.replace(/\\/g, '/'), true)
        return { id: lib?.id ?? lib }
      }, { name, dir: emptyDir })
      libId = r.id
      await page.reload({ waitUntil: 'domcontentloaded' })
      await openApp(page)
      await page.waitForTimeout(1000)
      await selectLibraryByName(page, name)

      await expect(page.locator('text=还没有图片')).toBeVisible({ timeout: 10000 })
    } finally {
      // 清理：先摘库（释放 SQLite 句柄）再删目录，避免 Windows EPERM
      await page.evaluate((id: number) => (window as any).electronAPI.removeLibrary(id), libId).catch(() => {})
      await page.waitForTimeout(500)
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }
  })
})
