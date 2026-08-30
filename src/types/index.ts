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
  // 文件操作（复制/移动/重命名/删除/壁纸/资源管理器）
  renameFile: (libraryId: number, oldPath: string, newPath: string) => Promise<FileOperationResult>
  batchRename: (libraryId: number, renames: Array<{ oldPath: string; newPath: string }>) => Promise<BatchRenameResult>
  moveFiles: (libraryId: number, paths: string[], targetDir: string) => Promise<BatchResult>
  copyFiles: (libraryId: number, paths: string[], targetDir: string) => Promise<BatchResult>
  deleteFiles: (libraryId: number, paths: string[]) => Promise<BatchResult>
  setWallpaper: (libraryId: number, relativePath: string) => Promise<FileOperationResult>
  showInExplorer: (libraryId: number, relativePath: string) => Promise<FileOperationResult>
  selectDestinationFolder: (libraryId: number) => Promise<string | null | { error: string }>
  getDeletedFiles: (libraryId?: number, limit?: number) => Promise<DeletedFileRecord[]>
  // 初始化服务
  initImageService: () => Promise<void>
  // 库统计
  getLibraryStats: (libraryId: number) => Promise<{ success: boolean; data?: LibraryStats; error?: string }>
  // EXIF
  getImageExif: (libraryId: number, relativePath: string) => Promise<{ success: boolean; data?: ExifInfo; error?: string }>
  // 媒体相关
  loadFullImage: (filePath: string) => Promise<string>
  getMediaUrl: (filePath: string) => Promise<string>
  getMediaPath: (libraryId: number, imageId: number) => Promise<string>
  extractVideoMetadata: (libraryId: number, imageId: number, relativePath: string) => Promise<{ duration: number; codec: string; width: number; height: number }>
  generateVideoThumbnail: (libraryId: number, imageId: number, relativePath: string) => Promise<string>
  // 搜索
  searchImages: (libraryId: number, criteria: SearchCriteria, options: SearchOptions) => Promise<SearchResult>
  // 标签
  createTag: (name: string, color?: string) => Promise<{ success: boolean; data?: Tag; error?: string }>
  deleteTag: (id: number) => Promise<{ success: boolean; error?: string }>
  renameTag: (id: number, name: string, color?: string) => Promise<{ success: boolean; error?: string }>
  tagImages: (tagIds: number[], libraryId: number, paths: string[]) => Promise<{ success: boolean; error?: string }>
  untagImages: (tagIds: number[], libraryId: number, paths: string[]) => Promise<{ success: boolean; error?: string }>
  getImageTags: (libraryId: number, imagePath: string) => Promise<{ success: boolean; data?: Tag[]; error?: string }>
  getAllTags: (libraryId: number) => Promise<{ success: boolean; data?: Array<Tag & { count: number }>; error?: string }>
  // pHash 回填
  startPhashBackfill: (libraryId: number) => Promise<{ success: boolean; error?: string }>
  stopPhashBackfill: () => Promise<{ success: boolean; error?: string }>
  onPhashProgress: (callback: (progress: PhashProgress) => void) => () => void
  // 相似图片查找
  findSimilarImages: (libraryId: number, imagePath: string, threshold: number, limit: number) => Promise<{ success: boolean; images?: any[]; error?: string }>
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
  orderBy?: 'created_time' | 'modified_time' | 'indexed_time' | 'relative_path'
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
  // pHash 感知哈希（用于相似图片查找）
  phash?: string
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

// ==================== 文件操作类型 ====================

export interface FileOperationResult {
  success: boolean;
  error?: string;
}

export interface BatchResult {
  succeeded: Array<{ path: string }>;
  failed: Array<{ path: string; error: string }>;
}

export interface BatchRenameResult {
  succeeded: Array<{ oldPath: string; newPath: string }>;
  failed: Array<{ oldPath: string; newPath: string; error: string }>;
}

export interface DeletedFileRecord {
  id: number;
  library_id: number;
  library_name: string;
  original_path: string;
  deleted_at: string;
  file_size: number;
}

// ==================== 标签类型 ====================

export interface Tag {
  id: number
  name: string
  color: string
  count?: number
}

// ==================== 搜索类型 ====================

/**
 * 多条件组合搜索参数
 * favoritePaths 由服务层填充（从 master.db 查收藏/评分路径集），渲染层不传
 * favoritePaths = null：不加该条件；空数组：收藏条件下无命中，直接返回空
 * tagIds 由服务层查 image_tags 得路径集，与 favoritePaths 取交集后走同一通道
 */
export interface SearchCriteria {
  fileName?: string          // 文件名模糊匹配（LIKE %keyword%）
  formats?: string[]         // 小写无点，如 ['jpg', 'png']
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  minFileSize?: number       // 字节
  maxFileSize?: number
  createdFrom?: string       // ISO 日期 'YYYY-MM-DD'
  createdTo?: string
  mediaType?: 'image' | 'video' | 'audio'
  minRating?: number         // 1-5，服务层转为 favoritePaths 路径集
  favoritePaths?: string[] | null  // 服务层填充，渲染层不传
  tagIds?: number[]          // 标签 ID 数组（AND 语义），服务层查 image_tags 得路径集
}

export interface SearchResult {
  success: boolean
  images: Image[]
  total: number
  error?: string
}

export interface SearchOptions {
  limit: number
  offset: number
}

export interface PhashProgress {
  libraryId: number
  done: number
  remaining: number
  percent: number
  finished: boolean
}

// ==================== 库统计类型 ====================

export interface LibraryStats {
  total: number
  totalSize: number
  formats: Array<{ format: string; count: number; size: number }>
  mediaTypes: Array<{ mediaType: string; count: number; size: number }>
  timeline: Array<{ month: string; count: number }>
}

// ==================== EXIF 类型 ====================

export interface ExifInfo {
  dateTimeOriginal?: string
  make?: string
  model?: string
  lensModel?: string
  exposureTime?: string
  fNumber?: number
  iso?: number
  focalLength?: number
  gps?: { latitude: number; longitude: number }
}
