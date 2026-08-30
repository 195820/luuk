import { create } from 'zustand'
import type { ImageGridItem } from '../components/ImageGrid'

interface SimilarImage extends ImageGridItem {
  phashDistance: number
  similarity: number
}

interface SimilarState {
  open: boolean
  libraryId: number | null
  sourceImage: ImageGridItem | null
  threshold: number
  results: SimilarImage[]
  loading: boolean

  findSimilar: (libraryId: number, imagePath: string, sourceImage: ImageGridItem) => Promise<void>
  setThreshold: (threshold: number) => void
  close: () => void
}

export const useSimilarStore = create<SimilarState>((set, get) => ({
  open: false,
  libraryId: null,
  sourceImage: null,
  threshold: 10,
  results: [],
  loading: false,

  findSimilar: async (libraryId: number, imagePath: string, sourceImage: ImageGridItem) => {
    set({ open: true, libraryId, sourceImage, loading: true, results: [] })

    try {
      const { threshold } = get()
      const result = await window.electronAPI.findSimilarImages(libraryId, imagePath, threshold, 200)

      if (result.success && result.images) {
        set({ results: result.images as SimilarImage[], loading: false })
      } else {
        set({ loading: false })
        // 可以显示错误提示
        console.error('查找相似图片失败:', result.error)
      }
    } catch (error) {
      console.error('查找相似图片异常:', error)
      set({ loading: false })
    }
  },

  setThreshold: (threshold: number) => {
    set({ threshold })
    // 如果已经打开且有源图片和库ID，自动重新查找
    const { open, sourceImage, libraryId } = get()
    if (open && sourceImage && sourceImage.imagePath && libraryId) {
      // 延迟执行，避免频繁调用
      setTimeout(() => {
        const { sourceImage: currentSource, libraryId: currentLibId } = get()
        if (currentSource && currentSource.imagePath && currentLibId) {
          get().findSimilar(currentLibId, currentSource.imagePath, currentSource)
        }
      }, 300)
    }
  },

  close: () => {
    set({ open: false, libraryId: null, sourceImage: null, results: [], loading: false })
  },
}))
