import { create } from 'zustand'
import type { Library, Image, Favorite, ScanResult, ThumbnailSize, FolderTreeNode, FavoriteImage, FavoriteFolder } from '../types'
import { sortImages, sortFavoriteImages } from '../utils/sort'
import { logger } from '../utils/logger'

// 扫描进度信息
export interface ScanProgress {
  isScanning: boolean
  currentFile: string
  processedCount: number
  totalCount: number
  status: string // 'scanning' | 'generating-thumbnails' | 'complete'
}

// 虚拟收藏库 ID
export const FAVORITE_LIBRARY_ID = -1

// 缩略图缓存上限，超出时淘汰最早的条目
const THUMBNAIL_CACHE_MAX = 500
const THUMBNAIL_CACHE_EVICT = 100 // 每次淘汰数量

interface ImageState {
  // 库相关
  libraries: Library[]
  currentLibraryId: number | null
  isInitialized: boolean

  // 图片相关
  images: Image[]
  totalImages: number
  currentImage: Image | null
  favorites: Favorite[]
  favoriteImages: FavoriteImage[]
  favoriteCount: number

  // 收藏文件夹相关
  favoriteFolders: FavoriteFolder[]
  favoriteFolderTree: FolderTreeNode[]

  // 单图收藏（不属于任何文件夹的收藏）
  singleFavoriteImages: FavoriteImage[]
  singleFavoriteCount: number

  // 文件夹相关
  folderTree: FolderTreeNode[]
  selectedFolder: string | null

  // 收藏视图模式：'all' | 'folder' | 'single'
  favoriteViewMode: 'all' | 'folder' | 'single'

  // 网格布局模式：'grid' | 'masonry'
  gridLayoutMode: 'grid' | 'masonry'

  // 排序设置
  imageSortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height'
  imageSortOrder: 'ASC' | 'DESC'

  // 缩略图缓存
  thumbnailCache: Map<number, string>

  // UI 状态
  sidebarOpen: boolean
  folderSidebarOpen: boolean
  viewMode: 'grid' | 'list' | 'single'
  isLoading: boolean
  error: string | null

  // 扫描进度
  scanProgress: ScanProgress

  // 初始化
  initialize: () => Promise<void>

  // 库操作
  loadLibraries: () => Promise<void>
  addLibrary: (name: string, rootPath: string, autoScan?: boolean) => Promise<Library>
  removeLibrary: (id: number) => Promise<void>
  setCurrentLibrary: (id: number | null) => void
  scanLibrary: (id: number) => Promise<ScanResult>

  // 文件夹操作
  loadFolderTree: () => Promise<void>
  setSelectedFolder: (folderPath: string | null) => void

  // 图片操作
  loadImages: (options?: { limit?: number; offset?: number }) => Promise<void>
  setCurrentImage: (image: Image | null) => void
  getThumbnail: (imageId: number, size?: ThumbnailSize) => Promise<string>
  prefetchThumbnails: (imageIds: number[], size?: ThumbnailSize) => Promise<void>

  // 收藏（图片）
  toggleFavorite: (libraryId: number, imagePath: string) => Promise<boolean>
  loadFavorites: () => Promise<void>
  loadFavoriteImages: () => Promise<void>
  loadFavoriteFolderImages: (folderPath: string) => Promise<void>
  loadSingleFavoriteImages: () => Promise<void>
  getFavoriteImagesCount: () => Promise<number>
  getFavoriteFolderImageCount: (folderPath: string) => Promise<number>
  getSingleFavoriteCount: () => Promise<number>
  isFavorite: (libraryId: number, imagePath: string) => boolean

  // 收藏文件夹
  toggleFavoriteFolder: (libraryId: number, folderPath: string) => Promise<boolean>
  loadFavoriteFolders: () => Promise<void>
  loadFavoriteFolderTree: () => Promise<void>
  isFavoriteFolder: (libraryId: number, folderPath: string) => boolean

  // UI 操作
  toggleSidebar: () => void
  toggleFolderSidebar: () => void
  setViewMode: (mode: 'grid' | 'list' | 'single') => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setFavoriteViewMode: (mode: 'all' | 'folder' | 'single') => void
  setGridLayoutMode: (mode: 'grid' | 'masonry') => void

  // 排序操作
  setSortBy: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height') => void
  setSortOrder: (order: 'ASC' | 'DESC') => void
  setSort: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height', order: 'ASC' | 'DESC') => void
  applySort: () => void

  // 收藏文件夹选中状态
  selectedFavoriteFolder: string | null
  setSelectedFavoriteFolder: (folderPath: string | null) => void
}

// LRU 缓存淘汰：超出上限时删除最早插入的条目
function evictLRU<K, V>(cache: Map<K, V>, max: number, evictCount: number): void {
  if (cache.size > max) {
    const keysToDelete = Array.from(cache.keys()).slice(0, evictCount)
    keysToDelete.forEach(k => cache.delete(k))
  }
}

export const useImageStore = create<ImageState>((set, get) => ({
  // 初始状态
  libraries: [],
  currentLibraryId: null,
  isInitialized: false,
  images: [],
  totalImages: 0,
  currentImage: null,
  favorites: [],
  favoriteImages: [],
  favoriteCount: 0,
  favoriteFolders: [],
  favoriteFolderTree: [],
  folderTree: [],
  selectedFolder: null,
  selectedFavoriteFolder: null,
  singleFavoriteImages: [],
  singleFavoriteCount: 0,
  favoriteViewMode: 'folder', // 默认显示文件夹收藏
  gridLayoutMode: (localStorage.getItem('gridLayoutMode') as 'grid' | 'masonry') || 'grid', // 从 localStorage 加载布局模式
  imageSortBy: 'relative_path', // 默认按文件名排序
  imageSortOrder: 'ASC', // 默认升序
  thumbnailCache: new Map(),
  sidebarOpen: true,
  folderSidebarOpen: true,
  viewMode: 'grid',
  isLoading: false,
  error: null,
  scanProgress: {
    isScanning: false,
    currentFile: '',
    processedCount: 0,
    totalCount: 0,
    status: 'scanning',
  },

  // 初始化服务
  initialize: async () => {
    if (get().isInitialized) return

    try {
      await window.electronAPI.initImageService()
      set({ isInitialized: true })
    } catch (error) {
      logger.error('Store', '初始化失败', error)
      set({ error: '初始化失败' })
    }
  },

  // 加载库列表
  loadLibraries: async () => {
    try {
      const libraries = await window.electronAPI.getLibraries()
      set({ libraries })

      // 如果有库且当前没有选中，选中第一个
      if (libraries.length > 0 && get().currentLibraryId === null) {
        const onlineLibrary = libraries.find(lib => lib.status === 'online')
        if (onlineLibrary) {
          set({ currentLibraryId: onlineLibrary.id })
        }
      }
    } catch (error) {
      logger.error('Store', '加载库列表失败', error)
      set({ error: '加载库列表失败' })
    }
  },

  // 添加库
  addLibrary: async (name: string, rootPath: string, autoScan?: boolean) => {
    try {
      set({ isLoading: true })
      const library = await window.electronAPI.addLibrary(name, rootPath, autoScan)
      set((state) => ({
        libraries: [...state.libraries, library],
        currentLibraryId: library.id,
        isLoading: false,
      }))
      return library
    } catch (error) {
      logger.error('Store', '添加库失败', error)
      set({ error: '添加库失败', isLoading: false })
      throw error
    }
  },

  // 删除库
  removeLibrary: async (id: number) => {
    try {
      await window.electronAPI.removeLibrary(id)
      set((state) => ({
        libraries: state.libraries.filter((lib) => lib.id !== id),
        currentLibraryId: state.currentLibraryId === id ? null : state.currentLibraryId,
        images: state.currentLibraryId === id ? [] : state.images,
        folderTree: state.currentLibraryId === id ? [] : state.folderTree,
      }))
    } catch (error) {
      logger.error('Store', '删除库失败', error)
      set({ error: '删除库失败' })
    }
  },

  // 设置当前库
  setCurrentLibrary: (id: number | null) => {
    set({
      currentLibraryId: id,
      images: [],
      thumbnailCache: new Map(),
      folderTree: [],
      selectedFolder: null,
    })

    // 加载新库的图片
    if (id !== null) {
      get().loadFolderTree()
      get().loadImages()
    }
  },

  // 扫描库
  scanLibrary: async (id: number) => {
    try {
      set({ isLoading: true })
      const result = await window.electronAPI.scanLibrary(id)

      // 更新库列表以获取最新的图片数量
      await get().loadLibraries()

      // 重新加载文件夹树和图片
      await get().loadFolderTree()
      await get().loadImages()

      set({ isLoading: false })
      return result
    } catch (error) {
      logger.error('Store', '扫描库失败', error)
      set({ error: '扫描库失败', isLoading: false })
      throw error
    }
  },

  // 加载文件夹树
  loadFolderTree: async () => {
    const { currentLibraryId } = get()

    // 收藏库没有文件夹树
    if (!currentLibraryId || currentLibraryId === FAVORITE_LIBRARY_ID) {
      set({ folderTree: [] })
      return
    }

    try {
      const folderTree = await window.electronAPI.getFolderTree(currentLibraryId)
      set({ folderTree })
    } catch (error) {
      logger.error('Store', '加载文件夹树失败', error)
      set({ folderTree: [] })
    }
  },

  // 设置选中文件夹
  setSelectedFolder: async (folderPath: string | null) => {
    set({ selectedFolder: folderPath })
    // 重新加载图片
    await get().loadImages()
  },

  // 加载图片列表
  loadImages: async (options?: { limit?: number; offset?: number }) => {
    const { currentLibraryId, selectedFolder, imageSortBy, imageSortOrder } = get()

    // 收藏库不加载普通图片
    if (!currentLibraryId || currentLibraryId === FAVORITE_LIBRARY_ID) {
      set({ images: [], totalImages: 0 })
      return
    }

    try {
      set({ isLoading: true, error: null })

      const limit = options?.limit || 100
      const offset = options?.offset || 0

      const [images, total] = await Promise.all([
        // 根据是否选择文件夹决定调用哪个 API
        // DB 层仅支持 relative_path/created_time/modified_time 排序，其他字段由前端 sortImages 处理
        selectedFolder !== null
          ? window.electronAPI.getImagesByFolder(currentLibraryId, selectedFolder, { limit, offset, orderBy: imageSortBy as 'relative_path' | 'created_time' | 'modified_time', order: imageSortOrder })
          : window.electronAPI.getImages(currentLibraryId, { limit, offset, orderBy: imageSortBy as 'relative_path' | 'created_time' | 'modified_time', order: imageSortOrder }),
        // 获取总数
        selectedFolder !== null
          ? window.electronAPI.getImageCountByFolder(currentLibraryId, selectedFolder)
          : window.electronAPI.getImageCount(currentLibraryId),
      ])

      // 前端二次排序：DB 不支持 file_size/width/height 排序，以及 relative_path 的自然排序
      const finalImages = (imageSortBy === 'relative_path' || !['relative_path', 'created_time', 'modified_time'].includes(imageSortBy))
        ? sortImages(images, imageSortBy, imageSortOrder)
        : images

      set({
        images: finalImages,
        totalImages: total,
        isLoading: false,
      })
    } catch (error) {
      logger.error('Store', '加载图片失败', error)
      set({ error: '加载图片失败', isLoading: false })
    }
  },

  // 设置当前图片
  setCurrentImage: (image: Image | null) => {
    set({ currentImage: image })
  },

  // 获取缩略图
  getThumbnail: async (imageId: number, size: ThumbnailSize = 'medium') => {
    const { currentLibraryId, thumbnailCache } = get()
    if (!currentLibraryId) {
      throw new Error('未选择库')
    }

    // 检查缓存（命中时移到末尾，实现真正的 LRU）
    if (thumbnailCache.has(imageId)) {
      const cached = thumbnailCache.get(imageId)!
      set((state) => {
        const newCache = new Map(state.thumbnailCache)
        newCache.delete(imageId)
        newCache.set(imageId, cached)
        return { thumbnailCache: newCache }
      })
      return cached
    }

    try {
      const thumbnail = await window.electronAPI.getThumbnail(currentLibraryId, imageId, size)

      // 更新缓存（带 LRU 淘汰）
      set((state) => {
        const newCache = new Map(state.thumbnailCache)
        newCache.set(imageId, thumbnail)
        evictLRU(newCache, THUMBNAIL_CACHE_MAX, THUMBNAIL_CACHE_EVICT)
        return { thumbnailCache: newCache }
      })

      return thumbnail
    } catch (error) {
      logger.error('Store', '获取缩略图失败', imageId, error)
      return ''
    }
  },

  // 预加载缩略图
  prefetchThumbnails: async (imageIds: number[], size: ThumbnailSize = 'medium') => {
    const { currentLibraryId } = get()
    if (!currentLibraryId) return

    try {
      const thumbnails = await window.electronAPI.getThumbnails(currentLibraryId, imageIds, size)

      // 更新缓存（带 LRU 淘汰）
      set((state) => {
        const newCache = new Map(state.thumbnailCache)
        for (const idStr in thumbnails) {
          newCache.set(Number(idStr), thumbnails[idStr])
        }
        evictLRU(newCache, THUMBNAIL_CACHE_MAX, THUMBNAIL_CACHE_EVICT)
        return { thumbnailCache: newCache }
      })
    } catch (error) {
      logger.error('Store', '预加载缩略图失败', error)
    }
  },

  // 切换收藏
  toggleFavorite: async (libraryId: number, imagePath: string) => {
    try {
      const isFavorite = await window.electronAPI.toggleFavorite(libraryId, imagePath)

      // 重新加载收藏列表
      await get().loadFavorites()

      return isFavorite
    } catch (error) {
      logger.error('Store', '切换收藏失败', error)
      return false
    }
  },

  // 加载收藏列表
  loadFavorites: async () => {
    try {
      const favorites = await window.electronAPI.getFavorites()
      set({ favorites })
    } catch (error) {
      logger.error('Store', '加载收藏失败', error)
    }
  },

  // 加载收藏库图片
  loadFavoriteImages: async () => {
    try {
      const { imageSortBy, imageSortOrder } = get()
      const [favoriteImages, favoriteCount] = await Promise.all([
        window.electronAPI.getFavoriteImages({ limit: 100, offset: 0 }),
        window.electronAPI.getFavoriteImagesCount(),
      ])

      // 在本地对收藏图片进行排序
      const sortedImages = sortFavoriteImages(favoriteImages, imageSortBy, imageSortOrder)

      set({ favoriteImages: sortedImages, favoriteCount })
    } catch (error) {
      logger.error('Store', '加载收藏库图片失败', error)
    }
  },

  // 获取收藏库图片数量
  getFavoriteImagesCount: async () => {
    try {
      const count = await window.electronAPI.getFavoriteImagesCount()
      set({ favoriteCount: count })
      return count
    } catch (error) {
      logger.error('Store', '获取收藏库图片数量失败', error)
      return 0
    }
  },

  // 检查是否已收藏
  isFavorite: (libraryId: number, imagePath: string) => {
    const { favorites } = get()
    return favorites.some(f => f.libraryId === libraryId && f.imagePath === imagePath)
  },

  // ==================== 收藏文件夹相关方法 ====================

  // 切换收藏文件夹
  toggleFavoriteFolder: async (libraryId: number, folderPath: string) => {
    try {
      const isFavorited = get().isFavoriteFolder(libraryId, folderPath)

      if (isFavorited) {
        await window.electronAPI.removeFavoriteFolder(libraryId, folderPath)
      } else {
        await window.electronAPI.addFavoriteFolder(libraryId, folderPath)
      }

      // 重新加载收藏文件夹列表
      await get().loadFavoriteFolders()
      await get().loadFavoriteFolderTree()

      return !isFavorited
    } catch (error) {
      logger.error('Store', '切换收藏文件夹失败', error)
      return false
    }
  },

  // 加载收藏文件夹列表
  loadFavoriteFolders: async () => {
    try {
      const favoriteFolders = await window.electronAPI.getFavoriteFolders()
      set({ favoriteFolders })
    } catch (error) {
      logger.error('Store', '加载收藏文件夹失败', error)
      set({ favoriteFolders: [] })
    }
  },

  // 加载收藏文件夹树
  loadFavoriteFolderTree: async () => {
    try {
      const favoriteFolderTree = await window.electronAPI.getFavoriteFolderTree()
      set({ favoriteFolderTree })
    } catch (error) {
      logger.error('Store', '加载收藏文件夹树失败', error)
      set({ favoriteFolderTree: [] })
    }
  },

  // 检查文件夹是否已收藏
  isFavoriteFolder: (libraryId: number, folderPath: string) => {
    const { favoriteFolders } = get()
    return favoriteFolders.some(f => f.library_id === libraryId && f.folder_path === folderPath)
  },

  // 切换侧边栏
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }))
  },

  // 切换文件夹侧边栏
  toggleFolderSidebar: () => {
    set((state) => ({ folderSidebarOpen: !state.folderSidebarOpen }))
  },

  // 设置视图模式
  setViewMode: (mode: 'grid' | 'list' | 'single') => {
    set({ viewMode: mode })
  },

  // 设置加载状态
  setLoading: (loading: boolean) => {
    set({ isLoading: loading })
  },

  // 设置错误
  setError: (error: string | null) => {
    set({ error })
  },

  // 设置收藏文件夹选中状态
  setSelectedFavoriteFolder: (folderPath: string | null) => {
    set({ selectedFavoriteFolder: folderPath })
  },

  // 加载收藏文件夹中的图片
  loadFavoriteFolderImages: async (folderPath: string) => {
    try {
      const { imageSortBy, imageSortOrder } = get()
      set({ isLoading: true, error: null })
      const [favoriteImages, favoriteCount] = await Promise.all([
        window.electronAPI.getFavoriteFolderImages(folderPath, { limit: 100, offset: 0 }),
        window.electronAPI.getFavoriteFolderImageCount(folderPath),
      ])

      // 对收藏文件夹图片进行排序（API 返回含 library 信息的对象，运行时兼容 FavoriteImage）
      const sortedImages = sortFavoriteImages(favoriteImages, imageSortBy, imageSortOrder) as unknown as FavoriteImage[]

      set({ favoriteImages: sortedImages, favoriteCount, isLoading: false })
    } catch (error) {
      logger.error('Store', '加载收藏文件夹图片失败', error)
      set({ error: '加载收藏文件夹图片失败', isLoading: false, favoriteImages: [], favoriteCount: 0 })
    }
  },

  // 获取收藏文件夹图片数量
  getFavoriteFolderImageCount: async (folderPath: string) => {
    try {
      const count = await window.electronAPI.getFavoriteFolderImageCount(folderPath)
      return count
    } catch (error) {
      logger.error('Store', '获取收藏文件夹图片数量失败', error)
      return 0
    }
  },

  // 加载单图收藏（不属于任何收藏文件夹的图片）
  loadSingleFavoriteImages: async () => {
    try {
      const { imageSortBy, imageSortOrder } = get()
      const [singleFavoriteImages, singleFavoriteCount] = await Promise.all([
        window.electronAPI.getSingleFavoriteImages({ limit: 100, offset: 0 }),
        window.electronAPI.getSingleFavoriteCount(),
      ])

      // 在本地对单图收藏进行排序
      const sortedImages = sortFavoriteImages(singleFavoriteImages, imageSortBy, imageSortOrder)

      set({ singleFavoriteImages: sortedImages, singleFavoriteCount })
    } catch (error) {
      logger.error('Store', '加载单图收藏失败', error)
    }
  },

  // 获取单图收藏数量
  getSingleFavoriteCount: async () => {
    try {
      const count = await window.electronAPI.getSingleFavoriteCount()
      set({ singleFavoriteCount: count })
      return count
    } catch (error) {
      logger.error('Store', '获取单图收藏数量失败', error)
      return 0
    }
  },

  // 设置收藏视图模式
  setFavoriteViewMode: (mode: 'all' | 'folder' | 'single') => {
    set({ favoriteViewMode: mode })
  },

  // 设置网格布局模式
  setGridLayoutMode: (mode: 'grid' | 'masonry') => {
    set({ gridLayoutMode: mode })
    localStorage.setItem('gridLayoutMode', mode)
  },

  // 设置排序字段（纯 setter，需配合 applySort 触发重载）
  setSortBy: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height') => {
    set({ imageSortBy: sortBy })
  },

  // 设置排序顺序（纯 setter，需配合 applySort 触发重载）
  setSortOrder: (order: 'ASC' | 'DESC') => {
    set({ imageSortOrder: order })
  },

  // 同时设置排序字段和顺序（纯 setter，需配合 applySort 触发重载）
  setSort: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height', order: 'ASC' | 'DESC') => {
    set({ imageSortBy: sortBy, imageSortOrder: order })
  },

  // 根据当前排序设置和库状态，重新加载图片
  applySort: () => {
    const { currentLibraryId, favoriteViewMode } = get()
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      if (favoriteViewMode === 'single') {
        get().loadSingleFavoriteImages()
      } else if (favoriteViewMode === 'folder') {
        const { selectedFavoriteFolder } = get()
        if (selectedFavoriteFolder) {
          get().loadFavoriteFolderImages(selectedFavoriteFolder)
        } else {
          get().loadFavoriteImages()
        }
      } else {
        get().loadFavoriteImages()
      }
    } else {
      get().loadImages()
    }
  },
}))
