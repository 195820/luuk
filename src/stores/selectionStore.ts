import { create } from 'zustand'
import { useImageStore } from './imageStore'

interface SelectionState {
  selectedPaths: Set<string>
  lastSelectedPath: string | null
  toggleSelection: (path: string) => void
  selectRange: (fromPath: string, toPath: string, allPaths: string[]) => void
  selectAll: () => void
  clearSelection: () => void
  getSelectedPaths: () => string[]
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedPaths: new Set<string>(),
  lastSelectedPath: null,

  toggleSelection: (path: string) => {
    const next = new Set(get().selectedPaths)
    if (next.has(path)) next.delete(path); else next.add(path)
    set({ selectedPaths: next, lastSelectedPath: path })
  },

  selectRange: (fromPath, toPath, allPaths) => {
    const fromIdx = allPaths.indexOf(fromPath)
    const toIdx = allPaths.indexOf(toPath)
    if (fromIdx < 0 || toIdx < 0) return
    const start = Math.min(fromIdx, toIdx)
    const end = Math.max(fromIdx, toIdx)
    const rangePaths = allPaths.slice(start, end + 1)
    const next = new Set(get().selectedPaths)
    for (const p of rangePaths) next.add(p)
    set({ selectedPaths: next, lastSelectedPath: toPath })
  },

  selectAll: () => {
    // 跨 store 读取图片列表（zustand 允许 getState 避免循环依赖）
    const allPaths = useImageStore.getState().images.map(img => img.relative_path)
    set({ selectedPaths: new Set(allPaths) })
  },

  clearSelection: () => set({ selectedPaths: new Set(), lastSelectedPath: null }),

  getSelectedPaths: () => Array.from(get().selectedPaths),
}))
