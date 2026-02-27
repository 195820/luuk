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
  
  // 图片查询
  getImages: (libraryId: number, options: ImageQueryOptions) => 
    ipcRenderer.invoke('getImages', libraryId, options),
  getImageCount: (libraryId: number) => ipcRenderer.invoke('getImageCount', libraryId),
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
} as ElectronAPI)
