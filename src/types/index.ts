// Electron API 类型定义
export interface ElectronAPI {
  getAppVersion: () => Promise<string>
  getUserDataPath: () => Promise<string>
  // 库管理
  getLibraries: () => Promise<Library[]>
  addLibrary: (name: string, rootPath: string, autoScan?: boolean) => Promise<Library>
  removeLibrary: (id: number) => Promise<void>
  scanLibrary: (id: number) => Promise<ScanResult>
  selectFolder: () => Promise<string | null>
  // 文件夹
  getFolderTree: (libraryId: number) => Promise<FolderTreeNode[]>
  // 图片查询
  getImages: (libraryId: number, options: ImageQueryOptions) => Promise<Image[]>
  getImagesByFolder: (libraryId: number, folderPath: string | null, options: ImageQueryOptions) => Promise<Image[]>
  getImageCount: (libraryId: number) => Promise<number>
  getImageCountByFolder: (libraryId: number, folderPath: string | null) => Promise<number>
  getImagePath: (libraryId: number, imageId: number) => Promise<string>
  getImagePathByRelativePath: (libraryId: number, relativePath: string) => Promise<string>
  getImageByRelativePath: (libraryId: number, relativePath: string) => Promise<any>
  // 收藏库
  getFavoriteImages: (options: ImageQueryOptions) => Promise<FavoriteImage[]>
  getFavoriteImagesCount: () => Promise<number>
  // 单图收藏（不属于任何收藏文件夹）
  getSingleFavoriteImages: (options: ImageQueryOptions) => Promise<FavoriteImage[]>
  getSingleFavoriteCount: () => Promise<number>
  // 收藏文件夹
  addFavoriteFolder: (libraryId: number, folderPath: string) => Promise<void>
  removeFavoriteFolder: (libraryId: number, folderPath: string) => Promise<void>
  getFavoriteFolders: () => Promise<FavoriteFolder[]>
  getFavoriteFolderTree: () => Promise<FolderTreeNode[]>
  isFavoriteFolder: (libraryId: number, folderPath: string) => Promise<boolean>
  getFavoriteFolderImages: (folderPath: string, options: { limit: number; offset: number }) => Promise<Image[]>
  getFavoriteFolderImageCount: (folderPath: string) => Promise<number>
  // 缩略图
  getThumbnail: (libraryId: number, imageId: number, size?: ThumbnailSize) => Promise<string>
  getThumbnails: (libraryId: number, imageIds: number[], size?: ThumbnailSize) => Promise<Record<number, string>>
  // 收藏
  toggleFavorite: (libraryId: number, imagePath: string, tags?: string[]) => Promise<boolean>
  getFavorites: () => Promise<Favorite[]>
  setFavoriteRating: (libraryId: number, imagePath: string, rating: number) => Promise<void>
  // 浏览历史
  addHistory: (libraryId: number, imagePath: string) => Promise<void>
  getHistory: (limit?: number) => Promise<HistoryItem[]>
  clearHistory: () => Promise<void>
  // 缓存
  getCacheStats: () => Promise<{ count: number; sizeMB: number; utilization: number }>
  clearCache: () => Promise<void>
  // 文件操作
  readFile: (filePath: string) => Promise<Buffer>
  fileExists: (filePath: string) => Promise<boolean>
  // 初始化服务
  initImageService: () => Promise<void>
  // 媒体相关
  loadFullImage: (filePath: string) => Promise<string>
  getMediaUrl: (filePath: string) => Promise<string>
  getMediaPath: (libraryId: number, imageId: number) => Promise<string>
  extractVideoMetadata: (libraryId: number, imageId: number, relativePath: string) => Promise<{ duration: number; codec: string; width: number; height: number }>
  generateVideoThumbnail: (libraryId: number, imageId: number, relativePath: string) => Promise<string>
  // 事件监听
  onScanProgress: (callback: (progress: any) => void) => () => void
  onLibraryScanStarted: (callback: (data: any) => void) => () => void
  // 窗口控制
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  windowIsMaximized: () => Promise<boolean>
}

// 收藏文件夹
export interface FavoriteFolder {
  id: number
  library_id: number
  library_name: string
  library_root_path: string
  folder_path: string
  created_at: string
}

// 收藏库图片
export interface FavoriteImage {
  id: number
  library_id: number
  library_name: string
  relative_path: string
  width: number
  height: number
  file_size: number
  format: string
  is_favorite: boolean
  favorited_at: string
  rating?: number
}

// 浏览历史条目
export interface HistoryItem {
  library_id: number
  library_name: string
  library_root_path: string
  image_path: string
  viewed_at: string
  id?: number
  width?: number
  height?: number
  file_size?: number
  format?: string
  mediaType?: MediaType
}

// 文件夹树节点
export interface FolderTreeNode {
  path: string
  name: string
  imageCount: number
  children?: FolderTreeNode[]
  depth: number
  library_id?: number
  library_name?: string
}

// 扫描结果
export interface ScanResult {
  added: number
  updated: number
  deleted: number
  skipped: number
  total: number
}

// 图片查询选项
export interface ImageQueryOptions {
  limit: number
  offset: number
  orderBy?: 'created_time' | 'modified_time' | 'relative_path'
  order?: 'ASC' | 'DESC'
}

// 媒体类型
export type MediaType = 'image' | 'video' | 'audio'

// 图片适配模式
export type FitMode = 'fit-window' | 'actual-size' | 'fit-width' | 'fit-height'

// 支持的文件扩展名按媒体类型分类
export const MEDIA_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'],
  video: ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'],
} as const

// 扩展名到 MIME 类型的映射（统一定义，消除各文件重复）
export const MIME_TYPES: Record<string, string> = {
  // 图片
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.tiff': 'image/tiff', '.tif': 'image/tiff', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.avif': 'image/avif',
  // 视频
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
  // 音频
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
}

// 图片类型 (数据库记录)
export interface Image {
  id: number
  relative_path: string
  file_hash?: string
  width: number
  height: number
  file_size: number
  format: string
  orientation: number
  created_time?: string
  modified_time?: string
  indexed_time: string
  is_deleted: number
  // 多媒体字段
  mediaType: MediaType
  duration: number | null  // 时长（秒），仅视频/音频
  codec: string | null     // 编码格式
  // 附加字段 (非数据库)
  library_id?: number
  library_name?: string
}

// 图片类型 (前端使用)
export interface ImageInfo {
  id: number
  relativePath: string
  fullPath: string
  fileHash?: string
  width: number
  height: number
  fileSize: number
  format: string
  orientation: number
  createdTime?: string
  modifiedTime?: string
  indexedTime: string
  isDeleted: boolean
  // 多媒体字段
  mediaType: MediaType
  duration: number | null
  codec: string | null
}

// 缩略图尺寸
export type ThumbnailSize = 'small' | 'medium' | 'large'

export interface ThumbnailSizeConfig {
  small: number
  medium: number
  large: number
}

// 库信息
export interface Library {
  id: number
  name: string
  rootPath: string
  status: 'online' | 'offline'
  lastScan?: string
  imageCount: number
  createdAt: string
}

// 收藏信息
export interface Favorite {
  id: number
  libraryId: number
  imagePath: string
  tags?: string[]
  rating: number
  note?: string
  createdAt: string
}

// 应用配置
export interface AppConfig {
  version: string
  libraries: LibraryConfig[]
  settings: Settings
}

export interface LibraryConfig {
  id: number
  name: string
  rootPath: string
  autoScan: boolean
  cacheOnSSD: boolean
}

export interface Settings {
  thumbnailSize: ThumbnailSizeConfig
  cacheMaxSize: number
  preloadCount: number
  lazyLoadThreshold: number
  supportedFormats: string[]
}
