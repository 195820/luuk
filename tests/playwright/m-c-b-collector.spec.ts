/**
 * M-C 自动化子集 · B 类半自动脚本采集组
 *
 * 回收手册 §2.6 / §3 / §4 中"可用脚本采集 + 可断言红线"的半自动项：
 *   - B1  MT-EDGE-02  扫描中断：kill 主进程 → 重启 → master.db integrity_check=ok + 无重复脏行 + 重扫计数一致
 *   - B2  TC-PERF-003 冷启动耗时 + 关闭耗时（close()）
 *   - B3  TC-PERF-001 100 张首扫吞吐（红线 <30s）
 *   - B4  PH8-21/22   批处理聚合 RSS 峰值（红线 <2500MB，不 OOM）
 *   - B5  退出 temp 终清：graceful close 后 %TEMP%\luuk-thumb-* == 0
 *
 * 需外部素材/联网的项（模型下载 / 1GB 视频 seek / 主观画质）属 C 类真人工，本组不收录。
 * 运行（需 Node-ABI better_sqlite3 绑定，供 B1 直连 master.db）：
 *   $env:BETTER_SQLITE3_NATIVE_BINDING=(Resolve-Path ".test-native\better_sqlite3.node").Path
 *   node node_modules/@playwright/test/cli.js test --config=tests/playwright.config.ts tests/playwright/m-c-b-collector.spec.ts
 */
import { electronTest as test, expect } from './fixtures'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { createRequire } from 'module'
import path from 'path'
import fs from 'fs'
import os from 'os'

const PROJECT_ROOT = process.cwd()
const ELECTRON_MAIN = path.join(PROJECT_ROOT, 'dist-electron', 'main.js')
const TEST_LIBRARY = path.join(PROJECT_ROOT, 'test-library')
// B1 供测试进程（Node ABI）直连 better-sqlite3 的显式绑定路径；与 Electron 启动 env 隔离。
const SQLITE_NODE_BINDING = path.join(PROJECT_ROOT, '.test-native', 'better_sqlite3.node')

// ─── helpers ───────────────────────────────────────────────
async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: any }> {
  // 重启动 Electron：必须剔除 BETTER_SQLITE3_NATIVE_BINDING（那是给 Node 侧用的 Node-ABI 绑定，
  // 若泄漏进主进程 database.ts 的 sqliteOptions 会加载错 ABI 导致 boot 崩溃、窗口不出现）。
  const childEnv: any = { ...process.env, NO_AUTO_DEVTOOLS: '1' }
  delete childEnv.BETTER_SQLITE3_NATIVE_BINDING
  // 重启实例设 NODE_ENV=production，避开 main.ts 里硬编码的 --remote-debugging-port=9222；
  // 否则前一实例被 SIGKILL 后 9222 未释放，新实例 bind 失败会卡住 boot（loadFile 路径由 DEV_MODE 决定，与 NODE_ENV 无关）。
  childEnv.NODE_ENV = 'production'
  const app = await electron.launch({
    args: [ELECTRON_MAIN, '--no-sandbox', '--disable-gpu-sandbox', '--user-data-dir', userDataDir],
    cwd: PROJECT_ROOT,
    env: childEnv,
    timeout: 60000,
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('h1:has-text("图片查看器")', { timeout: 30000 })
  return { app, page }
}

async function rmWithRetry(dir: string, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      if (!fs.existsSync(dir)) return
    } catch { /* 文件锁未释放，重试 */ }
    await new Promise(r => setTimeout(r, 1000))
  }
}

/** 把 test-library 的 setNN/photo*.jpg 复制到临时库根（去 .ivlib / _edits），返回绝对路径 */
function makeTempScanLib(tag: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `iv-b-${tag}-`))
  const sets = fs.readdirSync(TEST_LIBRARY).filter((d) => /^set\d+$/.test(d))
  for (const s of sets) {
    const srcDir = path.join(TEST_LIBRARY, s)
    const dstDir = path.join(dest, s)
    fs.mkdirSync(dstDir, { recursive: true })
    for (const f of fs.readdirSync(srcDir)) {
      if (/^photo\d+\.(jpg|jpeg|png)$/i.test(f)) fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f))
    }
  }
  return dest
}

function countImageFiles(root: string): number {
  let n = 0
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name)
    if (name === '.ivlib' || name === '_edits') continue
    const st = fs.statSync(full)
    if (st.isDirectory()) n += countImageFiles(full)
    else if (/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name)) n++
  }
  return n
}

/** 轮询 getImageCount 直到连续两次稳定（扫描完成）或超时 */
async function waitScanStable(page: any, libId: number, timeoutMs = 45000): Promise<{ count: number; ms: number }> {
  const t0 = Date.now()
  let prev = -1
  let stable = 0
  while (Date.now() - t0 < timeoutMs) {
    const c: number = await page.evaluate((id: number) => (window as any).electronAPI.getImageCount(id), libId)
    if (c === prev && c > 0) { if (++stable >= 2) return { count: c, ms: Date.now() - t0 } } else stable = 0
    prev = c
    await page.waitForTimeout(500)
  }
  return { count: prev, ms: Date.now() - t0 }
}

/** 采样聚合工作集内存（MB）：全应用各进程 workingSetSize 之和 */
async function sampleAggregateRSSMB(app: ElectronApplication): Promise<number> {
  const mb = await app.evaluate(({ app: a }) => {
    return a.getAppMetrics().reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0)
  })
  // getAppMetrics.workingSetSize 单位为 KB
  return Math.round((mb as number) / 1024)
}

// ═════════════════════════════════════════════════════════════════
test.describe('B 类采集', () => {
  test.setTimeout(180000)

  // B2 冷启动 + 关闭耗时（独立实例，不干扰 fixture）
  test('B2 TC-PERF-003 冷启动耗时 + 关闭耗时', async ({ tmpUserData }) => {
    const t0 = Date.now()
    const { app } = await launchApp(tmpUserData)
    const bootMs = Date.now() - t0

    const tc0 = Date.now()
    await app.close()
    const closeMs = Date.now() - tc0

    console.log(`  [B] 冷启动=${bootMs}ms  关闭=${closeMs}ms`)
    // 红线：冷启动 <5s（手册 §0 PH8-01）/ 关闭 ≤5s（MT-EDGE-02 自动化基线）；headless 留 1.5× 余量
    expect(bootMs).toBeLessThan(8000)
    expect(closeMs).toBeLessThan(5000)
  })

  // B3 100 张首扫吞吐
  test('B3 TC-PERF-001 百张首扫吞吐 < 30s', async ({ page }) => {
    const libDir = makeTempScanLib('scan')
    let libId = 0
    try {
      const onDisk = countImageFiles(libDir)
      const r = await page.evaluate(async (dir: string) => {
        const api = (window as any).electronAPI
        const lib = await api.addLibrary(`B扫描库 ${Date.now()}`, dir.replace(/\\/g, '/'), false)
        return { id: lib?.id ?? lib }
      }, libDir)
      libId = r.id
      await page.evaluate((id: number) => (window as any).electronAPI.scanLibrary(id), libId)
      const { count, ms } = await waitScanStable(page, libId)
      console.log(`  [B] 首扫 ${count} 张 / ${ms}ms（磁盘 ${onDisk}）→ ${(ms / Math.max(count, 1)).toFixed(2)}ms/张`)
      expect(count).toBeGreaterThanOrEqual(onDisk * 0.95) // 绝大多数入库
      expect(ms).toBeLessThan(30000)                       // 红线 <30s
    } finally {
      if (libId) await page.evaluate((id: number) => (window as any).electronAPI.removeLibrary(id), libId).catch(() => {})
      await rmWithRetry(libDir)
    }
  })

  // B4 批处理聚合 RSS 峰值（红线 <2500MB）
  test('B4 PH8-21/22 批处理聚合 RSS 峰值不破红色水位', async ({ page, electronApp }) => {
    const libDir = makeTempScanLib('mem')
    let libId = 0
    try {
      const add = await page.evaluate(async (dir: string) => {
        const api = (window as any).electronAPI
        const lib = await api.addLibrary(`B内存库 ${Date.now()}`, dir.replace(/\\/g, '/'), false)
        return { id: lib?.id ?? lib }
      }, libDir)
      libId = add.id
      await page.evaluate((id: number) => (window as any).electronAPI.scanLibrary(id), libId)
      const { count } = await waitScanStable(page, libId)
      const images = await page.evaluate(async (id: number) => {
        const res = await (window as any).electronAPI.getImages(id, { limit: 40, offset: 0 })
        const arr: any[] = Array.isArray(res) ? res : (res?.images ?? [])
        return arr.map((i: any) => i.id)
      }, libId)
      expect(images.length).toBeGreaterThan(0)
      void count

      // 启用 autotone（真实 Worker）→ 入队批处理
      await page.evaluate(async () => {
        const api = (window as any).electronAPI
        await api.settingsSet('plugins.enabled', true)
        await api.pluginsList()
      })
      const en = await page.evaluate(() => (window as any).electronAPI.pluginsSetEnabled('builtin.autotone', true))
      expect(en?.success).toBe(true)
      const enq = await page.evaluate(async ({ id, iids }: { id: number; iids: number[] }) => {
        const api = (window as any).electronAPI
        const items = iids.map((iid: number) => ({ libraryId: id, imageId: iid }))
        return await api.jobsEnqueue('ai.autotone.auto', {}, { items })
      }, { id: libId, iids: images })
      expect(enq.success).toBe(true)

      // 采样峰值 RSS 直到作业终态
      let peak = 0
      let state = ''
      const deadline = Date.now() + 90000
      while (Date.now() < deadline) {
        peak = Math.max(peak, await sampleAggregateRSSMB(electronApp))
        const r = await page.evaluate((jid: string) => (window as any).electronAPI.jobsGet(jid), enq.data)
        state = r?.data?.state
        if (state === 'done' || state === 'failed' || state === 'cancelled') break
        await page.waitForTimeout(500)
      }
      console.log(`  [B] 批处理 ${images.length} 张：作业终态=${state} 聚合RSS峰值=${peak}MB`)
      expect(state).toBe('done')
      expect(peak).toBeLessThan(2500) // 红色水位红线
    } finally {
      if (libId) await page.evaluate((id: number) => (window as any).electronAPI.removeLibrary(id), libId).catch(() => {})
      await rmWithRetry(libDir)
    }
  })

  // B5 退出 temp 终清 luuk-thumb-*
  test('B5 退出后 %TEMP%\\luuk-thumb-* 清零', async ({ page, electronApp }) => {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('luuk-thumb-')).length
    console.log(`  [B] 关闭前 luuk-thumb-* =${before}`)
    // 触发生成缩略图/视频帧（temp 目录由 thumbnailer 创建）
    await page.evaluate(async () => {
      const api = (window as any).electronAPI
      const libs = await api.getLibraries()
      const lib = libs.find((l: any) => (l.root_path || l.rootPath || '').includes('test-library'))
      if (!lib) return
      const res = await api.getImages(lib.id, { limit: 8, offset: 0 })
      const arr: any[] = Array.isArray(res) ? res : (res?.images ?? [])
      if (arr.length) await api.getThumbnails(lib.id, arr.map((i: any) => i.id), 'medium').catch(() => {})
    })
    await page.waitForTimeout(1500)

    const t0 = Date.now()
    await electronApp.close() // before-quit → cleanupThumbnailTempDirs()
    while (Date.now() - t0 < 8000) {
      const left = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('luuk-thumb-')).length
      if (left === 0) break
      await new Promise(r => setTimeout(r, 500))
    }
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('luuk-thumb-')).length
    console.log(`  [B] 退出后 luuk-thumb-* =${after}`)
    expect(after).toBe(0)
  })

  // B1 扫描中断 → 重启 master.db + 分库 thumbs.db 完整性（直连 SQLite 校验 + 重启后计数一致）
  test('B1 MT-EDGE-02 扫描中断重启无脏库', async ({ page, electronApp }) => {
    const libDir = makeTempScanLib('kill')
    let keepLibId = 0
    let app2: ElectronApplication | undefined
    const Database = createRequire(path.join(PROJECT_ROOT, 'noop.cjs'))('better-sqlite3')
    const openDb = (p: string) => new Database(p, fs.existsSync(SQLITE_NODE_BINDING) ? { nativeBinding: SQLITE_NODE_BINDING } : {})
    try {
      const userData: string = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const masterDb = path.join(userData, 'data', 'master.db')
      const onDisk = countImageFiles(libDir)

      // 建库（master.db 落库注册行）+ 触发扫描后立即硬杀主进程（模拟扫描中崩溃，无 before-quit）
      const r = await page.evaluate(async (dir: string) => {
        const api = (window as any).electronAPI
        const lib = await api.addLibrary(`B中断库 ${Date.now()}`, dir.replace(/\\/g, '/'), false)
        return { id: lib?.id ?? lib }
      }, libDir)
      keepLibId = r.id
      await page.evaluate((id: number) => (window as any).electronAPI.scanLibrary(id), keepLibId)
      await page.waitForTimeout(300) // 让扫描进行到一半

      const proc = (electronApp as any).process?.()
      if (proc) { try { proc.kill('SIGKILL') } catch { /* gone */ } }
      await page.waitForTimeout(2500) // 等进程彻底退出，释放 SQLite/WAL 文件句柄

      // 直连校验 master.db 完整性（jobs/libraries 表在此）
      expect(fs.existsSync(masterDb)).toBe(true)
      const mdb = openDb(masterDb)
      const mInteg: any = mdb.prepare('PRAGMA integrity_check').get()
      mdb.close()
      console.log(`  [B] master.db integrity_check=${JSON.stringify(mInteg)}`)
      expect(Object.values(mInteg)[0]).toBe('ok')

      // 直连校验分库 thumbs.db（images 表在此，relative_path UNIQUE）完整性 + 无重复
      const thumbsDb = path.join(libDir, '.ivlib', 'thumbs.db')
      expect(fs.existsSync(thumbsDb)).toBe(true)
      const tdb = openDb(thumbsDb)
      const tInteg: any = tdb.prepare('PRAGMA integrity_check').get()
      const dup: any = tdb.prepare(
        'SELECT COUNT(*) AS d FROM (SELECT relative_path, COUNT(*) c FROM images GROUP BY relative_path HAVING c > 1)'
      ).get()
      tdb.close()
      console.log(`  [B] thumbs.db integrity_check=${JSON.stringify(tInteg)} 重复relative_path=${dup?.d}`)
      expect(Object.values(tInteg)[0]).toBe('ok')
      expect(dup.d).toBe(0) // UNIQUE + 事务保证：半写崩溃不产生重复脏行

      // 重启后：库仍注册于 master.db，重扫计数与磁盘文件一致（自愈无脏库）
      const relaunched = await launchApp(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-b-kill-ud-')))
      app2 = relaunched.app
      const page2 = relaunched.page
      const libs = await page2.evaluate(() => (window as any).electronAPI.getLibraries())
      expect((libs || []).some((l: any) => l.id === keepLibId)).toBe(true) // 崩溃未丢库注册
      await page2.evaluate((id: number) => (window as any).electronAPI.scanLibrary(id), keepLibId)
      const { count } = await waitScanStable(page2, keepLibId)
      console.log(`  [B] 重启重扫=${count} 磁盘=${onDisk}`)
      expect(count).toBeGreaterThanOrEqual(onDisk * 0.95)
    } finally {
      if (app2) { try { await app2.close() } catch { /* ignore */ } }
      if (keepLibId) { /* 残留在共享 master.db，目录删除后离线无害 */ }
      await rmWithRetry(libDir)
    }
  })
})
