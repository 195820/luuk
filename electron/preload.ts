import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, ThumbnailSize, ImageQueryOptions } from '../src/types'

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 基础 API
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  // 库管理
  getLibraries: () => ipcRenderer.invoke('getLibraries'),
  addLibrary: (name: string, rootPath: string, autoScan?: boolean) =>
    ipcRenderer.invoke('addLibrary', name, rootPath, autoScan),
  removeLibrary: (id: number) => ipcRenderer.invoke('removeLibrary', id),
  scanLibrary: (id: number) => ipcRenderer.invoke('scanLibrary', id),
  selectFolder: () => {
    console.log('[preload] selectFolder called')
    return ipcRenderer.invoke('selectFolder').then(result => {
      console.log('[preload] selectFolder result:', result)
      return result
    }).catch(err => {
      console.error('[preload] selectFolder error:', err)
      throw err
    })
  },

  // 文件夹
  getFolderTree: (libraryId: number) => ipcRenderer.invoke('getFolderTree', libraryId),

  // 图片查询
  getImages: (libraryId: number, options: ImageQueryOptions) =>
    ipcRenderer.invoke('getImages', libraryId, options),
  getImagesByFolder: (libraryId: number, folderPath: string | null, options: ImageQueryOptions) =>
    ipcRenderer.invoke('getImagesByFolder', libraryId, folderPath, options),
  getImageCount: (libraryId: number) => ipcRenderer.invoke('getImageCount', libraryId),
  getImageCountByFolder: (libraryId: number, folderPath: string | null) =>
    ipcRenderer.invoke('getImageCountByFolder', libraryId, folderPath),
  getImagePath: (libraryId: number, imageId: number) =>
    ipcRenderer.invoke('getImagePath', libraryId, imageId),

  // 缩略图
  getThumbnail: (libraryId: number, imageId: number, size?: ThumbnailSize) =>
    ipcRenderer.invoke('getThumbnail', libraryId, imageId, size),
  getThumbnails: (libraryId: number, imageIds: number[], size?: ThumbnailSize) =>
    ipcRenderer.invoke('getThumbnails', libraryId, imageIds, size),

  // 收藏
  toggleFavorite: (libraryId: number, imagePath: string, tags?: string[]) =>
    ipcRenderer.invoke('toggleFavorite', libraryId, imagePath, tags),
  getFavorites: () => ipcRenderer.invoke('getFavorites'),

  // 缓存
  getCacheStats: () => ipcRenderer.invoke('getCacheStats'),
  clearCache: () => ipcRenderer.invoke('clearCache'),

  // 文件操作
  readFile: (filePath: string) => ipcRenderer.invoke('readFile', filePath),
  fileExists: (filePath: string) => ipcRenderer.invoke('fileExists', filePath),

  // 初始化服务
  initImageService: () => ipcRenderer.invoke('initImageService'),

  // 扫描进度监听
  onScanProgress: (callback: (progress: any) => void) => {
    const subscription = (_event: any, progress: any) => callback(progress)
    ipcRenderer.on('scan-progress', subscription)
    return () => ipcRenderer.removeListener('scan-progress', subscription)
  },

  // 库扫描开始事件
  onLibraryScanStarted: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on('library-scan-started', subscription)
    return () => ipcRenderer.removeListener('library-scan-started', subscription)
  },
} as ElectronAPI)
