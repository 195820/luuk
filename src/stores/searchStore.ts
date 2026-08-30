import { create } from 'zustand'
import type { SearchCriteria, Image } from '../types'
import { logger } from '../utils/logger'

interface SearchState {
  /** 面板是否展开 */
  active: boolean
  /** 搜索中状态 */
  searching: boolean
  /** 当前搜索条件 */
  criteria: SearchCriteria
  /** 搜索结果 */
  results: Image[]
  /** 总命中数 */
  total: number
  /** 是否已执行过搜索（区分「未搜索」与「搜索无结果」） */
  hasSearched: boolean

  openPanel: () => void
  closePanel: () => void
  setCriteria: (patch: Partial<SearchCriteria>) => void
  /** 执行搜索（重置分页，从 offset=0 开始） */
  search: (libraryId: number) => Promise<void>
  /** 按标签搜索（清空其他条件，仅按标签筛选） */
  searchByTags: (libraryId: number, tagIds: number[]) => Promise<void>
  /** 滚动加载下一页 */
  loadMore: (libraryId: number) => Promise<void>
}

const PAGE_SIZE = 100

const EMPTY_CRITERIA: SearchCriteria = {}

export const useSearchStore = create<SearchState>((set, get) => ({
  active: false,
  searching: false,
  criteria: { ...EMPTY_CRITERIA },
  results: [],
  total: 0,
  hasSearched: false,

  openPanel: () => set({ active: true }),

  closePanel: () => set({
    active: false,
    results: [],
    total: 0,
    hasSearched: false,
    criteria: { ...EMPTY_CRITERIA },
    searching: false,
  }),

  setCriteria: (patch) => set((state) => ({
    criteria: { ...state.criteria, ...patch },
  })),

  search: async (libraryId: number) => {
    set({ searching: true, hasSearched: true })
    try {
      const res = await window.electronAPI.searchImages(
        libraryId,
        get().criteria,
        { limit: PAGE_SIZE, offset: 0 }
      )
      if (!res.success) {
        logger.error('SearchStore', res.error || '搜索失败')
        set({ results: [], total: 0, searching: false })
        return
      }
      set({ results: res.images, total: res.total, searching: false })
    } catch (err) {
      logger.error('SearchStore', '搜索异常', err)
      set({ results: [], total: 0, searching: false })
    }
  },

  searchByTags: async (libraryId: number, tagIds: number[]) => {
    set({
      criteria: { tagIds },
      active: true,
    })
    await get().search(libraryId)
  },

  loadMore: async (libraryId: number) => {
    const { results, total, searching } = get()
    if (searching || results.length >= total) return
    set({ searching: true })
    try {
      const res = await window.electronAPI.searchImages(
        libraryId,
        get().criteria,
        { limit: PAGE_SIZE, offset: results.length }
      )
      if (res.success) {
        set((state) => ({
          results: [...state.results, ...res.images],
          searching: false,
        }))
      } else {
        set({ searching: false })
      }
    } catch (err) {
      logger.error('SearchStore', '加载更多失败', err)
      set({ searching: false })
    }
  },
}))
