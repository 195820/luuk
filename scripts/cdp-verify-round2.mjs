/**
 * 第二轮人工反馈修复验证（CDP 非抢占）
 * 1. 搜索 jpg 格式筛选出结果  2. 浅色主题真正变浅  3. 密度调节改变按钮尺寸
 * 4. 新增库扫描无全屏遮罩（后台非阻塞）  5. 关闭后进程 3s 内退出
 * 运行：node scripts/cdp-verify-round2.mjs （需 npm run dev 已启动）
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

// ── 准备：切到 test 库 ──
await page.locator('header [role=combobox]').first().click()
await page.waitForTimeout(400)
await page.locator('[role=option]', { hasText: /^test - / }).first().click({ timeout: 3000, force: true })
await page.waitForTimeout(1500)

// ══ 1. 搜索 jpg 筛选 ══
{
  // 后端层：直接走 IPC 查 DB（验证 database.ts 修复）
  const apiRes = await page.evaluate(async () => {
    const libs = await window.electronAPI.getLibraries()
    const testLib = libs.find(l => l.name === 'test')
    if (!testLib) return { err: '未找到 test 库' }
    const r = await window.electronAPI.searchImages(testLib.id, { formats: ['jpg'] }, { offset: 0, limit: 50 })
    return { total: r.total, count: r.images.length, firstFormat: r.images[0]?.format }
  })
  check('搜索后端 jpg 筛选返回结果', !apiRes.err && apiRes.total > 0, JSON.stringify(apiRes))

  // UI 层：面板点 JPG → 搜索 → 网格有图
  await page.locator('header button', { hasText: '搜索' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('.fixed.z-50 button', { hasText: /^JPG$/i }).first().click()
  await page.locator('.fixed.z-50 button', { hasText: '搜索' }).last().click()
  await page.waitForTimeout(1200)
  const gridImgs = await page.evaluate(() => document.querySelectorAll('main img').length)
  check('搜索 UI 结果网格显示图片', gridImgs > 0, `main img 数=${gridImgs}`)
  await page.screenshot({ path: `${EVIDENCE}/F1-search-jpg.png` })
  // 清空搜索回到库视图
  await page.locator('header button', { hasText: /清空|✕/ }).first().click().catch(() => {})
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

// ══ 2. 浅色主题 + 3. 密度 ══
{
  await page.locator('header button', { hasText: '🎨' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('button', { hasText: '浅色' }).first().click()
  await page.waitForTimeout(300)
  const light = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor
    const header = document.querySelector('header')
    const hbg = header ? getComputedStyle(header).backgroundColor : ''
    const txt = document.querySelector('h1') ? getComputedStyle(document.querySelector('p, span')).color : ''
    return { bg, hbg, txt }
  })
  const bgNums = light.bg.match(/\d+/g)?.map(Number) || [0, 0, 0]
  check('浅色主题 body 背景为浅色', bgNums[0] > 200 && bgNums[1] > 200 && bgNums[2] > 200, light.bg)
  await page.screenshot({ path: `${EVIDENCE}/F2-light-theme.png` })

  // 密度：先显式回到舒适作为基线，再测紧凑/宽松
  await page.locator('button', { hasText: '舒适' }).first().click()
  await page.waitForTimeout(300)
  const wComfort = await page.evaluate(() => document.querySelector('header .btn-icon')?.getBoundingClientRect().width ?? 0)
  await page.locator('button', { hasText: '紧凑' }).first().click()
  await page.waitForTimeout(300)
  const wCompact = await page.evaluate(() => document.querySelector('header .btn-icon')?.getBoundingClientRect().width ?? 0)
  await page.locator('button', { hasText: '宽松' }).first().click()
  await page.waitForTimeout(300)
  const wSpacious = await page.evaluate(() => document.querySelector('header .btn-icon')?.getBoundingClientRect().width ?? 0)
  check('密度改变按钮尺寸（紧凑<舒适<宽松）',
    wCompact < wComfort && wSpacious > wComfort,
    `compact=${wCompact.toFixed(1)} comfortable=${wComfort.toFixed(1)} spacious=${wSpacious.toFixed(1)}`)
  await page.screenshot({ path: `${EVIDENCE}/F2-spacious-light.png` })

  // 恢复默认：舒适 + 深色，关面板
  await page.locator('button', { hasText: '舒适' }).first().click()
  await page.locator('button', { hasText: '深色' }).first().click()
  await page.locator('button', { hasText: '完成' }).click()
  await page.waitForTimeout(300)
}

// ══ 4. 新增库后台扫描：无全屏遮罩 ══
{
  // 幂等：先清理可能残留的测试库
  await page.evaluate(async () => {
    const libs = await window.electronAPI.getLibraries()
    for (const l of libs.filter(x => ['cdp-验证库', 'cdp-关闭测试库', 'cdp-压力库', 'cdp-heavy库'].includes(x.name))) {
      await window.electronAPI.removeLibrary(l.id)
    }
  })
  await page.waitForTimeout(300)
  const scan = await page.evaluate(async () => {
    // 直接走 IPC 添加库（跳过原生目录选择对话框），autoScan=true
    const lib = await window.electronAPI.addLibrary('cdp-验证库', 'D:/luuk/test-library/set01', true)
    // 扫描进行中检查是否存在全屏阻塞遮罩（fixed + inset-0 + 高 z-index + 覆盖视口）
    let overlaySeen = false
    for (let i = 0; i < 20; i++) {
      overlaySeen = [...document.querySelectorAll('div')].some(el => {
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return s.position === 'fixed' && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9 && Number(s.zIndex) >= 1000 && s.backgroundColor !== 'rgba(0, 0, 0, 0)'
      })
      if (overlaySeen) break
      await new Promise(r => setTimeout(r, 150))
    }
    return { id: lib?.id ?? lib?.library?.id, overlaySeen }
  })
  check('新增库扫描无全屏遮罩（后台非阻塞）', !scan.overlaySeen, JSON.stringify(scan))
  // 等扫描完成后清理测试库（用端口存活判断而非 page 等待，避免中途重启导致崩溃）
  await new Promise(r => setTimeout(r, 4000))
  if (scan.id) {
    try {
      await page.evaluate((id) => window.electronAPI.removeLibrary(id), scan.id)
      check('测试库已清理', true, `removeLibrary(${scan.id})`)
    } catch (e) {
      check('测试库已清理', false, String(e.message).slice(0, 60))
    }
  }
}

// ══ 5. 关闭：electron 主进程 3s 内真正退出 ══
{
  // 不用 CDP 端口释放作判据：本脚本共享一条长连接、前面测试创建了多个 target，
  // app.exit 后端口时机受残留 target 干扰而失真。改用 tasklist 检测 electron 进程是否全部消失（唯一、无歧义）。
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const exec = promisify(execFile)
  const electronProcs = async () => {
    try {
      const { stdout } = await exec('tasklist', ['/fi', 'imagename eq electron.exe', '/fo', 'csv', '/nh'])
      return stdout.trim().split('\n').filter(l => l.includes('electron.exe')).length
    } catch { return -1 }
  }
  const t0 = Date.now()
  await page.evaluate(() => window.electronAPI.windowClose()).catch(() => {})
  let procGone = false
  const rows = async () => {
    try {
      const { stdout } = await exec('tasklist', ['/fi', 'imagename eq electron.exe', '/fo', 'csv', '/nh'])
      return stdout.trim().split('\n').filter(l => l.includes('electron.exe'))
    } catch { return ['<err>'] }
  }
  for (let i = 0; i < 100; i++) {
    const r = await rows()
    if (r.length === 0 || (r.length === 1 && r[0].includes('INFO'))) { procGone = true; break }
    if (i % 4 === 0) console.log(`   [${Date.now() - t0}ms] 残留 ${r.length}: ${r.map(x => x.split('","')[1] + 'mem=' + x.split('","')[4]).join(' | ')}`)
    await new Promise(res => setTimeout(res, 50))
  }
  const dt = Date.now() - t0
  check('关闭后 electron 进程 3s 内全退（tasklist 实测）', procGone && dt < 3000, `耗时 ${dt}ms`)
}

console.log('\n══ 汇总 ══')
const failed = results.filter(r => !r.pass)
console.log(`${results.length - failed.length}/${results.length} 通过`)
if (failed.length) { console.log('失败项：'); failed.forEach(f => console.log(' -', f.name, f.detail)) }
process.exit(failed.length ? 1 : 0)
