import { app, BrowserWindow, ipcMain, protocol, Menu } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { registerLibraryHandlers, unregisterLibraryHandlers } from '../src/main/ipc/library-handlers'
import { registerFileHandlers, unregisterFileHandlers } from '../src/main/ipc/file-handlers'
import { registerSearchHandlers, unregisterSearchHandlers } from '../src/main/ipc/search-handlers'
import { registerTagHandlers, unregisterTagHandlers } from '../src/main/ipc/tag-handlers'
import { registerPluginHandlers, unregisterPluginHandlers } from '../src/main/ipc/plugin-handlers'
import { registerJobHandlers, unregisterJobHandlers } from '../src/main/ipc/job-handlers'
import { initJobRunner, getJobRunner } from '../src/main/services/job-runner'
import { getPluginManager } from '../src/main/services/plugin-manager'
import { getMasterDB } from '../src/main/services/database'
import { logger } from '../src/utils/logger'
import { getImageService } from '../src/main/services/image-service'
import { resolveMediaToken, stopMediaRegistryCleanup } from '../src/main/services/media-registry'
import { libraryMonitor } from '../src/main/services/library-monitor'
import { killActiveFfmpeg } from '../src/main/services/thumbnailer'
import { MIME_TYPES } from '../src/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

/**
 * 注册 media:// 自定义协议（必须在 app.whenReady 之前调用）
 * standard: 标准 URL 解析，secure: 允许浏览器 API（video/audio），
 * supportFetchAPI: 支持 fetch，corsEnabled: 跨域支持
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

/**
 * 处理 media:// 协议请求
 * 使用 fs 直接读取文件，支持 HTTP Range 请求（视频 seek 必需）
 * URL 格式：media://TOKEN（TOKEN 为纯小写 hex 令牌）
 */
function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    // URL 格式：media://TOKEN（浏览器会对 TOKEN 做小写化，hex 纯小写无影响）
    const token = request.url.slice('media://'.length).replace(/\/+$/, '')
    const resolvedPath = resolveMediaToken(token)

    if (!resolvedPath) {
      return new Response(JSON.stringify({ error: 'unknown_token', token }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      // 安全检查：只允许访问已注册库目录下的文件（Windows 大小写不敏感）
      try {
        const libs = getImageService().getLibraries()
        const allowedPaths = libs.map(lib => path.resolve(lib.rootPath))
        const resolvedLower = resolvedPath.toLowerCase()
        const isAllowed = allowedPaths.some(root => {
          const rootLower = path.resolve(root).toLowerCase()
          return resolvedLower.startsWith(rootLower + path.sep) || resolvedLower === rootLower
        })
        if (!isAllowed) {
          return new Response('Forbidden', { status: 403 })
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: 'service_unavailable' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        })
      }

      const stat = await fs.promises.stat(resolvedPath)
      const ext = path.extname(resolvedPath).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      const rangeHeader = request.headers.get('range')

      // 处理 Range 请求（视频 seek 依赖此功能）
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = parseInt(match[1])
          const end = match[2] ? parseInt(match[2]) : stat.size - 1

          if (start >= stat.size) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }

          const clampedEnd = Math.min(end, stat.size - 1)
          const length = clampedEnd - start + 1
          const buffer = Buffer.alloc(length)

          const fh = await fs.promises.open(resolvedPath, 'r')
          try {
            await fh.read(buffer, 0, length, start)
          } finally {
            await fh.close()
          }

          return new Response(buffer, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${clampedEnd}/${stat.size}`,
              'Content-Length': String(length),
              'Accept-Ranges': 'bytes',
            },
          })
        }
      }

      // 完整文件响应
      return new Response(new Uint8Array(await fs.promises.readFile(resolvedPath)), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      })
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
  })
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')

  // 移除默认菜单栏，消除原生标题栏与自定义 header 的双层问题
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    backgroundColor: '#1a1a1a',
  })

  // 窗口控制 IPC
  ipcMain.on('window-minimize', () => mainWindow?.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window-close', () => {
    // 用 destroy() 而非 close()：close() 会等渲染进程 unload/ack，刚做完加删库/看图等重活时
    // 渲染主线程常卡在长任务，把用户可见的窗口关闭拖到数秒（实测 1.5~7s）。
    // destroy() 强制立即关窗，仍会触发 closed → window-all-closed → shutdownApp → exit。
    mainWindow?.destroy()
  })
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)

  // 全屏控制
  ipcMain.on('window-toggle-fullscreen', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    }
  })
  ipcMain.handle('window-is-fullscreen', () => mainWindow?.isFullScreen() ?? false)

  // 全屏状态变化 → 转发给渲染进程（涵盖系统途径如外接显示器切换）
  mainWindow?.on('enter-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-changed', true)
  })
  mainWindow?.on('leave-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-changed', false)
  })

  // 加载应用
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    try {
      const parsed = new URL(devUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('无效协议')
      }
      mainWindow.loadURL(devUrl)
      // 仅在开发模式自动打开 DevTools（启动脚本可通过 NO_AUTO_DEVTOOLS=1 屏蔽）
      if (process.env.NODE_ENV !== 'production' && process.env.NO_AUTO_DEVTOOLS !== '1') {
        mainWindow.webContents.openDevTools()
      }
    } catch {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 注册 F12 打开 DevTools（生产构建也生效，便于调试）
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.openDevTools()
    }
  })

  // Dev-only：把渲染进程 console 转发到主进程 stdout，便于后台跟随日志
  // 注意：DevTools 交互式求值（如 `await electronAPI.x()`）不会触发 console-message，
  // 探针请用 console.log(await window.electronAPI.x()) 包裹才会出现在这里。
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.on('console-message', (event: any, ...rest: any[]) => {
      const hasEventShape = event && typeof event === 'object' && 'message' in event
      const level = hasEventShape ? event.level : rest[0]
      const message = hasEventShape ? event.message : rest[1]
      const lineNo = hasEventShape ? event.lineNumber : rest[2]
      const src = hasEventShape ? (event.sourceId ?? '') : (rest[3] ?? '')
      process.stdout.write(`[renderer:${level}] ${message} (${src}:${lineNo})\n`)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Dev-only：开启 CDP 调试端口，供 scripts/debug.js 用 Playwright 直连诊断
if (process.env.NODE_ENV !== 'production') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

app.whenReady().then(async () => {
  // 注册自定义协议
  registerMediaProtocol()

  // 注册 IPC 处理器
  registerLibraryHandlers()
  registerFileHandlers()
  registerSearchHandlers()
  registerTagHandlers()

  // 初始化持久化作业调度器（在此之前 getJobRunner() 会抛“未初始化”）
  initJobRunner(getMasterDB())

  // 初始化插件系统（feature flag 关闭时为空实现）
  await getPluginManager().initialize()

  registerPluginHandlers()
  registerJobHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

/** 退出清理中单个异步步骤的最大时长（毫秒），超时跳过不阻塞后续收尾 */
const SHUTDOWN_STEP_TIMEOUT_MS = 1000
/** 全局看门狗（毫秒）：无论卡在哪一步都强制退出，彻底消灭“关闭无响应” */
const SHUTDOWN_WATCHDOG_MS = 3000
/** 已启动的退出清理 Promise（多条退出路径共享同一份清理，幂等） */
let shutdownPromise: Promise<void> | null = null
/** 是否已完成一次真正 quit（防止 before-quit preventDefault 形成循环） */
let quitCommitted = false

/** 给异步清理步骤加超时保护 + 耗时日志，便于定位卡点 */
function shutdownStep(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now()
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    fn().then(() => logger.info('Main', `关闭步骤完成: ${name} (${Date.now() - start}ms)`)),
    new Promise<void>(resolve => { timer = setTimeout(() => {
      logger.warn('Main', `关闭步骤超时 (${SHUTDOWN_STEP_TIMEOUT_MS}ms)，跳过: ${name}`)
      resolve()
    }, SHUTDOWN_STEP_TIMEOUT_MS) }),
  ]).finally(() => { if (timer) clearTimeout(timer) }) // 避免晚到的超时回调在步骤已完成后再误报
}

/**
 * 应用退出清理（幂等，可安全重复调用）
 * 顺序：① 停用 keepalive（IPC / interval / ffmpeg / 插件 worker）→
 *       ② 中止运行中作业并等待 → ③ 最后关闭数据库。
 * 每个异步步骤独立超时 + 全局看门狗强制退出，保证窗口关闭后进程必然终止。
 */
function shutdownApp(): Promise<void> {
  if (!shutdownPromise) {
    // 全局看门狗：超时后强制终止进程（正常路径下 finally 会清除）
    const watchdog = setTimeout(() => {
      logger.error('Main', `关闭总超时 (${SHUTDOWN_WATCHDOG_MS}ms)，强制退出 app.exit(0)`)
      app.exit(0)
    }, SHUTDOWN_WATCHDOG_MS)

    shutdownPromise = (async () => {
      const startedAt = Date.now()
      try {
        // 1) 禁止新工作：注销 IPC 处理器 + 停止 keepalive 定时器/子进程（同步段立即生效）
        unregisterLibraryHandlers()
        unregisterFileHandlers()
        unregisterSearchHandlers()
        unregisterTagHandlers()
        unregisterPluginHandlers()
        unregisterJobHandlers()

        libraryMonitor.stop()
        stopMediaRegistryCleanup()
        killActiveFfmpeg()

        // 2) 插件系统关闭（内部 kill worker 进程）；带独立超时，避免 exit 事件不触发时拖住退出
        await shutdownStep('PluginManager', async () => {
          try {
            await getPluginManager().shutdown()
          } catch (err) {
            logger.error('Main', 'PluginManager 关闭异常', err)
          }
        })

        // 3) 中止运行中的作业并落库为 paused
        await shutdownStep('JobRunner', async () => {
          try {
            await getJobRunner().shutdown()
          } catch (err) {
            logger.error('Main', 'JobRunner 关闭异常', err)
          }
        })

        // 4) 数据库不在退出路径上主动 close：若后台扫描正在写入，db.close() 会等待写事务
        //    完成而阻塞主进程数秒（实测清理阶段曾耗时 ~7s）。改为交给 app.exit 直接终止进程，
        //    已提交事务已落盘（默认回滚日志模式），下次启动由 SQLite 自动回滚未完成事务，不丢数据。
        logger.info('Main', `退出收尾完成，进程即将退出 (总耗时 ${Date.now() - startedAt}ms)`)
      } finally {
        clearTimeout(watchdog)
      }
    })()
  }
  return shutdownPromise
}

app.on('window-all-closed', () => {
  // 非 macOS：清理完成后用 app.exit 强制终止——app.quit 会走优雅卸载（等待连接析构/子进程回收），
  // 后台扫描写库时可达数秒；exit 直接终止进程，已提交数据不丢
  if (process.platform !== 'darwin') {
    shutdownApp().finally(() => app.exit(0))
  }
})

app.on('before-quit', (event) => {
  // 收尾完成后触发的二次 quit 直接放行
  if (quitCommitted) return
  event.preventDefault()
  void shutdownApp().finally(() => {
    quitCommitted = true
    app.exit(0)
  })
})

// 原有的 IPC 处理
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData')
})
