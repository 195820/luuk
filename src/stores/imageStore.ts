import { create } from 'zustand'
import type { Library, Image, Favorite, ScanResult, ThumbnailSize } from '../types'

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

  // 缩略图缓存
  thumbnailCache: Map<number, string>

  // UI 状态
  sidebarOpen: boolean
  viewMode: 'grid' | 'list' | 'single'
  isLoading: boolean
  error: string | null

  // 初始化
  initialize: () => Promise<void>
  
  // 库操作
  loadLibraries: () => Promise<void>
  addLibrary: (name: string, rootPath: string, autoScan?: boolean) => Promise<Library>
  removeLibrary: (id: number) => Promise<void>
  setCurrentLibrary: (id: number | null) => void
  scanLibrary: (id: number) => Promise<ScanResult>

  // 图片操作
  loadImages: (options?: { limit?: number; offset?: number }) => Promise<void>
  setCurrentImage: (image: Image | null) => void
  getThumbnail: (imageId: number, size?: ThumbnailSize) => Promise<string>
  prefetchThumbnails: (imageIds: number[], size?: ThumbnailSize) => Promise<void>

  // 收藏
  toggleFavorite: (libraryId: number, imagePath: string) => Promise<boolean>
  loadFavorites: () => Promise<void>

  // UI 操作
  toggleSidebar: () => void
  setViewMode: (mode: 'grid' | 'list' | 'single') => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
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
  thumbnailCache: new Map(),
  sidebarOpen: true,
  viewMode: 'grid',
  isLoading: false,
  error: null,

  // 初始化服务
  initialize: async () => {
    if (get().isInitialized) return
    
    try {
      // @ts-ignore - window.electronAPI 在运行时存在
      await window.electronAPI.initImageService()
      set({ isInitialized: true })
      console.log('[Store] 服务初始化完成')
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
    })
    
    // 加载新库的图片
    if (id !== null) {
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
      
      // 重新加载图片
      await get().loadImages()
      
      set({ isLoading: false })
      return result
    } catch (error) {
      console.error('[Store] 扫描库失败:', error)
      set({ error: '扫描库失败', isLoading: false })
      throw error
    }
  },

  // 加载图片列表
  loadImages: async (options?: { limit?: number; offset?: number }) => {
    const { currentLibraryId } = get()
    if (!currentLibraryId) {
      set({ images: [], totalImages: 0 })
      return
    }

    try {
      set({ isLoading: true, error: null })
      
      const limit = options?.limit || 100
      const offset = options?.offset || 0
      
      // @ts-ignore
      const [images, total] = await Promise.all([
        // @ts-ignore
        window.electronAPI.getImages(currentLibraryId, { limit, offset }),
        // @ts-ignore
        window.electronAPI.getImageCount(currentLibraryId),
      ])
      
      set({ 
        images, 
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

  // 切换侧边栏
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }))
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
}))
