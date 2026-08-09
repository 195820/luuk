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
} from 'lucide-react'
import { isBrowserPlayableVideo } from '../utils/media'
import { formatFileSize } from '../utils/format'
import { logger } from '../utils/logger'
import { ImageLightbox, lightboxActions } from './ImageLightbox'
import { AudioViewer } from './AudioViewer'

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
  isFavorite?: boolean
  onFavoriteChange?: (isFavorite: boolean) => void
  mediaType?: 'image' | 'video' | 'audio'
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
  // 延迟显示 spinner：快速加载时不显示，消除闪烁
  const [showSpinner, setShowSpinner] = useState(false)
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 图片切换过渡：scale + opacity 进入效果
  const [imageTransition, setImageTransition] = useState<'idle' | 'entering'>('idle')
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoVolume, setVideoVolume] = useState(1)
  const [isGifPlaying, setIsGifPlaying] = useState(true)

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
      // 新图片进入：从模糊中淡入
      setImageTransition('entering')
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setImageTransition('idle')
        })
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

  // 监听全局快捷键事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleReset, handleFlipHorizontal, handleFlipVertical, onClose, onPrevious, onNext, mediaType, toggleVideoPlayback])

  // 工具栏按钮通用样式
  const toolbarBtnClass = 'btn-icon'
  const toolbarBtnActiveClass = 'bg-overlay-selected text-text-primary'

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
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
          <div
            className="w-full h-full transition-opacity transition-transform duration-250 ease-out"
            style={{
              opacity: imageTransition === 'entering' ? 0 : 1,
              transform: imageTransition === 'entering' ? 'scale(0.9)' : 'scale(1)',
            }}
          >
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
                setImageTransition('idle')
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
            />
          </div>
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
    </div>
  )
}
