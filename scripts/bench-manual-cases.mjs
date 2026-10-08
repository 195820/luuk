// 手动用例半自动执行 harness（T-5：docs/archive/文件操作阶段测试执行记录.md 中可量化子项）
// 覆盖：TC-PERF-001/002/003、TC-GRID-001/002/004、TC-THUMB-004（程序可验证子项）
//用法：先 `npx vite build`，再 `node scripts/bench-manual-cases.mjs`
// 说明：TC-THUMB-005（7780 张连浏览 + 内存曲线）在 Phase C 做大样本近似执行；
//       Electron 40 忽略主进程 `-r`，改在共享 profile 内以 bench-* 命名并于启动时自清，不碰用户库。
import { _electron as electron } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const MAIN = path.join(ROOT, 'dist-electron/main.js')
const LIB_LARGE = path.join(ROOT, 'test-data/large-library') // 1000 张
const LIB_HUGE = path.join(ROOT, 'test-data/huge-library') // 7780 张
const LIB_MULTI1 = path.join(ROOT, 'test-data/multi-library-1') // 51 张
const PROFILE_BASE = path.join(os.tmpdir(), 'luuk-bench-profile')

const results = {}
const liveApps = []
const t0 = () => Date.now()
const elapsed = (start) => Date.now() - start

async function launch(profile) {
  fs.mkdirSync(profile, { recursive: true })
  const app = await electron.launch({
    args: [MAIN, '--no-sandbox', '--disable-gpu-sandbox'],
    cwd: ROOT,
    timeout: 120000,
  })
  const page = await app.firstWindow({ timeout: 90000 })
  liveApps.push(app)
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  // 只清理本 harness 自己的 bench-* 库，用户库不受影响
  await page.evaluate(async () => {
    const libs = await window.electronAPI.getLibraries()
    for (const l of libs.filter(x => x.name && x.name.startsWith('bench-'))) {
      await window.electronAPI.removeLibrary(l.id).catch(() => {})
    }
  })
  return { app, page }
}

async function memSnap(app, page) {
  const main = await app.evaluate(() => process.memoryUsage().rss)
  let renderer = null
  try {
    renderer = await page.evaluate(() => {
      const m = performance.memory
      return m ? Math.round(m.usedJSHeapSize / 1048576) : null
    })
  } catch { /* performance.memory 可能不可用 */ }
  return { mainRssMB: Math.round(main / 1048576), rendererUsedJSHeapMB: renderer }
}

async function cardCount(page) {
  return page.locator('.grid-card').count()
}

async function scrollPos(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.overflow-auto.p-4')
    return el ? el.scrollTop : -1
  })
}

async function switchLibrary(page, _fromText, toText) {
  // 头部库选择器 trigger 文本随当前库变化；base-ui portal 遮罩会拦截 pointer，改 force 点击
  await page.getByRole('combobox').first().click({ force: true }).catch(async () => {
    await page.locator('button', { hasText: '收藏夹' }).first().click({ force: true })
  })
  // 选项超出下拉虚拟窗口时 getByText 不可见：用 Home+方向键导航到目标项后回车
  const opt = page.getByText(toText, { exact: false }).first()
  if (await opt.isVisible().catch(() => false)) {
    await opt.click({ force: true })
  } else {
    await page.keyboard.press('Home')
    for (let i = 0; i < 30; i++) {
      if (await opt.isVisible().catch(() => false)) break
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(60)
    }
    await opt.click({ force: true })
  }
  await page.waitForTimeout(2000)
}

async function main() {
  // ══ Phase A：冷启动（全新 harness profile；Roaming\Electron 仅由本 harness 创建，可安全重置）══
  fs.rmSync(path.join(process.env.APPDATA, 'Electron'), { recursive: true, force: true })
  const coldStart = t0()
  let { app, page } = await launch(PROFILE_BASE)
  await page.waitForTimeout(1500)
  results.coldStartupMs = elapsed(coldStart)
  results.coldIdleMem = await memSnap(app, page)
  results.userData = await app.evaluate(({ app: a }) => a.getPath('userData'))

  // ══ Phase B：真实扫描 + 网格交互指标 ══
  const libs = await page.evaluate(async (paths) => {
    await window.electronAPI.addLibrary('bench-large', paths.large, false)
    await window.electronAPI.addLibrary('bench-multi1', paths.multi1, false)
    return window.electronAPI.getLibraries()
  }, { large: LIB_LARGE, multi1: LIB_MULTI1 })
  const libLarge = libs.find(l => l.name === 'bench-large')
  const libMulti1 = libs.find(l => l.name === 'bench-multi1')
  if (!libLarge || !libMulti1) throw new Error('库注册失败')

  const scanStart = t0()
  results.scanRes = await page.evaluate(async (id) => await window.electronAPI.scanLibrary(id), libLarge.id)
  results.scanLargeMs = elapsed(scanStart) // 含缩略图生成的端到端扫描
  results.scanImageCount = await page.evaluate(async (id) => (await window.electronAPI.getImages(id, { limit: 5000, offset: 0 })).length, libLarge.id)

  // 首渲染：切换到 bench-large 并等首张卡片
  await switchLibrary(page, '', 'bench-large')
  const renderStart = t0()
  await page.waitForSelector('.grid-card', { timeout: 20000 })
  results.firstRenderMs = elapsed(renderStart)
  await page.waitForTimeout(1500)
  results.memAfterLoad = await memSnap(app, page)
  results.domNodesAtTop = await cardCount(page)

  // 虚拟滚动：DOM 节点数是否近似恒定
  const counts = []
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => { const el = document.querySelector('.overflow-auto.p-4'); if (el) el.scrollTop += 2000 })
    await page.waitForTimeout(400)
    counts.push(await cardCount(page))
  }
  results.domNodesDuringScroll = counts
  results.memAfterScroll = await memSnap(app, page)

  // 懒加载：可见区缩略图 src 填充比例
  results.thumbSrcFilled = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('.grid-card img'))
    return { total: imgs.length, filled: imgs.filter(i => i.src && i.src !== location.href).length }
  })

  // 滚动位置记忆：双击进查看器 → Esc 返回 → scrollTop 基本保持
  const posBefore = await scrollPos(page)
  const n = await cardCount(page)
  await page.locator('.grid-card').nth(Math.min(5, n - 1)).dblclick()
  await page.waitForTimeout(2500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)
  const posAfter = await scrollPos(page)
  results.scrollMemory = { before: posBefore, after: posAfter, preserved: posBefore > 0 && Math.abs(posBefore - posAfter) < 600 }

  // 跨库缓存隔离：两库图片集与缩略图 src 不重叠
  const grab = async (id) => page.evaluate(async (libId) => {
    const imgs = await window.electronAPI.getImages(libId, { limit: 200, offset: 0 })
    const dom = Array.from(document.querySelectorAll('.grid-card img')).map(i => i.getAttribute('src') || '')
    return { keys: imgs.map(i => String(i.id)), domSrcs: dom.slice(0, 12) }
  }, id)
  const setA = await (async () => { await switchLibrary(page, '', 'bench-multi1'); return grab(libMulti1.id) })()
  const setB = await (async () => { await switchLibrary(page, '', 'bench-large'); return grab(libLarge.id) })()
  const keyOverlap = setA.keys.filter(k => setB.keys.includes(k)).length
  const srcOverlap = setA.domSrcs.filter(s => s && setB.domSrcs.includes(s)).length
  results.crossLibraryIsolation = { overlapKeys: keyOverlap, overlapThumbSrcs: srcOverlap, pass: keyOverlap === 0 && srcOverlap === 0 }

  await app.close()

  // ══ Phase C（可选，超时预算内做大样本 LRU 近似）：huge-library 扫描 + 连续加载浏览 ══
  if (process.env.LUUK_BENCH_HUGE === '1') {
    const third = await launch(PROFILE_BASE)
    const hugeId = await third.page.evaluate(async (p) => {
      await window.electronAPI.addLibrary('bench-huge', p, false)
      const ls = await window.electronAPI.getLibraries()
      return ls.find(l => l.name === 'bench-huge').id
    }, LIB_HUGE)
    const hs = t0()
    // LUUK_BENCH_COLD_HUGE=1 时先清库内 .ivlib 缩略图缓存，测真实冷扫描（含缩略图生成）
    // 注：removeLibrary 未必关闭库侧 ThumbnailsDB 句柄，EPERM 时退化为热扫描并在结果中标记
    if (process.env.LUUK_BENCH_COLD_HUGE === '1') {
      try {
        fs.rmSync(path.join(LIB_HUGE, '.ivlib'), { recursive: true, force: true })
        results.scanHugeCold = true
      } catch (e) {
        results.scanHugeCold = false
        results.scanHugeColdSkip = String(e).slice(0, 120)
      }
    } else {
      results.scanHugeCold = false
    }
    await third.page.evaluate(async (id) => await window.electronAPI.scanLibrary(id), hugeId)
    results.scanHugeMs = elapsed(hs)
    await switchLibrary(third.page, '', 'bench-huge')
    await third.page.waitForSelector('.grid-card', { timeout: 30000 })
    const hugeMems = []
    for (let i = 0; i < 10; i++) {
      await third.page.evaluate(() => { const el = document.querySelector('.overflow-auto.p-4'); if (el) el.scrollTop += 6000 })
      await third.page.waitForTimeout(1200)
      hugeMems.push(await memSnap(third.app, third.page))
    }
    results.hugeScrollMems = hugeMems
    await third.app.close()
  }

  // ══ Phase D：热启动（同 profile 重启，库/缩略图已存在，切库走缓存路径）══
  const hotStart = t0()
  const second = await launch(PROFILE_BASE)
  // 自愈清理会移走 bench-*，重新注册（已入库文件 → 增量扫描全 skip，验证二次扫描跳过的热路径）
  const libs2 = await second.page.evaluate(async (p) => {
    await window.electronAPI.addLibrary('bench-large', p, false)
    return window.electronAPI.getLibraries()
  }, LIB_LARGE)
  const libLarge2 = libs2.find(l => l.name === 'bench-large')
  const rescanStart = t0()
  results.rescanRes = await second.page.evaluate(async (id) => await window.electronAPI.scanLibrary(id), libLarge2.id)
  results.rescanLargeMs = elapsed(rescanStart)
  await second.page.waitForTimeout(1200)
  results.hotStartupMs = elapsed(hotStart)
  await switchLibrary(second.page, '', 'bench-large')
  const hotRender = t0()
  await second.page.waitForSelector('.grid-card', { timeout: 20000 })
  results.hotFirstRenderMs = elapsed(hotRender)
  results.hotIdleMem = await memSnap(second.app, second.page)
  await second.app.close()

  console.log('===JSON===')
  console.log(JSON.stringify(results, null, 2))
}

main().catch(async err => {
  console.error('HARNESS FAILED:', err)
  console.log('===JSON===')
  console.log(JSON.stringify({ error: String(err).slice(0, 300), partial: results }, null, 2))
  // 尽力关闭本 harness 自己拉起的实例，避免文件锁污染下次运行
  for (const a of liveApps) { await a.close().catch(() => {}) }
  process.exit(1)
})
