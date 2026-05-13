import { create } from 'zustand'
import type { Library, ScanResult } from '../types'

interface LibraryState {
  libraries: Library[]
  currentLibraryId: number | null
  isInitialized: boolean
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
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  // 初始状态
  libraries: [],
  currentLibraryId: null,
  isInitialized: false,
  isLoading: false,
  error: null,

  // 初始化服务
  initialize: async () => {
    if (get().isInitialized) return

    try {
      // @ts-ignore - window.electronAPI 在运行时存在
      await window.electronAPI.initImageService()
      set({ isInitialized: true })
    } catch (error) {
      console.error('[LibraryStore] 初始化失败:', error)
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
      console.error('[LibraryStore] 加载库列表失败:', error)
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
      console.error('[LibraryStore] 添加库失败:', error)
      set({ isLoading: false })
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
      }))
    } catch (error) {
      console.error('[LibraryStore] 删除库失败:', error)
    }
  },

  // 设置当前库
  setCurrentLibrary: (id: number | null) => {
    set({
      currentLibraryId: id,
    })
  },

  // 扫描库
  scanLibrary: async (id: number) => {
    try {
      set({ isLoading: true })
      // @ts-ignore
      const result = await window.electronAPI.scanLibrary(id)

      // 更新库列表以获取最新的图片数量
      await get().loadLibraries()

      set({ isLoading: false })
      return result
    } catch (error) {
      console.error('[LibraryStore] 扫描库失败:', error)
      set({ isLoading: false })
      throw error
    }
  },
}))
