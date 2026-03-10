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
    return ipcRenderer.invoke('selectFolder').then(result => {
      return result
    }).catch(err => {
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
  getImagePathByRelativePath: (libraryId: number, relativePath: string) =>
    ipcRenderer.invoke('getImagePathByRelativePath', libraryId, relativePath),
  getImageByRelativePath: (libraryId: number, relativePath: string) =>
    ipcRenderer.invoke('getImageByRelativePath', libraryId, relativePath),

  // 收藏库
  getFavoriteImages: (options: ImageQueryOptions) =>
    ipcRenderer.invoke('getFavoriteImages', options),
  getFavoriteImagesCount: () =>
    ipcRenderer.invoke('getFavoriteImagesCount'),
  // 单图收藏（不属于任何收藏文件夹）
  getSingleFavoriteImages: (options: ImageQueryOptions) =>
    ipcRenderer.invoke('getSingleFavoriteImages', options),
  getSingleFavoriteCount: () =>
    ipcRenderer.invoke('getSingleFavoriteCount'),
  // 收藏文件夹
  addFavoriteFolder: (libraryId: number, folderPath: string) =>
    ipcRenderer.invoke('addFavoriteFolder', libraryId, folderPath),
  removeFavoriteFolder: (libraryId: number, folderPath: string) =>
    ipcRenderer.invoke('removeFavoriteFolder', libraryId, folderPath),
  getFavoriteFolders: () => ipcRenderer.invoke('getFavoriteFolders'),
  getFavoriteFolderTree: () => ipcRenderer.invoke('getFavoriteFolderTree'),
  isFavoriteFolder: (libraryId: number, folderPath: string) =>
    ipcRenderer.invoke('isFavoriteFolder', libraryId, folderPath),
  getFavoriteFolderImages: (folderPath: string, options: { limit: number; offset: number }) =>
    ipcRenderer.invoke('getFavoriteFolderImages', folderPath, options),
  getFavoriteFolderImageCount: (folderPath: string) =>
    ipcRenderer.invoke('getFavoriteFolderImageCount', folderPath),

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
