import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { registerLibraryHandlers, unregisterLibraryHandlers } from '../src/main/ipc/library-handlers'
import { closeAllDatabases } from '../src/main/services/database'
import { getImageService } from '../src/main/services/image-service'
import { resolveMediaToken } from '../src/main/services/media-registry'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

/**
 * MIME 类型映射（按扩展名）
 */
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
}

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
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
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

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
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

  // 加载应用
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // 注册自定义协议
  registerMediaProtocol()

  // 注册 IPC 处理器
  registerLibraryHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 清理资源
  unregisterLibraryHandlers()
  closeAllDatabases()
  
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // 清理资源
  unregisterLibraryHandlers()
  closeAllDatabases()
})

// 原有的 IPC 处理
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData')
})
