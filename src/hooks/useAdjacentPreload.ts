/**
 * 查看器相邻图预加载 hook
 * 150ms 防抖 + 优先级（±1 先于 ±2），快速翻页自动跳过中间图
 */
import { useEffect, useRef } from 'react'
import { logger } from '@/utils/logger'

interface PreloadImage {
  id: number
  relative_path?: string
  relativePath?: string
  mediaType?: 'image' | 'video' | 'audio'
}

const DEBOUNCE_MS = 150
const MAX_CACHE_SIZE = 20

// 模块级令牌缓存：绝对路径 → media:// URL（避免重复注册令牌）
const urlCache = new Map<string, string>()

/**
 * 获取已预加载的 media:// URL（命中则复用，避免重复注册令牌；
 * 同一 URL 可让浏览器按 URL 键控复用解码结果）
 */
export function getPreloadedUrl(absolutePath: string): string | undefined {
  return urlCache.get(absolutePath)
}

interface PreloadParams {
  currentIndex: number
  images: PreloadImage[]
  libraryId: number | null
  isFavoriteLibrary: boolean
  /** 是否为图片类型（外部传入的当前图媒体类型） */
  currentMediaType?: string
}

export function useAdjacentPreload({
  currentIndex,
  images,
  libraryId,
  isFavoriteLibrary,
  currentMediaType,
}: PreloadParams) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    // 仅在图片类型时预加载
    if (currentMediaType !== 'image' || images.length === 0 || libraryId === null || isFavoriteLibrary) {
      return
    }

    // 取消上一次未启动的预加载（防抖核心：快速翻页跳过中间图）
    cancelledRef.current = true
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
    }

    const localCancelled = { value: false }
    cancelledRef.current = false

    timerRef.current = setTimeout(async () => {
      if (localCancelled.value) return

      // 优先级：±1 先、±2 次
      const offsets = [
        currentIndex - 1, currentIndex + 1,
        currentIndex - 2, currentIndex + 2,
      ]

      for (const idx of offsets) {
        if (idx < 0 || idx >= images.length) continue
        const img = images[idx]
        if (img.mediaType !== 'image') continue

        const relativePath = img.relative_path || img.relativePath
        if (!relativePath) continue

        try {
          const absolutePath = await window.electronAPI.getMediaPath(libraryId, img.id)

          // 已缓存则跳过
          if (urlCache.has(absolutePath)) continue

          const url = await window.electronAPI.getMediaUrl(absolutePath)
          if (localCancelled.value) return

          // 缓存管理
          if (urlCache.size >= MAX_CACHE_SIZE) urlCache.clear()
          urlCache.set(absolutePath, url)

          // 触发浏览器解码预热
          const preloadImg = new Image()
          preloadImg.src = url
        } catch (err) {
          logger.warn('useAdjacentPreload', `预加载索引 ${idx} 失败`, String(err))
        }
      }
    }, DEBOUNCE_MS)

    return () => {
      localCancelled.value = true
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [currentIndex, images, libraryId, isFavoriteLibrary, currentMediaType])
}
