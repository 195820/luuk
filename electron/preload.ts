import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, ThumbnailSize, ImageQueryOptions, SearchCriteria, SearchOptions, PhashProgress } from '../src/types'

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
  selectFolder: () => ipcRenderer.invoke('selectFolder'),

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
  setFavoriteRating: (libraryId: number, imagePath: string, rating: number) =>
    ipcRenderer.invoke('setFavoriteRating', libraryId, imagePath, rating),

  // 浏览历史
  addHistory: (libraryId: number, imagePath: string) =>
    ipcRenderer.invoke('addHistory', libraryId, imagePath),
  getHistory: (limit?: number) => ipcRenderer.invoke('getHistory', limit),
  clearHistory: () => ipcRenderer.invoke('clearHistory'),

  // 缓存
  getCacheStats: () => ipcRenderer.invoke('getCacheStats'),
  getCacheConfig: () => ipcRenderer.invoke('getCacheConfig'),
  setCacheLimit: (maxMemoryMB: number) => ipcRenderer.invoke('setCacheLimit', maxMemoryMB),
  clearCache: () => ipcRenderer.invoke('clearCache'),

  // 文件操作
  readFile: (filePath: string) => ipcRenderer.invoke('readFile', filePath),
  fileExists: (filePath: string) => ipcRenderer.invoke('fileExists', filePath),
  // 文件操作（复制/移动/重命名/删除/壁纸/资源管理器）
  renameFile: (libraryId: number, oldPath: string, newPath: string) =>
    ipcRenderer.invoke('renameFile', libraryId, oldPath, newPath),
  batchRename: (libraryId: number, renames: Array<{ oldPath: string; newPath: string }>) =>
    ipcRenderer.invoke('batchRename', libraryId, renames),
  moveFiles: (libraryId: number, paths: string[], targetDir: string) =>
    ipcRenderer.invoke('moveFiles', libraryId, paths, targetDir),
  copyFiles: (libraryId: number, paths: string[], targetDir: string) =>
    ipcRenderer.invoke('copyFiles', libraryId, paths, targetDir),
  deleteFiles: (libraryId: number, paths: string[]) =>
    ipcRenderer.invoke('deleteFiles', libraryId, paths),
  setWallpaper: (libraryId: number, relativePath: string) =>
    ipcRenderer.invoke('setWallpaper', libraryId, relativePath),
  showInExplorer: (libraryId: number, relativePath: string) =>
    ipcRenderer.invoke('showInExplorer', libraryId, relativePath),
  selectDestinationFolder: (libraryId: number) => ipcRenderer.invoke('selectDestinationFolder', libraryId),
  getDeletedFiles: (libraryId?: number, limit?: number) => ipcRenderer.invoke('getDeletedFiles', libraryId, limit),
  loadFullImage: (filePath: string) => ipcRenderer.invoke('loadFullImage', filePath),
  getMediaUrl: (filePath: string) => ipcRenderer.invoke('getMediaUrl', filePath),
  getAudioUrl: (filePath: string) => ipcRenderer.invoke('getAudioUrl', filePath),

  // 搜索
  searchImages: (libraryId: number, criteria: SearchCriteria, options: SearchOptions) =>
    ipcRenderer.invoke('searchImages', libraryId, criteria, options),
  getSearchHistory: () => ipcRenderer.invoke('getSearchHistory'),
  addSearchHistory: (query: string) => ipcRenderer.invoke('addSearchHistory', query),
  clearSearchHistory: () => ipcRenderer.invoke('clearSearchHistory'),
  getSearchPresets: () => ipcRenderer.invoke('getSearchPresets'),
  saveSearchPreset: (name: string, criteria: SearchCriteria) =>
    ipcRenderer.invoke('saveSearchPreset', name, criteria),
  deleteSearchPreset: (id: string) => ipcRenderer.invoke('deleteSearchPreset', id),

  // 标签
  createTag: (name: string, color?: string) =>
    ipcRenderer.invoke('createTag', name, color),
  deleteTag: (id: number) =>
    ipcRenderer.invoke('deleteTag', id),
  renameTag: (id: number, name: string, color?: string) =>
    ipcRenderer.invoke('renameTag', id, name, color),
  tagImages: (tagIds: number[], libraryId: number, paths: string[]) =>
    ipcRenderer.invoke('tagImages', tagIds, libraryId, paths),
  untagImages: (tagIds: number[], libraryId: number, paths: string[]) =>
    ipcRenderer.invoke('untagImages', tagIds, libraryId, paths),
  getImageTags: (libraryId: number, imagePath: string) =>
    ipcRenderer.invoke('getImageTags', libraryId, imagePath),
  getAllTags: (libraryId: number) =>
    ipcRenderer.invoke('getAllTags', libraryId),

  // pHash 回填
  startPhashBackfill: (libraryId: number) =>
    ipcRenderer.invoke('startPhashBackfill', libraryId),
  stopPhashBackfill: () =>
    ipcRenderer.invoke('stopPhashBackfill'),
  onPhashProgress: (callback: (progress: PhashProgress) => void) => {
    const subscription = (_event: any, progress: PhashProgress) => callback(progress)
    ipcRenderer.on('phashProgress', subscription)
    return () => ipcRenderer.removeListener('phashProgress', subscription)
  },

  // 相似图片查找
  findSimilarImages: (libraryId: number, imagePath: string, threshold: number, limit: number) =>
    ipcRenderer.invoke('findSimilarImages', libraryId, imagePath, threshold, limit),

  // 初始化服务
  initImageService: () => ipcRenderer.invoke('initImageService'),

  // 库统计
  getLibraryStats: (libraryId: number) =>
    ipcRenderer.invoke('getLibraryStats', libraryId),

  // EXIF
  getImageExif: (libraryId: number, relativePath: string) =>
    ipcRenderer.invoke('getImageExif', libraryId, relativePath),

  // 直方图
  getImageHistogram: (libraryId: number, relativePath: string) =>
    ipcRenderer.invoke('getImageHistogram', libraryId, relativePath),

  // 文件夹封面
  setFolderCover: (libraryId: number, folderPath: string, coverPath: string) =>
    ipcRenderer.invoke('setFolderCover', libraryId, folderPath, coverPath),
  removeFolderCover: (libraryId: number, folderPath: string) =>
    ipcRenderer.invoke('removeFolderCover', libraryId, folderPath),
  getFolderCovers: (libraryId: number) =>
    ipcRenderer.invoke('getFolderCovers', libraryId),

  // 导出
  exportSingleImage: (libraryId: number, relativePath: string, options: any, taskId: string) =>
    ipcRenderer.invoke('exportSingleImage', libraryId, relativePath, options, taskId),
  exportBatchImages: (libraryId: number, relativePaths: string[], options: any, taskId: string) =>
    ipcRenderer.invoke('exportBatchImages', libraryId, relativePaths, options, taskId),
  cancelExport: (taskId: string) =>
    ipcRenderer.invoke('cancelExport', taskId),
  onExportProgress: (callback: (progress: any) => void) => {
    const subscription = (_event: any, progress: any) => callback(progress)
    ipcRenderer.on('export-progress', subscription)
    return () => ipcRenderer.removeListener('export-progress', subscription)
  },

  // 幻灯片：选择音频文件
  selectAudioFile: () => ipcRenderer.invoke('selectAudioFile'),

  // 插件管理
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsGet: (pluginId: string) => ipcRenderer.invoke('plugins:get', pluginId),
  pluginsSetEnabled: (pluginId: string, enabled: boolean) =>
    ipcRenderer.invoke('plugins:setEnabled', pluginId, enabled),
  pluginsExecute: (pluginId: string, opId: string, input: unknown) =>
    ipcRenderer.invoke('plugins:execute', pluginId, opId, input),
  pluginsGetMenuItems: (context?: string) =>
    ipcRenderer.invoke('plugins:getMenuItems', context),

  // JobRunner 作业管理
  jobsList: () => ipcRenderer.invoke('jobs:list'),
  jobsGet: (jobId: string) => ipcRenderer.invoke('jobs:get', jobId),
  jobsPause: (jobId: string) => ipcRenderer.invoke('jobs:pause', jobId),
  jobsResume: (jobId: string) => ipcRenderer.invoke('jobs:resume', jobId),
  jobsCancel: (jobId: string) => ipcRenderer.invoke('jobs:cancel', jobId),
  jobsSubscribeProgress: () => ipcRenderer.invoke('jobs:subscribeProgress'),
  onJobProgress: (callback: (progress: any) => void) => {
    const subscription = (_event: any, progress: any) => callback(progress)
    ipcRenderer.on('job-progress', subscription)
    return () => ipcRenderer.removeListener('job-progress', subscription)
  },

  // 媒体相关
  getMediaPath: (libraryId: number, imageId: number) =>
    ipcRenderer.invoke('getMediaPath', libraryId, imageId),
  extractVideoMetadata: (libraryId: number, imageId: number, relativePath: string) =>
    ipcRenderer.invoke('extractVideoMetadata', libraryId, imageId, relativePath),
  generateVideoThumbnail: (libraryId: number, imageId: number, relativePath: string) =>
    ipcRenderer.invoke('generateVideoThumbnail', libraryId, imageId, relativePath),

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

  // 库状态变更事件（在线/离线）
  onLibraryStatusChanged: (callback: (data: { id: number; status: 'online' | 'offline' }) => void) => {
    const subscription = (_event: any, data: { id: number; status: 'online' | 'offline' }) => callback(data)
    ipcRenderer.on('library-status-changed', subscription)
    return () => ipcRenderer.removeListener('library-status-changed', subscription)
  },

  // 库扫描完成事件（刷新库状态/数量）
  onLibraryScanFinished: (callback: (data: { libraryId: number; imageCount: number; status: 'online' | 'offline' }) => void) => {
    const subscription = (_event: any, data: { libraryId: number; imageCount: number; status: 'online' | 'offline' }) => callback(data)
    ipcRenderer.on('library-scan-finished', subscription)
    return () => ipcRenderer.removeListener('library-scan-finished', subscription)
  },

  // 窗口控制
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  toggleFullscreen: () => ipcRenderer.send('window-toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window-is-fullscreen'),
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    const subscription = (_event: any, value: boolean) => callback(value)
    ipcRenderer.on('fullscreen-changed', subscription)
    return () => ipcRenderer.removeListener('fullscreen-changed', subscription)
  },
} as ElectronAPI)
