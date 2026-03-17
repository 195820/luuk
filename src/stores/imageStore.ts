import { create } from 'zustand'
import type { Library, Image, Favorite, ScanResult, ThumbnailSize, FolderTreeNode, FavoriteImage, FavoriteFolder } from '../types'

// 从文件名中提取文本和数字部分用于排序（只提取文件名，不包含路径）
// 返回 { text: 文本部分，number: 数字部分（忽略前导零）}
function extractTextAndNumber(str: string): { text: string; number: number } {
  // 先提取文件名（去掉路径）
  const fileName = str.replace(/^.*[\\/]/, '')
  
  // 移除扩展名
  const withoutExt = fileName.replace(/\.[^.]+$/, '')

  // 提取括号中的数字，如 "屏幕截图 (10).jpg" → 10
  const bracketMatch = withoutExt.match(/\((\d+)\)/)
  if (bracketMatch) {
    const text = withoutExt.replace(/\s*\(\d+\)/g, '').replace(/\d+/g, '')
    const num = parseInt(bracketMatch[1], 10)
    return { text, number: num }
  }

  // 提取最后一个数字序列及其前面的文本
  const lastNumberMatch = withoutExt.match(/^(.*?)(\d+)([^\d]*)$/)
  if (lastNumberMatch) {
    const [, prefix, numStr] = lastNumberMatch
    // 移除前缀中的数字，得到纯文本
    const text = prefix.replace(/\d+/g, '')
    const num = parseInt(numStr, 10)
    return { text, number: num }
  }

  // 没有数字，全部作为文本
  const text = withoutExt.replace(/\d+/g, '')
  return { text, number: 0 }
}

// 从文件名中提取纯文本部分（用于排序的第一关键字）
function extractText(str: string): string {
  return extractTextAndNumber(str).text
}

// 从文件名中提取纯数字部分（用于排序的第二关键字，忽略前导零）
function extractNumber(str: string): number {
  return extractTextAndNumber(str).number
}

// 通用排序辅助函数：比较两个字符串（文本 + 数字自然排序）
function comparePathStrings(aPath: string, bPath: string, order: 'ASC' | 'DESC'): number {
  const aVal = aPath || ''
  const bVal = bPath || ''

  if (order === 'ASC') {
    // 升序：先按文本部分排序，再按数字排序
    const aText = extractText(aVal)
    const bText = extractText(bVal)
    const textCompare = aText.localeCompare(bText, 'zh-CN', { sensitivity: 'base' })
    if (textCompare !== 0) return textCompare

    // 文本相同，按数字排序
    const aNum = extractNumber(aVal)
    const bNum = extractNumber(bVal)
    return aNum - bNum
  } else {
    // 降序：先按文本部分排序，再按数字排序
    const aText = extractText(aVal)
    const bText = extractText(bVal)
    const textCompare = aText.localeCompare(bText, 'zh-CN', { sensitivity: 'base' })
    if (textCompare !== 0) return bText.localeCompare(aText, 'zh-CN', { sensitivity: 'base' })

    // 文本相同，按数字降序排序
    const aNum = extractNumber(aVal)
    const bNum = extractNumber(bVal)
    return bNum - aNum
  }
}

// 排序辅助函数：对图片进行排序（支持 Image 和 FavoriteImage）
function sortImages<T extends { relative_path?: string; file_size?: number; width?: number; height?: number }>(
  images: T[],
  sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height',
  order: 'ASC' | 'DESC'
): T[] {
  return [...images].sort((a, b) => {
    let aVal: any
    let bVal: any

    switch (sortBy) {
      case 'relative_path':
        aVal = a.relative_path || ''
        bVal = b.relative_path || ''
        break
      case 'file_size':
        aVal = a.file_size || 0
        bVal = b.file_size || 0
        break
      case 'width':
        aVal = a.width || 0
        bVal = b.width || 0
        break
      case 'height':
        aVal = a.height || 0
        bVal = b.height || 0
        break
      default:
        aVal = 0
        bVal = 0
    }

    if (typeof aVal === 'string') {
      return comparePathStrings(aVal, bVal, order)
    } else {
      return order === 'ASC' ? aVal - bVal : bVal - aVal
    }
  })
}

// 排序辅助函数：对收藏图片进行排序（保持向后兼容）
function sortFavoriteImages(
  images: FavoriteImage[],
  sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height',
  order: 'ASC' | 'DESC'
): FavoriteImage[] {
  return sortImages(images, sortBy, order)
}

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

interface ImageState {
  // 库相关
  libraries: Library[]
  currentLibraryId: number | null
  isInitialized: boolean

  // 图片相关
  images: any[]
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

  // 收藏文件夹选中状态
  selectedFavoriteFolder: string | null
  setSelectedFavoriteFolder: (folderPath: string | null) => void
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
      // @ts-ignore - window.electronAPI 在运行时存在
      await window.electronAPI.initImageService()
      set({ isInitialized: true })
    } catch (error) {
      console.error('[Store] 初始化失败:', error)
      set({ error: '初始化失败' })
    }
  },

  // 加载库列表
  loadLibraries: async () => {
    try {
      // @ts-ignore
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
      console.error('[Store] 加载库列表失败:', error)
      set({ error: '加载库列表失败' })
    }
  },

  // 添加库
  addLibrary: async (name: string, rootPath: string, autoScan?: boolean) => {
    try {
      set({ isLoading: true })
      // @ts-ignore
      const library = await window.electronAPI.addLibrary(name, rootPath, autoScan)
      set((state) => ({
        libraries: [...state.libraries, library],
        currentLibraryId: library.id,
        isLoading: false,
      }))
      return library
    } catch (error) {
      console.error('[Store] 添加库失败:', error)
      set({ error: '添加库失败', isLoading: false })
      throw error
    }
  },

  // 删除库
  removeLibrary: async (id: number) => {
    try {
      // @ts-ignore
      await window.electronAPI.removeLibrary(id)
      set((state) => ({
        libraries: state.libraries.filter((lib) => lib.id !== id),
        currentLibraryId: state.currentLibraryId === id ? null : state.currentLibraryId,
        images: state.currentLibraryId === id ? [] : state.images,
        folderTree: state.currentLibraryId === id ? [] : state.folderTree,
      }))
    } catch (error) {
      console.error('[Store] 删除库失败:', error)
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
      // @ts-ignore
      const result = await window.electronAPI.scanLibrary(id)

      // 更新库列表以获取最新的图片数量
      await get().loadLibraries()

      // 重新加载文件夹树和图片
      await get().loadFolderTree()
      await get().loadImages()

      set({ isLoading: false })
      return result
    } catch (error) {
      console.error('[Store] 扫描库失败:', error)
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
      // @ts-ignore
      const folderTree = await window.electronAPI.getFolderTree(currentLibraryId)
      set({ folderTree })
    } catch (error) {
      console.error('[Store] 加载文件夹树失败:', error)
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

      // @ts-ignore
      const [images, total] = await Promise.all([
        // 根据是否选择文件夹决定调用哪个 API
        selectedFolder !== null
          ? // @ts-ignore
            window.electronAPI.getImagesByFolder(currentLibraryId, selectedFolder, { limit, offset, orderBy: imageSortBy, order: imageSortOrder })
          : // @ts-ignore
            window.electronAPI.getImages(currentLibraryId, { limit, offset, orderBy: imageSortBy, order: imageSortOrder }),
        // 获取总数
        selectedFolder !== null
          ? // @ts-ignore
            window.electronAPI.getImageCountByFolder(currentLibraryId, selectedFolder)
          : // @ts-ignore
            window.electronAPI.getImageCount(currentLibraryId),
      ])

      // 按文件名排序时，在前端进行二次排序（确保文本 + 数字自然排序）
      const finalImages = imageSortBy === 'relative_path'
        ? sortImages(images, imageSortBy, imageSortOrder)
        : images

      set({
        images: finalImages,
        totalImages: total,
        isLoading: false,
      })
    } catch (error) {
      console.error('[Store] 加载图片失败:', error)
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

    // 检查缓存
    if (thumbnailCache.has(imageId)) {
      return thumbnailCache.get(imageId)!
    }

    try {
      // @ts-ignore
      const thumbnail = await window.electronAPI.getThumbnail(currentLibraryId, imageId, size)

      // 更新缓存
      set((state) => {
        const newCache = new Map(state.thumbnailCache)
        newCache.set(imageId, thumbnail)
        return { thumbnailCache: newCache }
      })

      return thumbnail
    } catch (error) {
      console.error('[Store] 获取缩略图失败:', imageId, error)
      return ''
    }
  },

  // 预加载缩略图
  prefetchThumbnails: async (imageIds: number[], size: ThumbnailSize = 'medium') => {
    const { currentLibraryId } = get()
    if (!currentLibraryId) return

    try {
      // @ts-ignore
      const thumbnails = await window.electronAPI.getThumbnails(currentLibraryId, imageIds, size)

      // 更新缓存
      set((state) => {
        const newCache = new Map(state.thumbnailCache)
        for (const [id, thumbnail] of thumbnails.entries()) {
          newCache.set(id, thumbnail)
        }
        return { thumbnailCache: newCache }
      })
    } catch (error) {
      console.error('[Store] 预加载缩略图失败:', error)
    }
  },

  // 切换收藏
  toggleFavorite: async (libraryId: number, imagePath: string) => {
    try {
      // @ts-ignore
      const isFavorite = await window.electronAPI.toggleFavorite(libraryId, imagePath)

      // 重新加载收藏列表
      await get().loadFavorites()

      return isFavorite
    } catch (error) {
      console.error('[Store] 切换收藏失败:', error)
      return false
    }
  },

  // 加载收藏列表
  loadFavorites: async () => {
    try {
      // @ts-ignore
      const favorites = await window.electronAPI.getFavorites()
      set({ favorites })
    } catch (error) {
      console.error('[Store] 加载收藏失败:', error)
    }
  },

  // 加载收藏库图片
  loadFavoriteImages: async () => {
    try {
      const { imageSortBy, imageSortOrder } = get()
      // @ts-ignore
      const [favoriteImages, favoriteCount] = await Promise.all([
        // @ts-ignore
        window.electronAPI.getFavoriteImages({ limit: 100, offset: 0 }),
        // @ts-ignore
        window.electronAPI.getFavoriteImagesCount(),
      ])
      
      // 在本地对收藏图片进行排序
      const sortedImages = sortFavoriteImages(favoriteImages, imageSortBy, imageSortOrder)
      
      set({ favoriteImages: sortedImages, favoriteCount })
    } catch (error) {
      console.error('[Store] 加载收藏库图片失败:', error)
    }
  },

  // 获取收藏库图片数量
  getFavoriteImagesCount: async () => {
    try {
      // @ts-ignore
      const count = await window.electronAPI.getFavoriteImagesCount()
      set({ favoriteCount: count })
      return count
    } catch (error) {
      console.error('[Store] 获取收藏库图片数量失败:', error)
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
        // @ts-ignore
        await window.electronAPI.removeFavoriteFolder(libraryId, folderPath)
      } else {
        // @ts-ignore
        await window.electronAPI.addFavoriteFolder(libraryId, folderPath)
      }
      
      // 重新加载收藏文件夹列表
      await get().loadFavoriteFolders()
      await get().loadFavoriteFolderTree()
      
      return !isFavorited
    } catch (error) {
      console.error('[Store] 切换收藏文件夹失败:', error)
      return false
    }
  },

  // 加载收藏文件夹列表
  loadFavoriteFolders: async () => {
    try {
      // @ts-ignore
      const favoriteFolders = await window.electronAPI.getFavoriteFolders()
      set({ favoriteFolders })
    } catch (error) {
      console.error('[Store] 加载收藏文件夹失败:', error)
      set({ favoriteFolders: [] })
    }
  },

  // 加载收藏文件夹树
  loadFavoriteFolderTree: async () => {
    try {
      // @ts-ignore
      const favoriteFolderTree = await window.electronAPI.getFavoriteFolderTree()
      set({ favoriteFolderTree })
    } catch (error) {
      console.error('[Store] 加载收藏文件夹树失败:', error)
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
      // @ts-ignore
      const [favoriteImages, favoriteCount] = await Promise.all([
        // @ts-ignore
        window.electronAPI.getFavoriteFolderImages(folderPath, { limit: 100, offset: 0 }),
        // @ts-ignore
        window.electronAPI.getFavoriteFolderImageCount(folderPath),
      ])
      
      // 对收藏文件夹图片进行排序
      const sortedImages = sortFavoriteImages(favoriteImages as any, imageSortBy, imageSortOrder)
      
      set({ favoriteImages: sortedImages as any, favoriteCount, isLoading: false })
    } catch (error) {
      console.error('[Store] 加载收藏文件夹图片失败:', error)
      set({ error: '加载收藏文件夹图片失败', isLoading: false, favoriteImages: [], favoriteCount: 0 })
    }
  },

  // 获取收藏文件夹图片数量
  getFavoriteFolderImageCount: async (folderPath: string) => {
    try {
      // @ts-ignore
      const count = await window.electronAPI.getFavoriteFolderImageCount(folderPath)
      return count
    } catch (error) {
      console.error('[Store] 获取收藏文件夹图片数量失败:', error)
      return 0
    }
  },

  // 加载单图收藏（不属于任何收藏文件夹的图片）
  loadSingleFavoriteImages: async () => {
    try {
      const { imageSortBy, imageSortOrder } = get()
      // @ts-ignore
      const [singleFavoriteImages, singleFavoriteCount] = await Promise.all([
        // @ts-ignore
        window.electronAPI.getSingleFavoriteImages({ limit: 100, offset: 0 }),
        // @ts-ignore
        window.electronAPI.getSingleFavoriteCount(),
      ])
      
      // 在本地对单图收藏进行排序
      const sortedImages = sortFavoriteImages(singleFavoriteImages, imageSortBy, imageSortOrder)
      
      set({ singleFavoriteImages: sortedImages, singleFavoriteCount })
    } catch (error) {
      console.error('[Store] 加载单图收藏失败:', error)
    }
  },

  // 获取单图收藏数量
  getSingleFavoriteCount: async () => {
    try {
      // @ts-ignore
      const count = await window.electronAPI.getSingleFavoriteCount()
      set({ singleFavoriteCount: count })
      return count
    } catch (error) {
      console.error('[Store] 获取单图收藏数量失败:', error)
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

  // 设置排序字段
  setSortBy: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height') => {
    const { currentLibraryId, favoriteViewMode } = get()
    set({ imageSortBy: sortBy })
    // 排序字段改变时，重新加载图片
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 收藏库根据视图模式加载不同的图片
      if (favoriteViewMode === 'single') {
        get().loadSingleFavoriteImages()
      } else if (favoriteViewMode === 'folder') {
        // 文件夹收藏模式，如果选中了文件夹，重新加载
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

  // 设置排序顺序
  setSortOrder: (order: 'ASC' | 'DESC') => {
    const { currentLibraryId, favoriteViewMode } = get()
    set({ imageSortOrder: order })
    // 排序顺序改变时，重新加载图片
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 收藏库根据视图模式加载不同的图片
      if (favoriteViewMode === 'single') {
        get().loadSingleFavoriteImages()
      } else if (favoriteViewMode === 'folder') {
        // 文件夹收藏模式，如果选中了文件夹，重新加载
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

  // 设置排序
  setSort: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height', order: 'ASC' | 'DESC') => {
    const { currentLibraryId, favoriteViewMode } = get()
    set({ imageSortBy: sortBy, imageSortOrder: order })
    // 排序改变时，重新加载图片
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 收藏库根据视图模式加载不同的图片
      if (favoriteViewMode === 'single') {
        get().loadSingleFavoriteImages()
      } else if (favoriteViewMode === 'folder') {
        // 文件夹收藏模式，如果选中了文件夹，重新加载
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
