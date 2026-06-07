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
 * 支持流式传输和 range 请求，适合大文件
 */
function registerFileProtocol() {
  protocol.registerFileProtocol('luuk-file', (request, callback) => {
    const encodedPath = request.url.slice('luuk-file://'.length)
    try {
      const filePath = Buffer.from(encodedPath, 'base64url').toString('utf8')
      const resolvedPath = path.resolve(filePath)

      // 安全检查：获取当前注册的库路径
      try {
        const libs = getImageService().getLibraries()
        const allowedPaths = libs.map(lib => path.resolve(lib.rootPath))
        const isAllowed = allowedPaths.some(root =>
          resolvedPath.startsWith(root + path.sep) || resolvedPath === root
        )
        if (!isAllowed) {
          callback({ statusCode: 403 })
          return
        }
      } catch {
        // 服务未初始化时拒绝
        callback({ statusCode: 503 })
        return
      }

      // 检查文件是否存在
      if (!fs.existsSync(resolvedPath)) {
        callback({ statusCode: 404 })
        return
      }

      // 返回文件路径，Electron 会自动处理 range 请求
      callback({ path: resolvedPath })
    } catch {
      callback({ statusCode: 400 })
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
