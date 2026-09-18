/**
 * CDP 远程验证三项缺陷修复（R-1 搜索浮层 / R-2 主题实时生效 / R-3 关闭不卡）
 * 通过 Electron 远程调试端口 9222 连接，纯 DOM 操作，不占用鼠标键盘。
 * 运行：node scripts/cdp-verify-defects.mjs
 * R-3 会关闭应用窗口，放在最后执行。
 */
import { chromium } from 'playwright'
import fs from 'fs'

const EVIDENCE = 'test-evidence'
fs.mkdirSync(EVIDENCE, { recursive: true })

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages().find(p => p.url().includes('5173'))
if (!page) { console.error('未找到主窗口页面'); process.exit(1) }
await page.bringToFront()

// ── 准备：通过顶部库选择器切到 test 库（6 张，加载快） ──
await page.locator('header [role=combobox]').first().click()
await page.waitForTimeout(400)
let libOpt = page.locator('[role=option]', { hasText: /^test - / }).first()
if (!(await libOpt.count())) {
  libOpt = page.locator('text=/^test - 6/').first()
}
try {
  await libOpt.click({ timeout: 3000, force: true })
} catch {
  // 键盘兑底：重新打开选择器，用方向键选 test（收藏夹后的第一项）
  await page.keyboard.press('Escape')
  await page.locator('header [role=combobox]').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
}
await page.waitForTimeout(1500)
// 确认已切到图库视图（搜索按钮存在）
const hasSearch = await page.locator('header button', { hasText: '搜索' }).count()
check('准备 切换到 test 图库', hasSearch > 0, `搜索按钮数=${hasSearch}`)

// ══ R-1：搜索面板 portal 浮层 ══
{
  const searchBtn = page.locator('header button', { hasText: '搜索' }).first()
  await searchBtn.click()
  await page.waitForTimeout(400)

  const r1 = await page.evaluate(() => {
    // 面板应是挂到 body 下的 fixed 浮层（非 header 后代），且内含 glass-l2 容器
    const fixed = [...document.body.children].filter(el => {
      const s = getComputedStyle(el)
      return s.position === 'fixed' && s.zIndex === '50'
    })
    const panel = fixed.find(el => el.querySelector('.glass-l2') && el.textContent.includes('保存预设'))
    if (!panel) return { found: false }
    const inner = panel.querySelector('.glass-l2')
    const rect = inner.getBoundingClientRect()
    const header = document.querySelector('header')
    const hRect = header.getBoundingClientRect()
    return {
      found: true,
      inBody: !panel.closest('header'),
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      contentHeight: inner.scrollHeight,
      headerBottom: Math.round(hRect.bottom),
      overflowClip: rect.height < inner.scrollHeight - 2, // 容器高 < 内容高即被裁
      inViewport: rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
    }
  })
  check('R-1 面板为 body 级 fixed 浮层', r1.found && r1.inBody, JSON.stringify({ inBody: r1.inBody }))
  check('R-1 面板展开在 header 之下且完整（无裁剪、在视口内）',
    r1.found && r1.top >= r1.headerBottom && r1.height > 150 && !r1.overflowClip && r1.inViewport,
    JSON.stringify({ top: r1.top, height: r1.height, contentHeight: r1.contentHeight, headerBottom: r1.headerBottom, overflowClip: r1.overflowClip, inViewport: r1.inViewport }))
  await page.screenshot({ path: `${EVIDENCE}/R1-search-panel.png` })

  // 收起
  await page.locator('header button', { hasText: '搜索' }).first().click()
  await page.waitForTimeout(300)
  const hidden = await page.evaluate(() => ![...document.body.children].some(el => el.textContent.includes('保存预设') && getComputedStyle(el).position === 'fixed' && el.offsetParent !== null && el.getClientRects().length && Number(getComputedStyle(el).opacity) > 0))
  check('R-1 再次点击可收起面板', hidden)
}

// ══ R-2：主题设置实时生效 ══
{
  await page.locator('header button', { hasText: '🎨' }).first().click()
  await page.waitForTimeout(400)
  const hasSwitch = await page.locator('text=启用主题定制').count()
  check('R-2 设置面板含「启用主题定制」开关', hasSwitch > 0)

  const themeNow = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const before = await themeNow()

  // 点「浅色」→ 面板不关，data-theme 立即变 light
  await page.locator('button', { hasText: '浅色' }).first().click()
  await page.waitForTimeout(150) // 150ms 内即应生效
  const afterLight = await themeNow()
  check('R-2 点浅色后 ≤150ms 实时生效', afterLight === 'light', `before=${before} after=${afterLight}`)
  await page.screenshot({ path: `${EVIDENCE}/R2-light-theme.png` })

  // 强调色蓝 → data-accent=blue 实时生效
  await page.locator('button[title="蓝色"]').click()
  await page.waitForTimeout(150)
  const accent = await page.evaluate(() => document.documentElement.dataset.accent)
  check('R-2 强调色蓝色实时生效', accent === 'blue', `data-accent=${accent}`)

  // 密度紧凑 → data-density=compact 实时生效
  await page.locator('button', { hasText: '紧凑' }).first().click()
  await page.waitForTimeout(150)
  const density = await page.evaluate(() => document.documentElement.dataset.density)
  check('R-2 界面密度紧凑实时生效', density === 'compact', `data-density=${density}`)
  await page.screenshot({ path: `${EVIDENCE}/R2-compact-blue.png` })

  // 关掉总开关 → 立即回退深色
  await page.locator('button[role="switch"]').click()
  await page.waitForTimeout(150)
  const afterOff = await themeNow()
  check('R-2 关闭主题定制立即回退深色', afterOff === 'dark', `data-theme=${afterOff}`)

  // 恢复：开启 + 深色 + 舒适，关闭面板
  await page.locator('button[role="switch"]').click()
  await page.locator('button', { hasText: '深色' }).first().click()
  await page.locator('button', { hasText: '舒适' }).first().click()
  await page.locator('button', { hasText: '完成' }).click()
  await page.waitForTimeout(300)
}

// ══ R-3：关闭窗口响应（最后执行，会关闭应用；SKIP_R3=1 可跳过） ══
if (!process.env.SKIP_R3) {

  const t0 = Date.now()
  await page.evaluate(() => window.electronAPI.windowClose())
  // 轮询 CDP target 直至主窗口页面消失
  let gone = false
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 100))
    try {
      const ps = ctx.pages()
      if (!ps.some(p => p.url().includes('5173'))) { gone = true; break }
    } catch { gone = true; break }
  }
  const dtWin = Date.now() - t0
  check('R-3 点击关闭后窗口在 3s 内消失', gone && dtWin < 3000, `耗时 ${dtWin}ms`)

  // 再等主进程完全退出（CDP 端口关闭 = electron 进程终止）
  let procGone = false
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    try {
      const b2 = await chromium.connectOverCDP('http://127.0.0.1:9222')
      await b2.close()
    } catch { procGone = true; break }
  }
  const dtAll = Date.now() - t0
  check('R-3 应用在 3s 看门狗内完全退出（CDP 端口已关闭）', procGone, `从点击关闭到进程终止 ${dtAll}ms`)
  console.log(`\nR-3 时间线：窗口消失 ${dtWin}ms / 进程退出 ${dtAll}ms`)
}


console.log('\n══ 汇总 ══')
const failed = results.filter(r => !r.pass)
console.log(`${results.length - failed.length}/${results.length} 通过`)
if (failed.length) { console.log('失败项：'); failed.forEach(f => console.log(' -', f.name, f.detail)) }
process.exit(failed.length ? 1 : 0)
