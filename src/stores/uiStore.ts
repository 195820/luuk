import { create } from 'zustand'

// 扫描进度信息
export interface ScanProgress {
  isScanning: boolean
  currentFile: string
  processedCount: number
  totalCount: number
  status: 'scanning' | 'generating-thumbnails' | 'complete'
}

interface UIState {
  // UI 状态
  sidebarOpen: boolean
  folderSidebarOpen: boolean
  viewMode: 'grid' | 'viewer'
  isLoading: boolean
  error: string | null
  gridLayoutMode: 'grid' | 'masonry'
  imageSortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height'
  imageSortOrder: 'ASC' | 'DESC'
  scanProgress: ScanProgress

  // UI 操作
  toggleSidebar: () => void
  toggleFolderSidebar: () => void
  setViewMode: (mode: 'grid' | 'viewer') => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setGridLayoutMode: (mode: 'grid' | 'masonry') => void
  setSortBy: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height') => void
  setSortOrder: (order: 'ASC' | 'DESC') => void
  setSort: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height', order: 'ASC' | 'DESC') => void
}

export const useUIStore = create<UIState>((set) => ({
  // 初始状态
  sidebarOpen: true,
  folderSidebarOpen: true,
  viewMode: 'grid',
  isLoading: false,
  error: null,
  gridLayoutMode: (localStorage.getItem('gridLayoutMode') as 'grid' | 'masonry') || 'grid',
  imageSortBy: 'relative_path',
  imageSortOrder: 'ASC',
  scanProgress: {
    isScanning: false,
    currentFile: '',
    processedCount: 0,
    totalCount: 0,
    status: 'scanning',
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
  setViewMode: (mode: 'grid' | 'viewer') => {
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

  // 设置网格布局模式
  setGridLayoutMode: (mode: 'grid' | 'masonry') => {
    set({ gridLayoutMode: mode })
    localStorage.setItem('gridLayoutMode', mode)
  },

  // 设置排序字段
  setSortBy: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height') => {
    set({ imageSortBy: sortBy })
  },

  // 设置排序顺序
  setSortOrder: (order: 'ASC' | 'DESC') => {
    set({ imageSortOrder: order })
  },

  // 设置排序
  setSort: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height', order: 'ASC' | 'DESC') => {
    set({ imageSortBy: sortBy, imageSortOrder: order })
  },
}))
