// Electron API 类型定义
export interface ElectronAPI {
  getAppVersion: () => Promise<string>
  getUserDataPath: () => Promise<string>
}

// 图片类型
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
