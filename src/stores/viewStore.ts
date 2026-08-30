import { create } from 'zustand'
import type { GroupBy } from '../utils/group'

interface ViewState {
  // 视图模式（网格/列表/单图）
  viewMode: 'grid' | 'list' | 'single'
  // 侧边栏开关
  sidebarOpen: boolean
  // 文件夹侧边栏开关
  folderSidebarOpen: boolean
  // 网格布局模式（网格/瀑布流）
  gridLayoutMode: 'grid' | 'masonry'
  // 收藏视图模式
  favoriteViewMode: 'all' | 'folder' | 'single'
  // 收藏文件夹选中状态
  selectedFavoriteFolder: string | null
  // 分组方式
  groupBy: GroupBy

  setViewMode: (mode: 'grid' | 'list' | 'single') => void
  toggleSidebar: () => void
  toggleFolderSidebar: () => void
  setGridLayoutMode: (mode: 'grid' | 'masonry') => void
  setFavoriteViewMode: (mode: 'all' | 'folder' | 'single') => void
  setSelectedFavoriteFolder: (folderPath: string | null) => void
  setGroupBy: (groupBy: GroupBy) => void
}

export const useViewStore = create<ViewState>((set) => ({
  viewMode: 'grid',
  sidebarOpen: true,
  folderSidebarOpen: true,
  gridLayoutMode: (localStorage.getItem('gridLayoutMode') as 'grid' | 'masonry') || 'grid',
  favoriteViewMode: 'folder',
  selectedFavoriteFolder: null,
  groupBy: (localStorage.getItem('groupBy') as GroupBy) || 'none',

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleFolderSidebar: () => set((state) => ({ folderSidebarOpen: !state.folderSidebarOpen })),
  setGridLayoutMode: (mode) => {
    set({ gridLayoutMode: mode })
    localStorage.setItem('gridLayoutMode', mode)
  },
  setFavoriteViewMode: (mode) => set({ favoriteViewMode: mode }),
  setSelectedFavoriteFolder: (folderPath) => set({ selectedFavoriteFolder: folderPath }),
  setGroupBy: (groupBy) => {
    set({ groupBy })
    localStorage.setItem('groupBy', groupBy)
  },
}))
