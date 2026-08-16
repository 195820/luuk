import { create } from 'zustand'
import type { HistoryItem } from '../types'
import { logger } from '../utils/logger'

/**
 * 浏览历史 store
 * 后端持久化在 master.db 的 history 表；此处维护侧边栏展示的去重列表
 */
interface HistoryState {
  history: HistoryItem[]
  /** 侧边栏展示条数上限 */
  historyLimit: number
  loadHistory: (limit?: number) => Promise<void>
  /**
   * 记录一条浏览（连续重复自动跳过）；乐观更新本地列表。
   * meta 可携带当前图片对象，补齐 id/尺寸等元数据，保证缩略图与打开立即可用
   */
  addHistory: (libraryId: number, imagePath: string, meta?: Partial<HistoryItem>) => void
  clearHistory: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  historyLimit: 30,

  loadHistory: async (limit) => {
    try {
      const items = await window.electronAPI.getHistory(limit ?? get().historyLimit)
      // 按 (library_id, image_path) 去重，保留最新的那条（history 按 viewed_at DESC 返回）
      const seen = new Set<string>()
      const deduped = items.filter((item) => {
        const key = `${item.library_id}/${item.image_path}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      set({ history: deduped })
    } catch (error) {
      logger.error('HistoryStore', '加载浏览历史失败', error)
      set({ history: [] })
    }
  },

  addHistory: (libraryId, imagePath, meta) => {
    if (!libraryId || libraryId === -1 || !imagePath) return
    const { history, historyLimit } = get()
    // 避免幻灯片/快速翻页产生大量连续重复记录
    if (history[0]?.library_id === libraryId && history[0]?.image_path === imagePath) return

    window.electronAPI.addHistory(libraryId, imagePath).catch((err) => {
      logger.error('HistoryStore', '添加浏览历史失败', err)
    })

    // 乐观更新本地列表：顶部插入并去重；携带 meta 元数据（id 等）保证缩略图/打开可用
    const rest = history.filter((h) => !(h.library_id === libraryId && h.image_path === imagePath))
    set({
      history: [
        {
          library_id: libraryId,
          library_name: meta?.library_name || '',
          library_root_path: meta?.library_root_path || '',
          image_path: imagePath,
          viewed_at: new Date().toISOString(),
          id: meta?.id,
          width: meta?.width,
          height: meta?.height,
          file_size: meta?.file_size,
          format: meta?.format,
          mediaType: meta?.mediaType,
        },
        ...rest,
      ].slice(0, historyLimit),
    })
  },

  clearHistory: async () => {
    try {
      await window.electronAPI.clearHistory()
      set({ history: [] })
    } catch (error) {
      logger.error('HistoryStore', '清空浏览历史失败', error)
    }
  },
}))