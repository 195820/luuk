/**
 * E2E 共享 fixture（§5.5 配置治理）。
 * - 使用临时 --user-data-dir 隔离，消除个人路径依赖。
 * - 默认**生产模式**：不注入 VITE_DEV_SERVER_URL，main.ts 直接 loadFile dist/index.html
 *   （§5.5「smoke 仅用已构建产物」），规避 dev server 双启动 / predev 清 dist-electron 竞态。
 * - 需先 `npm run build:dir`；如需连 dev server 调试，设环境变量 `E2E_DEV=1`。
 * - 测试结束后自动清理临时目录。
 */
import { _electron as electron, test as base } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

const PROJECT_ROOT = process.cwd()
const ELECTRON_MAIN = path.join(PROJECT_ROOT, 'dist-electron/main.js')
const APP_URL = 'http://localhost:5173'
const DEV_MODE = process.env.E2E_DEV === '1'

export type ElectronFixture = {
  electronApp: ElectronApplication
  page: Page
  tmpUserData: string
}

/**
 * electronTest fixture：
 * - 每个 worker 创建独立临时 userData 目录
 * - 启动 Electron 并等待主窗口出现
 * - 测试结束关闭 app + 清理 tmp 目录
 */
export const electronTest = base.extend<ElectronFixture>({
  tmpUserData: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-e2e-'))
    await use(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  },
  electronApp: async ({ tmpUserData }, use) => {
    if (!fs.existsSync(ELECTRON_MAIN)) {
      throw new Error(
        `E2E 需要构建产物: ${ELECTRON_MAIN}\n请先运行 npm run build:dir`
      )
    }
    const childEnv: any = {
      ...process.env,
      // 生产模式下不注入 dev URL → main.ts 走 loadFile(dist/index.html)
      ...(DEV_MODE ? { VITE_DEV_SERVER_URL: APP_URL } : {}),
      NO_AUTO_DEVTOOLS: '1',
      // 强制 production：main.ts 仅在 NODE_ENV!=='production' 时 appendSwitch('remote-debugging-port','9222')，
      // 那会与 Playwright 自身的 CDP 连接争抢固定端口，导致串行快速启停时 windows() 始终拿不到主窗口。
      // loadFile 路径由 DEV_MODE(E2E_DEV) 决定，与 NODE_ENV 无关，设此只跳过调试端口/devtools，安全。
      NODE_ENV: 'production',
    }
    // 剔除 Node-ABI 的 better_sqlite3 绑定：那是给测试进程（Node）用的，泄漏进 Electron 主进程会加载错 ABI 崩溃。
    delete childEnv.BETTER_SQLITE3_NATIVE_BINDING
    const app = await electron.launch({
      args: [
        ELECTRON_MAIN,
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--user-data-dir', tmpUserData,
      ],
      cwd: PROJECT_ROOT,
      env: childEnv,
      timeout: 60000,
    })
    await use(app)
    // 幂等关闭：若测试体内已自行 close（如 smoke 测退出计时），teardown 再关不报错
    try { await app.close() } catch { /* already closed */ }
  },
  page: async ({ electronApp }, use) => {
    // 等待主窗口出现（最多 30 轮 × 2s = 60s）
    let page: Page | undefined
    for (let i = 0; i < 30; i++) {
      const windows = electronApp.windows()
      if (windows.length > 0) {
        page = windows[0]
        break
      }
      await new Promise(r => setTimeout(r, 2000))
    }
    if (!page) throw new Error('Electron 主窗口未出现（60s 超时）')
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },
})

export { expect } from '@playwright/test'
