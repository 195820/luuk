import { create } from 'zustand'
import type { Library, ImageInfo, Favorite } from '../types'

interface ImageViewerState {
  // 库相关
  libraries: Library[]
  currentLibraryId: number | null
  selectedImages: string[]
  
  // 图片相关
  currentImage: ImageInfo | null
  favorites: Favorite[]
  
  // UI 状态
  sidebarOpen: boolean
  viewMode: 'grid' | 'list' | 'single'
  zoom: number
  
  // 操作
  addLibrary: (library: Library) => void
  removeLibrary: (id: number) => void
  setCurrentLibrary: (id: number | null) => void
  setSelectedImages: (paths: string[]) => void
  setCurrentImage: (image: ImageInfo | null) => void
  toggleFavorite: (imagePath: string) => void
  toggleSidebar: () => void
  setViewMode: (mode: 'grid' | 'list' | 'single') => void
  setZoom: (zoom: number) => void
}

export const useImageViewerStore = create<ImageViewerState>((set) => ({
  // 初始状态
  libraries: [],
  currentLibraryId: null,
  selectedImages: [],
  currentImage: null,
  favorites: [],
  sidebarOpen: true,
  viewMode: 'grid',
  zoom: 1,
  
  // 操作
  addLibrary: (library) =>
    set((state) => ({
      libraries: [...state.libraries, library],
    })),
  
  removeLibrary: (id) =>
    set((state) => ({
      libraries: state.libraries.filter((lib) => lib.id !== id),
      currentLibraryId: state.currentLibraryId === id ? null : state.currentLibraryId,
    })),
  
  setCurrentLibrary: (id) => set({ currentLibraryId: id }),
  
  setSelectedImages: (paths) => set({ selectedImages: paths }),
  
  setCurrentImage: (image) => set({ currentImage: image }),
  
  toggleFavorite: (imagePath) =>
    set((state) => {
      const exists = state.favorites.find((f) => f.imagePath === imagePath)
      if (exists) {
        return {
          favorites: state.favorites.filter((f) => f.imagePath !== imagePath),
        }
      }
      return {
        favorites: [
          ...state.favorites,
          {
            id: Date.now(),
            libraryId: state.currentLibraryId || 0,
            imagePath,
            tags: [],
            rating: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }
    }),
  
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  setViewMode: (mode) => set({ viewMode: mode }),
  
  setZoom: (zoom) => set({ zoom }),
}))
