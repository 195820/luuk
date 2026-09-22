import { create } from 'zustand'

/**
 * 文件夹封面全局 Store
 *
 * 修复 DEF-COVER-01：FolderTree 内部 useState 只在 libraryId 变化时刷新，
 * ImageGrid / MasonryGrid / ImageViewer 从图片右键菜单调用 setFolderCover IPC
 * 写入后端后，侧边栏无法感知，需要切换目录才显示新封面。
 *
 * 解决：把封面提到全局 store，任何地方 setFolderCover 后统一 setCover / refresh，
 * FolderTree 订阅 store 即可自动同步。
 */
interface FolderCoverState {
  /** 当前生效的 libraryId（-1 或 null 表示无库/虚拟库） */
  libraryId: number | null
  /** folderPath -> coverPath 映射 */
  covers: Record<string, string>
  /** 是否正在加载 */
  loading: boolean

  /** 切换库时调用：加载该库的封面列表；libraryId < 0 直接清空 */
  loadForLibrary: (libraryId: number | null) => Promise<void>
  /** 单个设置成功后调用：本地立即更新 + 后端已写入 */
  setCover: (folderPath: string, coverPath: string) => void
  /** 单个清除后调用 */
  removeCover: (folderPath: string) => void
  /** 强制从后端重新拉取（用于跨组件写入后同步） */
  refresh: () => Promise<void>
}

export const useFolderCoverStore = create<FolderCoverState>((set, get) => ({
  libraryId: null,
  covers: {},
  loading: false,

  loadForLibrary: async (libraryId) => {
    if (!libraryId || libraryId < 0) {
      set({ libraryId: libraryId ?? null, covers: {}, loading: false })
      return
    }
    set({ libraryId, loading: true })
    try {
      const covers = await window.electronAPI?.getFolderCovers(libraryId)
      // 若在异步期间又切换了库，丢弃这次结果
      if (get().libraryId !== libraryId) return
      set({ covers: covers || {}, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  setCover: (folderPath, coverPath) => {
    set((state) => ({ covers: { ...state.covers, [folderPath]: coverPath } }))
  },

  removeCover: (folderPath) => {
    set((state) => {
      const next = { ...state.covers }
      delete next[folderPath]
      return { covers: next }
    })
  },

  refresh: async () => {
    const { libraryId } = get()
    if (!libraryId || libraryId < 0) return
    try {
      const covers = await window.electronAPI?.getFolderCovers(libraryId)
      if (get().libraryId !== libraryId) return
      set({ covers: covers || {} })
    } catch {
      /* ignore */
    }
  },
}))

/**
 * 便捷封装：写入后端 + 同步本地 store，供 ImageGrid / MasonryGrid / ImageViewer
 * 等所有"从图片设置封面"的入口调用，避免遗漏刷新。
 */
export async function applyFolderCoverSet(libraryId: number, folderPath: string, coverPath: string): Promise<void> {
  const res = await window.electronAPI.setFolderCover(libraryId, folderPath, coverPath)
  if (!res || res.success === false) {
    throw new Error(res?.error || 'setFolderCover failed')
  }
  const state = useFolderCoverStore.getState()
  if (state.libraryId === libraryId) {
    state.setCover(folderPath, coverPath)
  } else {
    // library 不匹配时（少见），拉全量兜底
    await state.refresh()
  }
}

/** 便捷封装：清除封面 */
export async function applyFolderCoverRemove(libraryId: number, folderPath: string): Promise<void> {
  const res = await window.electronAPI.removeFolderCover(libraryId, folderPath)
  if (!res || res.success === false) {
    throw new Error(res?.error || 'removeFolderCover failed')
  }
  const state = useFolderCoverStore.getState()
  if (state.libraryId === libraryId) {
    state.removeCover(folderPath)
  } else {
    await state.refresh()
  }
}

// 测试钩子：暴露 store，供 E2E 测试在直接修改 DB 后手动触发 store.refresh()
// （避免重新 reload 导致 currentLibraryId 回退到 FAVORITE_LIBRARY_ID）
if (typeof window !== 'undefined') {
  ;(window as any).__folderCoverStore = useFolderCoverStore
}