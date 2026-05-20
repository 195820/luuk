import { create } from 'zustand'
import type { Favorite, FavoriteImage } from '../types'
import { useImageStore } from './imageStore'

interface FavoriteState {
  favorites: Favorite[]
  favoriteImages: FavoriteImage[]
  favoriteCount: number
  singleFavoriteImages: FavoriteImage[]
  singleFavoriteCount: number
  favoriteViewMode: 'all' | 'folder' | 'single'

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

  // UI 操作
  setFavoriteViewMode: (mode: 'all' | 'folder' | 'single') => void
}

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  // 初始状态
  favorites: [],
  favoriteImages: [],
  favoriteCount: 0,
  singleFavoriteImages: [],
  singleFavoriteCount: 0,
  favoriteViewMode: 'folder',

  // 切换收藏
  toggleFavorite: async (libraryId: number, imagePath: string) => {
    try {
      // @ts-ignore
      const isFavorite = await window.electronAPI.toggleFavorite(libraryId, imagePath)

      // 重新加载收藏列表
      await get().loadFavorites()

      return isFavorite
    } catch (error) {
      console.error('[FavoriteStore] 切换收藏失败:', error)
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
      console.error('[FavoriteStore] 加载收藏失败:', error)
    }
  },

  // 加载收藏库图片（优化：批量预加载缩略图）
  loadFavoriteImages: async () => {
    try {
      // @ts-ignore
      const [favoriteImages, favoriteCount] = await Promise.all([
        // @ts-ignore
        window.electronAPI.getFavoriteImages({ limit: 100, offset: 0 }),
        // @ts-ignore
        window.electronAPI.getFavoriteImagesCount(),
      ])
      console.log('[FavoriteStore] loadFavoriteImages 返回:', {
        count: favoriteImages.length,
        firstItem: favoriteImages[0] ? {
          id: favoriteImages[0].id,
          relativePath: favoriteImages[0].relative_path,
        } : '无数据',
      });
      set({ favoriteImages, favoriteCount })

      // 批量预加载缩略图（仅当前库）
      const itemsToPreload = favoriteImages
        .filter(img => img.id > 0 && img.library_id > 0)
        .map(img => img.id)
      if (itemsToPreload.length > 0) {
        useImageStore.getState().prefetchThumbnails(itemsToPreload, 'medium')
      }
    } catch (error) {
      console.error('[FavoriteStore] 加载收藏库图片失败:', error)
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
      console.error('[FavoriteStore] 获取收藏库图片数量失败:', error)
      return 0
    }
  },

  // 检查是否已收藏
  isFavorite: (libraryId: number, imagePath: string) => {
    const { favorites } = get()
    return favorites.some(f => f.libraryId === libraryId && f.imagePath === imagePath)
  },

  // 加载收藏文件夹中的图片（优化：批量预加载缩略图）
  loadFavoriteFolderImages: async (folderPath: string) => {
    try {
      // @ts-ignore
      const [images, favoriteCount] = await Promise.all([
        // @ts-ignore
        window.electronAPI.getFavoriteFolderImages(folderPath, { limit: 100, offset: 0 }),
        // @ts-ignore
        window.electronAPI.getFavoriteFolderImageCount(folderPath),
      ])
      // 将 Image[] 转换为 FavoriteImage[]
      const favoriteImages: FavoriteImage[] = images.map((img: any) => ({
        ...img,
        is_favorite: true,
        favorited_at: img.created_at || new Date().toISOString(),
      }))
      set({ favoriteImages, favoriteCount })

      // 批量预加载缩略图（仅当前库）
      const itemsToPreload = favoriteImages
        .filter(img => img.id > 0 && img.library_id > 0)
        .map(img => img.id)
      if (itemsToPreload.length > 0) {
        useImageStore.getState().prefetchThumbnails(itemsToPreload, 'medium')
      }
    } catch (error) {
      console.error('[FavoriteStore] 加载收藏文件夹图片失败:', error)
      set({ favoriteImages: [], favoriteCount: 0 })
    }
  },

  // 获取收藏文件夹图片数量
  getFavoriteFolderImageCount: async (folderPath: string) => {
    try {
      // @ts-ignore
      const count = await window.electronAPI.getFavoriteFolderImageCount(folderPath)
      return count
    } catch (error) {
      console.error('[FavoriteStore] 获取收藏文件夹图片数量失败:', error)
      return 0
    }
  },

  // 加载单图收藏（优化：批量预加载缩略图）
  loadSingleFavoriteImages: async () => {
    try {
      // @ts-ignore
      const [singleFavoriteImages, singleFavoriteCount] = await Promise.all([
        // @ts-ignore
        window.electronAPI.getSingleFavoriteImages({ limit: 100, offset: 0 }),
        // @ts-ignore
        window.electronAPI.getSingleFavoriteCount(),
      ])
      console.log('[FavoriteStore] loadSingleFavoriteImages 返回:', {
        count: singleFavoriteImages.length,
        firstItem: singleFavoriteImages[0] ? {
          id: singleFavoriteImages[0].id,
          relativePath: singleFavoriteImages[0].relative_path,
        } : '无数据',
      });
      set({ singleFavoriteImages, singleFavoriteCount })

      // 批量预加载缩略图（仅当前库）
      const itemsToPreload = singleFavoriteImages
        .filter(img => img.id > 0 && img.library_id > 0)
        .map(img => img.id)
      if (itemsToPreload.length > 0) {
        useImageStore.getState().prefetchThumbnails(itemsToPreload, 'medium')
      }
    } catch (error) {
      console.error('[FavoriteStore] 加载单图收藏失败:', error)
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
      console.error('[FavoriteStore] 获取单图收藏数量失败:', error)
      return 0
    }
  },

  // 设置收藏视图模式
  setFavoriteViewMode: (mode: 'all' | 'folder' | 'single') => {
    set({ favoriteViewMode: mode })
  },
}))
