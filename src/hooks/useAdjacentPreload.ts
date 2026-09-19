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
  const prevIndexRef = useRef(currentIndex)

  useEffect(() => {
    // 图片/视频时预加载（音频跳过）；收藏库多源 id 不适配，保持不预加载
    const activeType = currentMediaType === 'image' || currentMediaType === 'video'
    if (!activeType || images.length === 0 || libraryId === null || isFavoriteLibrary) {
      return
    }

    // 取消上一次未启动的预加载（防抖核心：快速翻页跳过中间图）
    cancelledRef.current = true
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
    }

    const localCancelled = { value: false }
    cancelledRef.current = false

    // P2-1: 方向感知——向浏览方向多预热 3 张，反方向仅 ±1~2
    const forward = currentIndex >= prevIndexRef.current
    prevIndexRef.current = currentIndex
    const fwd = [1, 2, 3]
    const back = [-1, -2, -3]
    const offsets = (forward ? [...fwd, ...back] : [...back, ...fwd]).map(o => currentIndex + o)

    timerRef.current = setTimeout(async () => {
      if (localCancelled.value) return

      for (const idx of offsets) {
        if (idx < 0 || idx >= images.length) continue
        const img = images[idx]
        const mt = img.mediaType
        if (mt !== 'image' && mt !== 'video') continue

        const relativePath = img.relative_path || img.relativePath
        if (!relativePath) continue

        try {
          const absolutePath = await window.electronAPI.getMediaPath(libraryId, img.id)
          if (localCancelled.value) return

          let url = urlCache.get(absolutePath)
          if (!url) {
            url = await window.electronAPI.getMediaUrl(absolutePath)
            if (localCancelled.value) return
            if (urlCache.size >= MAX_CACHE_SIZE) urlCache.clear()
            urlCache.set(absolutePath, url)
          }

          if (mt === 'video') {
            // 视频：拉取首 1MB 预热 OS 文件缓存 + 协议路径，丢弃响应体不解码
            try {
              const res = await fetch(url, { headers: { Range: 'bytes=0-1048575' } })
              await res.body?.cancel?.()
            } catch {
              // best-effort：协议不支持 Range 或中途取消则忽略
            }
          } else {
            // 图片：触发浏览器解码预热
            const preloadImg = new Image()
            preloadImg.src = url
          }
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
