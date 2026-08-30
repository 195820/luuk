import { create } from 'zustand'
import type { Tag } from '@/types'

interface TagState {
  /** 当前库的标签列表（带计数） */
  tags: Array<Tag & { count: number }>
  /** 加载标签列表 */
  loadTags: (libraryId: number) => Promise<void>
  /** 标签对话框是否打开 */
  dialogOpen: boolean
  /** 对话框目标路径 */
  targetPaths: string[]
  /** 打开标签对话框 */
  openDialog: (paths: string[]) => void
  /** 关闭标签对话框 */
  closeDialog: () => void
}

export const useTagStore = create<TagState>((set) => ({
  tags: [],

  loadTags: async (libraryId: number) => {
    const result = await window.electronAPI.getAllTags(libraryId)
    if (result.success && result.data) {
      set({ tags: result.data })
    }
  },

  dialogOpen: false,
  targetPaths: [],

  openDialog: (paths: string[]) => {
    set({ dialogOpen: true, targetPaths: paths })
  },

  closeDialog: () => {
    set({ dialogOpen: false, targetPaths: [] })
  },
}))
