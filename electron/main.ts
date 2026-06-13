import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { registerLibraryHandlers, unregisterLibraryHandlers } from '../src/main/ipc/library-handlers'
import { closeAllDatabases } from '../src/main/services/database'
import { getImageService } from '../src/main/services/image-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

/**
 * 注册 luuk-file:// 自定义协议，用于加载媒体文件（视频/音频/大图）
 * 使用 registerStreamProtocol 手动处理 range 请求
 */
function registerFileProtocol() {
  protocol.registerStreamProtocol('luuk-file', (request, callback) => {
    const encodedPath = request.url.slice('luuk-file://'.length)
    try {
      const filePath = Buffer.from(encodedPath, 'base64url').toString('utf8')
      const resolvedPath = path.resolve(filePath)

      // 安全检查
      try {
        const libs = getImageService().getLibraries()
        const allowedPaths = libs.map(lib => path.resolve(lib.rootPath))
        const isAllowed = allowedPaths.some(root =>
          resolvedPath.startsWith(root + path.sep) || resolvedPath === root
        )
        if (!isAllowed) {
          callback({ statusCode: 403, data: Buffer.from('Forbidden') })
          return
        }
      } catch (e) {
        callback({ statusCode: 503, data: Buffer.from('Service Unavailable') })
        return
      }

      // 检查文件是否存在
      if (!fs.existsSync(resolvedPath)) {
        callback({ statusCode: 404, data: Buffer.from('Not Found') })
        return
      }

      const stat = fs.statSync(resolvedPath)
      const fileSize = stat.size

      // MIME 类型
      const ext = path.extname(resolvedPath).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
        '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp',
      }
      const mimeType = mimeTypes[ext] || 'application/octet-stream'

      // 处理 range 请求
      const rangeHeader = request.headers['range']
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunkSize = end - start + 1
        const stream = fs.createReadStream(resolvedPath, { start, end })
        callback({
          statusCode: 206,
          data: stream,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            'Content-Type': mimeType,
          },
        })
      } else {
        const stream = fs.createReadStream(resolvedPath)
        callback({
          statusCode: 200,
          data: stream,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': fileSize.toString(),
            'Content-Type': mimeType,
          },
        })
      }
    } catch (e) {
      callback({ statusCode: 400, data: Buffer.from('Bad Request') })
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
  registerFileProtocol()

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
