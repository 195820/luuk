import { create } from 'zustand'
import type { SearchCriteria, Image } from '../types'
import { logger } from '../utils/logger'

interface SearchPreset {
  id: string
  name: string
  criteria: SearchCriteria
  createdAt: string
}

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
  /** 搜索历史（最近 10 次） */
  history: string[]
  /** 搜索预设 */
  presets: SearchPreset[]

  openPanel: () => void
  closePanel: () => void
  setCriteria: (patch: Partial<SearchCriteria>) => void
  /** 执行搜索（重置分页，从 offset=0 开始） */
  search: (libraryId: number) => Promise<void>
  /** 按标签搜索（清空其他条件，仅按标签筛选） */
  searchByTags: (libraryId: number, tagIds: number[]) => Promise<void>
  /** 滚动加载下一页 */
  loadMore: (libraryId: number) => Promise<void>
  /** 加载搜索历史和预设 */
  loadHistoryAndPresets: () => Promise<void>
  /** 添加到搜索历史 */
  addToHistory: (query: string) => Promise<void>
  /** 清空搜索历史 */
  clearHistory: () => Promise<void>
  /** 保存为预设 */
  saveAsPreset: (name: string) => Promise<void>
  /** 删除预设 */
  removePreset: (id: string) => Promise<void>
  /** 加载预设 */
  loadPreset: (preset: SearchPreset) => void
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
  history: [],
  presets: [],

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
      // 添加到搜索历史（如果有文件名搜索词）
      const { fileName } = get().criteria
      if (fileName && fileName.trim()) {
        await get().addToHistory(fileName.trim())
      }

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

  loadHistoryAndPresets: async () => {
    try {
      const [history, presets] = await Promise.all([
        window.electronAPI.getSearchHistory(),
        window.electronAPI.getSearchPresets(),
      ])
      set({ history, presets })
    } catch (err) {
      logger.error('SearchStore', '加载历史/预设失败', err)
    }
  },

  addToHistory: async (query: string) => {
    try {
      await window.electronAPI.addSearchHistory(query)
      const history = await window.electronAPI.getSearchHistory()
      set({ history })
    } catch (err) {
      logger.error('SearchStore', '添加历史失败', err)
    }
  },

  clearHistory: async () => {
    try {
      await window.electronAPI.clearSearchHistory()
      set({ history: [] })
    } catch (err) {
      logger.error('SearchStore', '清空历史失败', err)
    }
  },

  saveAsPreset: async (name: string) => {
    try {
      const { criteria } = get()
      await window.electronAPI.saveSearchPreset(name, criteria)
      const presets = await window.electronAPI.getSearchPresets()
      set({ presets })
    } catch (err) {
      logger.error('SearchStore', '保存预设失败', err)
    }
  },

  removePreset: async (id: string) => {
    try {
      await window.electronAPI.deleteSearchPreset(id)
      const presets = await window.electronAPI.getSearchPresets()
      set({ presets })
    } catch (err) {
      logger.error('SearchStore', '删除预设失败', err)
    }
  },

  loadPreset: (preset: SearchPreset) => {
    set({
      criteria: preset.criteria,
      active: true,
    })
  },
}))
