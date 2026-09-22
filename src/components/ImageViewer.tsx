import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Info,
  X,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Image as WallpaperIcon,
  FolderSearch,
  Heart,
} from 'lucide-react'
import { isBrowserPlayableVideo } from '../utils/media'
import { formatFileSize } from '../utils/format'
import { logger } from '../utils/logger'
import { ImageLightbox, lightboxActions } from './ImageLightbox'
import { AudioViewer } from './AudioViewer'
import { RatingStars } from './RatingStars'
import { FileContextMenu } from './file-ops/FileContextMenu'
import { BatchRenameDialog } from './file-ops/BatchRenameDialog'
import { ExportDialog } from './file-ops/ExportDialog'
import { HistogramChart } from './HistogramChart'
import { applyFolderCoverSet } from '@/stores/folderCoverStore'
import { useImageStore } from '@/stores/imageStore'
import { useSlideshowStore } from '@/stores/slideshowStore'
import type { ExifInfo } from '@/types'

type ExifData = ExifInfo

export interface SlideshowSettings {
  enabled: boolean
  interval: number
}

interface ImageViewerProps {
  src: string
  alt?: string
  currentIndex?: number
  totalImages?: number
  onPrevious?: () => void
  onNext?: () => void
  onClose?: () => void
  imageInfo?: {
    width?: number
    height?: number
    fileSize?: number
    format?: string
  }
  slideshowSettings?: SlideshowSettings
  onSlideshowChange?: (enabled: boolean) => void
  libraryId?: number
  imageId?: number
  isFavorite?: boolean
  onFavoriteChange?: (isFavorite: boolean) => void
  mediaType?: 'image' | 'video' | 'audio'
  /** 图片路径（相对库根目录），用于评分 */
  imagePath?: string
  /** 当前评分 0-5 */
  rating?: number
  onRatingChange?: (rating: number) => void
  /** 视频播完回调（幻灯片模式下用于自动前进） */
  onVideoEnded?: () => void
  /** 视频播放状态变化回调 */
  onVideoPlayStateChange?: (isPlaying: boolean) => void
}

interface LoadingState {
  loading: boolean
  error: boolean
  naturalWidth: number
  naturalHeight: number
}

export function ImageViewer({
  src,
  alt = '图片',
  currentIndex = 0,
  totalImages = 1,
  onPrevious,
  onNext,
  onClose,
  imageInfo,
  mediaType = 'image',
  libraryId,
  imageId,
  imagePath,
  rating = 0,
  onRatingChange,
  isFavorite = false,
  onFavoriteChange,
  onVideoEnded,
  onVideoPlayStateChange,
}: ImageViewerProps) {
  const [loadingState, setLoadingState] = useState<LoadingState>({
    loading: true,
    error: false,
    naturalWidth: 0,
    naturalHeight: 0,
  })
  const [showInfo, setShowInfo] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // EXIF 状态（按 imagePath 缓存）
  const [exifData, setExifData] = useState<ExifData | null>(null)
  const [exifLoading, setExifLoading] = useState(false)
  const exifCacheRef = useRef<Map<string, ExifData>>(new Map())
  // 信息面板标签页（图片切回时重置到 EXIF）
  const [infoTab, setInfoTab] = useState<'exif' | 'histogram'>('exif')
  useEffect(() => { setInfoTab('exif') }, [imagePath])
  // 延迟显示 spinner：快速加载时不显示，消除闪烁
  const [showSpinner, setShowSpinner] = useState(false)
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 订阅幻灯片过渡类型（响应式，而非 getState() 快照）
  const slideshowTransition = useSlideshowStore(s => s.transition)
  // 图片切换过渡（由 SlideshowTransitionWrapper 的 key 驱动 CSS 动画）
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoVolume, setVideoVolume] = useState(1)
  const [isGifPlaying, setIsGifPlaying] = useState(true)
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [renameDialog, setRenameDialog] = useState(false)
  const [exportDialog, setExportDialog] = useState(false)
  // 收藏反馈状态：脉冲触发 + toast 提示
  const [favoriteToast, setFavoriteToast] = useState<{ liked: boolean } | null>(null)
  const [favoritePop, setFavoritePop] = useState(0)
  const favoriteToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevFavoriteRef = useRef<boolean | null>(null)
  // 图片切换时仅重置基线、不触发 toast（避免跨图/收藏库移除图片时误报）
  const srcChangedRef = useRef(false)

  // EXIF 惰性加载（仅在信息面板打开且媒体类型为图片时请求）
  useEffect(() => {
    if (!showInfo || mediaType !== 'image' || !libraryId || !imagePath) {
      if (!showInfo) setExifData(null)
      return
    }

    // 检查缓存
    const cached = exifCacheRef.current.get(imagePath)
    if (cached) {
      setExifData(cached)
      return
    }

    setExifLoading(true)
    let cancelled = false

    window.electronAPI.getImageExif(libraryId, imagePath).then(result => {
      if (cancelled) return
      if (result.success && result.data) {
        const data = result.data
        exifCacheRef.current.set(imagePath, data)
        setExifData(data)
      } else {
        setExifData({})
      }
      setExifLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setExifData({})
        setExifLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [showInfo, mediaType, libraryId, imagePath])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMenuAction = useCallback(async (action: string) => {
    if (!libraryId || !imagePath) return
    switch (action) {
      case 'copyPath':
        await navigator.clipboard.writeText(imagePath)
        break
      case 'setWallpaper':
        await window.electronAPI.setWallpaper(libraryId, imagePath)
        break
      case 'showInExplorer':
        await window.electronAPI.showInExplorer(libraryId, imagePath)
        break
      case 'delete': {
        const result = await window.electronAPI.deleteFiles(libraryId, [imagePath])
        if (result.failed.length > 0) {
          useImageStore.getState().setError(`删除失败：${result.failed[0].error}`)
        }
        onClose?.()
        break
      }
      case 'rename':
        setRenameDialog(true)
        break
      case 'export':
        setExportDialog(true)
        break
      case 'setFolderCover': {
        // 提取图片所在文件夹路径（正斜杠格式）
        const folderPath = imagePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '') || '.'
        // 修复 DEF-COVER-01：统一写入 store，侧边栏自动刷新
        await applyFolderCoverSet(libraryId, folderPath, imagePath)
        break
      }
    }
    setContextMenu(null)
  }, [libraryId, imagePath, onClose])

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const toggleVideoPlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (isVideoPlaying) {
      video.pause()
    } else {
      video.play().catch((err) => {
        if (err.name !== 'AbortError') logger.warn('ImageViewer', '视频播放失败', err.message)
      })
    }
    setIsVideoPlaying(!isVideoPlaying)
  }, [isVideoPlaying])

  const handleVideoSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video || !video.duration) return
    video.currentTime = parseFloat(e.target.value)
  }, [])

  const handleVideoVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    const vol = parseFloat(e.target.value)
    setVideoVolume(vol)
    if (video) video.volume = vol
  }, [])

  const handleVideoLoaded = useCallback(() => {
    const video = videoRef.current
    if (video) {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current)
        spinnerTimerRef.current = null
      }
      setShowSpinner(false)
      setLoadingState({
        loading: false,
        error: false,
        naturalWidth: video.videoWidth,
        naturalHeight: video.videoHeight,
      })
      setVideoDuration(video.duration)
    }
  }, [])

  const handleVideoError = useCallback(() => {
    if (spinnerTimerRef.current) {
      clearTimeout(spinnerTimerRef.current)
      spinnerTimerRef.current = null
    }
    setShowSpinner(false)
    setLoadingState({
      loading: false,
      error: true,
      naturalWidth: 0,
      naturalHeight: 0,
    })
  }, [])

  const handleVideoTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (video) {
      setVideoCurrentTime(video.currentTime)
      setIsVideoPlaying(!video.paused)
    }
  }, [])

  // 视频播完回调
  const handleVideoEnded = useCallback(() => {
    setIsVideoPlaying(false)
    onVideoEnded?.()
  }, [onVideoEnded])

  // 图片操作（通过事件转发给 ImageLightbox）
  const handleRotate = useCallback(() => lightboxActions.rotate(), [])
  const handleFlipHorizontal = useCallback(() => lightboxActions.flipH(), [])
  const handleFlipVertical = useCallback(() => lightboxActions.flipV(), [])
  const handleZoomIn = useCallback(() => lightboxActions.zoomIn(), [])
  const handleZoomOut = useCallback(() => lightboxActions.zoomOut(), [])
  const handleReset = useCallback(() => lightboxActions.reset(), [])

  // 收藏切换：与 F 键（App 层）同一路径 —— 都收敛到 onFavoriteChange → toggleFavorite
  const handleFavoriteClick = useCallback(() => {
    onFavoriteChange?.(!isFavorite)
  }, [isFavorite, onFavoriteChange])

  // 图片加载完成
  const handleImageLoaded = useCallback(
    (width: number, height: number) => {
      // 取消任何待处理的错误报告
      if (pendingErrorTimerRef.current) {
        clearTimeout(pendingErrorTimerRef.current)
        pendingErrorTimerRef.current = null
      }
      // 取消 spinner 延迟显示
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current)
        spinnerTimerRef.current = null
      }
      setShowSpinner(false)
      setLoadingState({
        loading: false,
        error: false,
        naturalWidth: width,
        naturalHeight: height,
      })
    },
    []
  )

  // 重置状态当 src 变化
  useEffect(() => {
    // 切换 src 时清理任何待处理的错误 timer
    if (pendingErrorTimerRef.current) {
      clearTimeout(pendingErrorTimerRef.current)
      pendingErrorTimerRef.current = null
    }
    // 清理上一次的 spinner timer
    if (spinnerTimerRef.current) {
      clearTimeout(spinnerTimerRef.current)
      spinnerTimerRef.current = null
    }
    setShowSpinner(false)
    // 保持旧图片可见，等新图片加载完成后再触发进入效果
    setLoadingState({
      loading: true,
      error: false,
      naturalWidth: 0,
      naturalHeight: 0,
    })
    // 切换图片时重置 GIF 播放状态
    setIsGifPlaying(true)
    // 图片已切换：重置收藏反馈基线，本次 isFavorite 变化不算"用户收藏反馈"
    srcChangedRef.current = true
    prevFavoriteRef.current = null
    setFavoriteToast(null)
    // 延迟显示 spinner：200ms 内加载完成则不显示，避免闪烁
    spinnerTimerRef.current = setTimeout(() => {
      spinnerTimerRef.current = null
      setShowSpinner(true)
    }, 200)

    return () => {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current)
        spinnerTimerRef.current = null
      }
    }
  }, [src])

  // 收藏反馈：isFavorite 变化时（F 键 / 按钮同一路径触发）播放脉冲 + 弹出提示
  useEffect(() => {
    // 刚切换图片：仅重置基线，本次 isFavorite 变化不视为用户操作反馈
    if (srcChangedRef.current) {
      srcChangedRef.current = false
      prevFavoriteRef.current = isFavorite
      return
    }
    const prev = prevFavoriteRef.current
    if (prev !== null && prev !== isFavorite) {
      setFavoritePop(p => p + 1)
      setFavoriteToast({ liked: isFavorite })
      if (favoriteToastTimerRef.current) clearTimeout(favoriteToastTimerRef.current)
      favoriteToastTimerRef.current = setTimeout(() => setFavoriteToast(null), 1600)
    }
    prevFavoriteRef.current = isFavorite
  }, [isFavorite])

  // 卸载时清理 toast 定时器
  useEffect(() => () => {
    if (favoriteToastTimerRef.current) clearTimeout(favoriteToastTimerRef.current)
  }, [])

  // 监听全局快捷键事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Ctrl+R: 切换幻灯片随机播放模式
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const { toggleMode, mode } = useSlideshowStore.getState()
        toggleMode()
        logger.info('ImageViewer', `幻灯片模式: ${mode === 'sequential' ? '随机' : '顺序'}`)
        return
      }

      switch (e.key) {
        case 'r':
        case 'R':
          handleReset()
          break
        case 'h':
        case 'H':
          handleFlipHorizontal()
          break
        case 'v':
        case 'V':
          handleFlipVertical()
          break
        case 'i':
        case 'I':
          setShowInfo(prev => !prev)
          break
        case ' ':
          if (mediaType === 'video') {
            e.preventDefault()
            toggleVideoPlayback()
          }
          break
        case 'Escape':
          onClose?.()
          break
        case 'ArrowLeft':
          onPrevious?.()
          break
        case 'ArrowRight':
          onNext?.()
          break
      }
    }
    // 捕获阶段监听：内联 YARL(ImageLightbox) 的 keydown 会在 #root 委托冒泡阶段
    // 对 ←/→/Esc 调用 native stopPropagation() 吞掉按键（DEF-5）。
    // 捕获阶段先于其运行，保证查看器快捷键不被抢占。
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleReset, handleFlipHorizontal, handleFlipVertical, onClose, onPrevious, onNext, mediaType, toggleVideoPlayback])

  // 工具栏按钮通用样式
  // 显式 no-drag：工具栏本身是 [-webkit-app-region:drag]（frameless 拖动区），
  // 与 App header 一致把 no-drag 直接加到按钮上，确保关闭/上一张/下一张可点击（DEF-5）
  const toolbarBtnClass = 'btn-icon [-webkit-app-region:no-drag]'
  const toolbarBtnActiveClass = 'bg-overlay-selected text-text-primary'

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden" onContextMenu={handleContextMenu}>
      {/* 工具栏 */}
      <motion.div
        className="relative z-10 h-10 px-4 flex items-center gap-4 bg-canvas [-webkit-app-region:drag] flex-shrink-0"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionPresets.fade}
      >
        <motion.div
          className="flex items-center gap-1.5 [-webkit-app-region:no-drag]"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...motionPresets.fade, delay: 0.05 }}
        >
          <button onClick={onClose} className={toolbarBtnClass} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </motion.div>

        <motion.div
          className="flex items-center gap-1.5 [-webkit-app-region:no-drag]"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...motionPresets.fade, delay: 0.1 }}
        >
          <button
            onClick={onPrevious}
            disabled={currentIndex <= 0}
            className={toolbarBtnClass}
            title="上一张 (←)"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={onNext}
            disabled={currentIndex >= totalImages - 1}
            className={toolbarBtnClass}
            title="下一张 (→)"
          >
            <ChevronRight size={16} />
          </button>
        </motion.div>

        <motion.div
          className="flex items-center gap-1.5 [-webkit-app-region:no-drag]"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...motionPresets.fade, delay: 0.15 }}
        >
          <span className="text-text-secondary text-sm px-2 min-w-[80px] text-center tabular-nums">
            {currentIndex + 1} / {totalImages}
          </span>
        </motion.div>

        {/* 图片操作按钮（仅图片类型显示） */}
        {mediaType === 'image' && (
          <>
            <motion.div
              className="flex items-center gap-1.5 [-webkit-app-region:no-drag]"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...motionPresets.fade, delay: 0.2 }}
            >
              <button onClick={handleRotate} className={toolbarBtnClass} title="旋转 90°">
                <RotateCw size={16} />
              </button>
              <button onClick={handleFlipHorizontal} className={toolbarBtnClass} title="水平翻转 (H)">
                <FlipHorizontal size={16} />
              </button>
              <button onClick={handleFlipVertical} className={toolbarBtnClass} title="垂直翻转 (V)">
                <FlipVertical size={16} />
              </button>
            </motion.div>

            <motion.div
              className="flex items-center gap-1.5 [-webkit-app-region:no-drag]"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...motionPresets.fade, delay: 0.25 }}
            >
              <button onClick={handleZoomIn} className={toolbarBtnClass} title="放大">
                <ZoomIn size={16} />
              </button>
              <button onClick={handleZoomOut} className={toolbarBtnClass} title="缩小">
                <ZoomOut size={16} />
              </button>
              <button onClick={handleReset} className={toolbarBtnClass} title="重置 (R)">
                <RotateCcw size={16} />
              </button>
            </motion.div>
          </>
        )}

        {/* 文件操作按钮（壁纸、资源管理器） */}
        {libraryId && imagePath && (
          <motion.div
            className="flex items-center gap-1 [-webkit-app-region:no-drag]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionPresets.fade, delay: 0.28 }}
          >
            <button
              onClick={() => window.electronAPI.setWallpaper(libraryId, imagePath)}
              className={toolbarBtnClass}
              title="设为壁纸"
            >
              <WallpaperIcon size={16} />
            </button>
            <button
              onClick={() => window.electronAPI.showInExplorer(libraryId, imagePath)}
              className={toolbarBtnClass}
              title="在资源管理器中显示"
            >
              <FolderSearch size={16} />
            </button>
          </motion.div>
        )}

        <motion.div
          className="flex items-center gap-1.5 [-webkit-app-region:no-drag]"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...motionPresets.fade, delay: 0.3 }}
        >
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`${toolbarBtnClass} ${showInfo ? toolbarBtnActiveClass : ''}`}
            title="图片信息 (I)"
          >
            <Info size={16} />
          </button>
        </motion.div>

        {/* 收藏按钮（可见反馈：高亮填充 + 切换脉冲动画 + toast 提示） */}
        {libraryId && imagePath && (
          <motion.div
            className="flex items-center gap-1.5 [-webkit-app-region:no-drag]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionPresets.fade, delay: 0.35 }}
          >
            <motion.button
              onClick={handleFavoriteClick}
              whileTap={{ scale: 0.9 }}
              className={`${toolbarBtnClass} ${isFavorite ? toolbarBtnActiveClass : ''}`}
              title={isFavorite ? '取消收藏 (F)' : '收藏 (F)'}
            >
              <motion.span
                key={favoritePop}
                initial={{ scale: 1.35 }}
                animate={{ scale: 1 }}
                transition={motionPresets.micro}
                className="flex"
              >
                <Heart size={16} className={isFavorite ? 'text-favorite fill-current' : ''} />
              </motion.span>
            </motion.button>
          </motion.div>
        )}

        {libraryId && imagePath && (
          <motion.div
            className="flex items-center gap-1.5 ml-auto [-webkit-app-region:no-drag]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionPresets.fade, delay: 0.4 }}
          >
            <RatingStars
              key={imagePath}
              libraryId={libraryId}
              imagePath={imagePath}
              initialRating={rating}
              size="small"
              onRatingChange={onRatingChange}
            />
          </motion.div>
        )}
      </motion.div>

      {/* 媒体查看区域 */}
      <div ref={wrapperRef} className="flex-1 relative overflow-hidden">
        {mediaType === 'video' ? (
          isBrowserPlayableVideo(alt || '') ? (
            <video
              ref={videoRef}
              src={src}
              className="w-full h-full max-w-full max-h-full object-contain select-none bg-black"
              onLoadedMetadata={handleVideoLoaded}
              onError={handleVideoError}
              onTimeUpdate={handleVideoTimeUpdate}
              onPlay={() => { setIsVideoPlaying(true); onVideoPlayStateChange?.(true) }}
              onPause={() => { setIsVideoPlaying(false); onVideoPlayStateChange?.(false) }}
              onEnded={handleVideoEnded}
              controls={false}
              draggable={false}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 w-full h-full text-text-muted">
              <svg className="w-16 h-16 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="20" rx="2"/>
                <polygon points="10,8 16,12 10,16"/>
                <line x1="18" y1="6" x2="6" y2="18" stroke="rgba(255,70,70,0.6)"/>
              </svg>
              <span className="text-lg text-text-secondary">不支持的格式: {imageInfo?.format?.toUpperCase()}</span>
              <span className="text-sm text-text-muted">浏览器无法直接播放此格式</span>
              {alt && <span className="text-base text-text-secondary max-w-[400px] text-center break-all">{alt}</span>}
              {imageInfo?.width && (imageInfo?.height ?? 0) > 0 && (
                <span className="text-sm text-text-muted">{imageInfo.width} x {imageInfo.height}</span>
              )}
            </div>
          )
        ) : mediaType === 'audio' ? (
          <AudioViewer src={src} filename={alt || ''} />
        ) : (
          <SlideshowTransitionWrapper key={src} transition={slideshowTransition}>
            <ImageLightbox
              src={src}
              alt={alt || '图片'}
              width={imageInfo?.width}
              height={imageInfo?.height}
              onImageLoaded={handleImageLoaded}
              onError={() => {
                // 取消 spinner 延迟显示
                if (spinnerTimerRef.current) {
                  clearTimeout(spinnerTimerRef.current)
                  spinnerTimerRef.current = null
                }
                setShowSpinner(false)
                // 延迟报告错误，避免瞬时加载成功导致的错误闪烁
                if (pendingErrorTimerRef.current) {
                  clearTimeout(pendingErrorTimerRef.current)
                }
                pendingErrorTimerRef.current = setTimeout(() => {
                  pendingErrorTimerRef.current = null
                  setLoadingState({ loading: false, error: true, naturalWidth: 0, naturalHeight: 0 })
                }, 100)
              }}
              paused={!isGifPlaying}
              libraryId={libraryId}
              imageId={imageId}
            />
          </SlideshowTransitionWrapper>
        )}
      </div>

      {/* 加载状态 — 延迟 200ms 显示，快速切换时不闪烁 */}
      {showSpinner && loadingState.loading && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3 text-text-secondary"
          style={{
            animation: 'fadeIn 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div className="relative w-10 h-10">
            {/* 背景圆环 - 提供视觉锚点 */}
            <svg className="absolute inset-0 w-full h-full text-text-muted/20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" strokeWidth="2"/>
            </svg>
            {/* 前景旋转圆环 - 双层创造深度 */}
            <svg className="absolute inset-0 w-full h-full animate-spinner text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="10" strokeWidth="2" strokeDasharray="32 32" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-sm">{mediaType === 'video' ? '正在加载视频...' : mediaType === 'audio' ? '正在加载音频...' : '正在加载图片...'}</span>
        </div>
      )}

      {/* 错误状态 */}
      {loadingState.error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-4 text-text-secondary">
          <svg className="w-10 h-10 text-error opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span>{mediaType === 'video' ? '视频加载失败' : mediaType === 'audio' ? '音频加载失败' : '图片加载失败'}</span>
          <button
            onClick={() => setLoadingState(prev => ({ ...prev, loading: true, error: false }))}
            className="px-4 py-2 bg-canvas-tertiary border border-border rounded-md text-text-secondary text-sm cursor-pointer transition-colors duration-150 hover:bg-canvas-raised hover:border-border-hover hover:text-text-primary hover:-translate-y-px active:translate-y-0"
          >
            重试
          </button>
        </div>
      )}

      {/* 收藏反馈 toast */}
      <AnimatePresence>
        {favoriteToast && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[150] pointer-events-none">
            <motion.div
              className="glass-l2 px-4 py-2 rounded-md flex items-center gap-2 shadow-lg shadow-black/20"
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={motionPresets.panel}
            >
              <Heart
                size={14}
                className={favoriteToast.liked ? 'text-favorite fill-current' : 'text-text-secondary'}
              />
              <span className="text-sm text-text-primary font-medium">
                {favoriteToast.liked ? '已收藏 ♥' : '已取消收藏'}
              </span>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 图片信息面板 */}
      <AnimatePresence>
        {showInfo && !loadingState.loading && !loadingState.error && (
          <motion.div
            className="glass-l3 absolute top-4 right-4 w-72 p-0 overflow-hidden z-[100]"
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={motionPresets.panel}
            style={{ transformOrigin: 'top right' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border font-semibold text-text-primary">
              <span>图片信息</span>
              <button
                onClick={() => setShowInfo(false)}
                className="btn-icon-sm"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-3">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-text-secondary text-sm">文件名:</span>
                <span className="text-text-primary text-sm text-right break-all">{alt}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-text-secondary text-sm">尺寸:</span>
                <span className="text-text-primary text-sm text-right">
                  {loadingState.naturalWidth || imageInfo?.width} × {loadingState.naturalHeight || imageInfo?.height} px
                </span>
              </div>
              {imageInfo?.fileSize && (
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-text-secondary text-sm">大小:</span>
                  <span className="text-text-primary text-sm">{formatFileSize(imageInfo.fileSize)}</span>
                </div>
              )}
              {imageInfo?.format && (
                <div className="flex justify-between py-2">
                  <span className="text-text-secondary text-sm">格式:</span>
                  <span className="text-text-primary text-sm">{imageInfo.format.toUpperCase()}</span>
                </div>
              )}

              {/* EXIF / 直方图（仅图片显示） */}
              {mediaType === 'image' && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1 mb-2">
                    <button
                      onClick={() => setInfoTab('exif')}
                      className={`px-2 py-0.5 text-xs rounded transition-colors ${
                        infoTab === 'exif'
                          ? 'bg-accent/20 text-accent font-medium'
                          : 'text-text-dim hover:text-text-secondary hover:bg-overlay-lighter'
                      }`}
                    >
                      拍摄信息
                    </button>
                    <button
                      onClick={() => setInfoTab('histogram')}
                      className={`px-2 py-0.5 text-xs rounded transition-colors ${
                        infoTab === 'histogram'
                          ? 'bg-accent/20 text-accent font-medium'
                          : 'text-text-dim hover:text-text-secondary hover:bg-overlay-lighter'
                      }`}
                    >
                      直方图
                    </button>
                  </div>

                  {infoTab === 'exif' && (
                    <>
                      {exifLoading && (
                        <div className="text-xs text-text-dim">加载中...</div>
                      )}
                      {!exifLoading && exifData && Object.keys(exifData).length === 0 && (
                        <div className="text-xs text-text-dim">无 EXIF 信息</div>
                      )}
                      {!exifLoading && exifData && Object.keys(exifData).length > 0 && (
                        <div className="space-y-1.5 text-xs">
                          {exifData.dateTimeOriginal && (
                            <ExifRow label="拍摄时间" value={exifData.dateTimeOriginal} />
                          )}
                          {(exifData.make || exifData.model) && (
                            <ExifRow label="相机" value={[exifData.make, exifData.model].filter(Boolean).join(' ')} />
                          )}
                          {exifData.lensModel && (
                            <ExifRow label="镜头" value={exifData.lensModel} />
                          )}
                          {exifData.exposureTime && (
                            <ExifRow label="曝光" value={exifData.exposureTime} />
                          )}
                          {exifData.fNumber !== undefined && (
                            <ExifRow label="光圈" value={`f/${exifData.fNumber}`} />
                          )}
                          {exifData.iso !== undefined && (
                            <ExifRow label="ISO" value={String(exifData.iso)} />
                          )}
                          {exifData.focalLength !== undefined && (
                            <ExifRow label="焦距" value={`${exifData.focalLength}mm`} />
                          )}
                          {exifData.gps && (
                            <div className="flex justify-between py-1">
                              <span className="text-text-secondary">GPS</span>
                              <a
                                href={`https://www.openstreetmap.org/?mlat=${exifData.gps.latitude}&mlon=${exifData.gps.longitude}#map=15/${exifData.gps.latitude}/${exifData.gps.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:underline"
                                title="在地图中查看"
                              >
                                {exifData.gps.latitude.toFixed(4)}, {exifData.gps.longitude.toFixed(4)}
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {infoTab === 'histogram' && libraryId && imagePath && (
                    <HistogramChart libraryId={libraryId} imagePath={imagePath} />
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video controls bar */}
      {mediaType === 'video' && isBrowserPlayableVideo(alt || '') && !loadingState.loading && !loadingState.error && (
        <div className="absolute bottom-0 left-0 right-0 h-12 px-3 flex items-center gap-2 z-[200]"
          style={{ background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))' }}
        >
          <button
            onClick={toggleVideoPlayback}
            className="btn-icon-sm text-text-primary"
            title={isVideoPlaying ? '暂停 (Space)' : '播放 (Space)'}
          >
            {isVideoPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="video-time">{formatTime(videoCurrentTime)}</span>
          <input
            type="range"
            min="0"
            max={videoDuration || 0}
            step="0.1"
            value={videoCurrentTime}
            onChange={handleVideoSeek}
            className="video-progress-bar"
          />
          <span className="video-time">{formatTime(videoDuration)}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {videoVolume === 0 ? <VolumeX size={14} className="opacity-60" /> : <Volume2 size={14} className="opacity-60" />}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={videoVolume}
              onChange={handleVideoVolumeChange}
              className="video-volume-slider"
            />
          </div>
        </div>
      )}

      {/* GIF controls */}
      {imageInfo?.format?.toLowerCase() === 'gif' && !loadingState.loading && !loadingState.error && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-overlay-darker border border-border rounded-md px-2 py-1 backdrop-blur-[8px] z-[200]">
          <button
            onClick={() => setIsGifPlaying(prev => !prev)}
            className="btn-icon-sm text-text-primary"
            title={isGifPlaying ? '暂停动画' : '播放动画'}
          >
            {isGifPlaying ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <span className="text-xs font-bold text-accent tracking-[1px]">GIF</span>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={handleMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* 批量重命名对话框 */}
      {renameDialog && libraryId && imagePath && (
        <BatchRenameDialog
          libraryId={libraryId}
          initialPaths={[imagePath]}
          onClose={() => setRenameDialog(false)}
        />
      )}

      {/* 导出对话框 */}
      {exportDialog && libraryId && imagePath && (
        <ExportDialog
          isOpen={true}
          onClose={() => setExportDialog(false)}
          libraryId={libraryId}
          selectedPaths={[imagePath]}
        />
      )}
    </div>
  )
}

/** EXIF 键值对行 */
function ExifRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary text-right max-w-[60%] break-all">{value}</span>
    </div>
  )
}

/** 幻灯片过渡动画包装器 */
function SlideshowTransitionWrapper({
  children,
  transition
}: {
  children: React.ReactNode
  transition: 'fade' | 'slide' | 'zoom'
}) {
  const transitionStyles: Record<'fade' | 'slide' | 'zoom', React.CSSProperties> = {
    fade: {
      transition: 'opacity 500ms ease-in-out',
    },
    slide: {
      transition: 'transform 500ms ease-in-out, opacity 500ms ease-in-out',
    },
    zoom: {
      transition: 'transform 500ms ease-in-out, opacity 500ms ease-in-out',
    },
  }

  return (
    <div
      className="w-full h-full"
      style={{
        ...transitionStyles[transition],
        animation: `slideshow-${transition} 500ms ease-in-out`,
      }}
    >
      {children}
    </div>
  )
}
