import { create } from 'zustand'
import type { FolderTreeNode, FavoriteFolder } from '../types'

interface FolderState {
  folderTree: FolderTreeNode[]
  selectedFolder: string | null
  favoriteFolders: FavoriteFolder[]
  favoriteFolderTree: FolderTreeNode[]
  selectedFavoriteFolder: string | null

  // 文件夹操作
  loadFolderTree: (libraryId: number) => Promise<void>
  setSelectedFolder: (folderPath: string | null) => void
  loadFavoriteFolders: () => Promise<void>
  loadFavoriteFolderTree: () => Promise<void>
  toggleFavoriteFolder: (libraryId: number, folderPath: string) => Promise<boolean>
  isFavoriteFolder: (libraryId: number, folderPath: string) => boolean
  setSelectedFavoriteFolder: (folderPath: string | null) => void
}

export const useFolderStore = create<FolderState>((set, get) => ({
  // 初始状态
  folderTree: [],
  selectedFolder: null,
  favoriteFolders: [],
  favoriteFolderTree: [],
  selectedFavoriteFolder: null,

  // 加载文件夹树
  loadFolderTree: async (libraryId: number) => {
    try {
      // @ts-ignore
      const folderTree = await window.electronAPI.getFolderTree(libraryId)
      set({ folderTree })
    } catch (error) {
      console.error('[FolderStore] 加载文件夹树失败:', error)
      set({ folderTree: [] })
    }
  },

  // 设置选中文件夹
  setSelectedFolder: (folderPath: string | null) => {
    set({ selectedFolder: folderPath })
  },

  // 加载收藏文件夹列表
  loadFavoriteFolders: async () => {
    try {
      // @ts-ignore
      const favoriteFolders = await window.electronAPI.getFavoriteFolders()
      set({ favoriteFolders })
    } catch (error) {
      console.error('[FolderStore] 加载收藏文件夹失败:', error)
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
      console.error('[FolderStore] 加载收藏文件夹树失败:', error)
      set({ favoriteFolderTree: [] })
    }
  },

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
      console.error('[FolderStore] 切换收藏文件夹失败:', error)
      return false
    }
  },

  // 检查文件夹是否已收藏
  isFavoriteFolder: (libraryId: number, folderPath: string) => {
    const { favoriteFolders } = get()
    return favoriteFolders.some(f => f.library_id === libraryId && f.folder_path === folderPath)
  },

  // 设置收藏文件夹选中状态
  setSelectedFavoriteFolder: (folderPath: string | null) => {
    set({ selectedFavoriteFolder: folderPath })
  },
}))
