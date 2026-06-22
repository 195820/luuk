import { useState, useEffect, useCallback, useRef } from 'react'
import { isBrowserPlayableVideo } from '../utils/media'
import { ImageLightbox, lightboxActions } from './ImageLightbox'
import { AudioViewer } from './AudioViewer'
import './ImageViewer.css'

export type FitMode = 'fit-window' | 'actual-size' | 'fit-width' | 'fit-height'

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
      video.play().catch(() => {})
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
    setLoadingState({
      loading: true,
      error: false,
      naturalWidth: 0,
      naturalHeight: 0,
    })
  }, [src])

  // 监听全局重置事件
  useEffect(() => {
    const handleResetEvent = () => handleReset()
    window.addEventListener('image-viewer-reset', handleResetEvent)
    return () => window.removeEventListener('image-viewer-reset', handleResetEvent)
  }, [handleReset])

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

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="image-viewer">
      {/* 工具栏 */}
      <div className="viewer-toolbar">
        <div className="toolbar-group">
          <button onClick={onClose} className="toolbar-btn" title="关闭 (Esc)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="toolbar-group">
          <button
            onClick={onPrevious}
            disabled={currentIndex <= 0}
            className="toolbar-btn"
            title="上一张 (←)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button
            onClick={onNext}
            disabled={currentIndex >= totalImages - 1}
            className="toolbar-btn"
            title="下一张 (→)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        <div className="toolbar-group">
          <span className="toolbar-info">
            {currentIndex + 1} / {totalImages}
          </span>
        </div>

        {/* 图片操作按钮（仅图片类型显示） */}
        {mediaType === 'image' && (
          <>
            <div className="toolbar-group">
              <button onClick={handleRotate} className="toolbar-btn" title="旋转 90°">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
              <button onClick={handleFlipHorizontal} className="toolbar-btn" title="水平翻转 (H)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v18"/>
                  <path d="M8 8l-4 4 4 4"/>
                  <path d="M16 16l4-4-4-4"/>
                </svg>
              </button>
              <button onClick={handleFlipVertical} className="toolbar-btn" title="垂直翻转 (V)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12h18"/>
                  <path d="M8 16l4 4 4-4"/>
                  <path d="M16 8l-4-4-4 4"/>
                </svg>
              </button>
            </div>

            <div className="toolbar-group">
              <button onClick={handleZoomIn} className="toolbar-btn" title="放大">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  <line x1="11" y1="8" x2="11" y2="14"/>
                  <line x1="8" y1="11" x2="14" y2="11"/>
                </svg>
              </button>
              <button onClick={handleZoomOut} className="toolbar-btn" title="缩小">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  <line x1="8" y1="11" x2="14" y2="11"/>
                </svg>
              </button>
              <button onClick={handleReset} className="toolbar-btn" title="重置 (R)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
              </button>
            </div>
          </>
        )}

        <div className="toolbar-group">
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`toolbar-btn ${showInfo ? 'active' : ''}`}
            title="图片信息 (I)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 媒体查看区域 */}
      <div ref={wrapperRef} className="viewer-canvas">
        {mediaType === 'video' ? (
          isBrowserPlayableVideo(alt || '') ? (
            <video
              ref={videoRef}
              src={src}
              className="viewer-video"
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
            <div className="viewer-unsupported-placeholder">
              <svg className="unsupported-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="20" rx="2"/>
                <polygon points="10,8 16,12 10,16"/>
                <line x1="18" y1="6" x2="6" y2="18" stroke="rgba(255,70,70,0.6)"/>
              </svg>
              <span className="unsupported-label">不支持的格式: {imageInfo?.format?.toUpperCase()}</span>
              <span className="unsupported-hint">浏览器无法直接播放此格式</span>
              {alt && <span className="unsupported-filename">{alt}</span>}
              {imageInfo?.width && (imageInfo?.height ?? 0) > 0 && (
                <span className="unsupported-dims">{imageInfo.width} x {imageInfo.height}</span>
              )}
            </div>
          )
        ) : mediaType === 'audio' ? (
          <AudioViewer src={src} filename={alt || ''} />
        ) : (
          <ImageLightbox
            src={src}
            alt={alt || '图片'}
            onImageLoaded={handleImageLoaded}
            onError={() => setLoadingState({ loading: false, error: true, naturalWidth: 0, naturalHeight: 0 })}
          />
        )}
      </div>

      {/* 加载状态 */}
      {loadingState.loading && (
        <div className="image-loading">
          <svg className="loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" strokeWidth="2" strokeDasharray="32" strokeLinecap="round"/>
          </svg>
          <span>{mediaType === 'video' ? '正在加载视频...' : mediaType === 'audio' ? '正在加载音频...' : '正在加载图片...'}</span>
        </div>
      )}

      {/* 错误状态 */}
      {loadingState.error && (
        <div className="image-error">
          <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span>{mediaType === 'video' ? '视频加载失败' : mediaType === 'audio' ? '音频加载失败' : '图片加载失败'}</span>
          <button onClick={() => setLoadingState(prev => ({ ...prev, loading: true, error: false }))} className="retry-btn">
            重试
          </button>
        </div>
      )}

      {/* 图片信息面板 */}
      {showInfo && !loadingState.loading && !loadingState.error && (
        <div className="image-info-panel">
          <div className="info-header">
            <span>图片信息</span>
            <button onClick={() => setShowInfo(false)} className="close-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div className="info-content">
            <div className="info-row">
              <span className="info-label">文件名:</span>
              <span className="info-value">{alt}</span>
            </div>
            <div className="info-row">
              <span className="info-label">尺寸:</span>
              <span className="info-value">
                {loadingState.naturalWidth || imageInfo?.width} × {loadingState.naturalHeight || imageInfo?.height} px
              </span>
            </div>
            {imageInfo?.fileSize && (
              <div className="info-row">
                <span className="info-label">大小:</span>
                <span className="info-value">{formatFileSize(imageInfo.fileSize)}</span>
              </div>
            )}
            {imageInfo?.format && (
              <div className="info-row">
                <span className="info-label">格式:</span>
                <span className="info-value">{imageInfo.format.toUpperCase()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Video controls bar */}
      {mediaType === 'video' && isBrowserPlayableVideo(alt || '') && !loadingState.loading && !loadingState.error && (
        <div className="video-controls-bar">
          <button
            onClick={toggleVideoPlayback}
            className="video-ctrl-btn"
            title={isVideoPlaying ? '暂停 (Space)' : '播放 (Space)'}
          >
            {isVideoPlaying ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="2" y="1" width="4" height="14" rx="1"/>
                <rect x="10" y="1" width="4" height="14" rx="1"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <polygon points="3,1 14,8 3,15"/>
              </svg>
            )}
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
          <div className="video-volume-group">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
              <path d="M6 2L2 6H0v4h2l4 4V2z"/>
            </svg>
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
        <div className="gif-controls">
          <button
            onClick={() => setIsGifPlaying(prev => !prev)}
            className="gif-ctrl-btn"
            title={isGifPlaying ? '暂停动画' : '播放动画'}
          >
            {isGifPlaying ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <rect x="2" y="1" width="4" height="14" rx="1"/>
                <rect x="10" y="1" width="4" height="14" rx="1"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <polygon points="3,1 14,8 3,15"/>
              </svg>
            )}
          </button>
          <span className="gif-label">GIF</span>
        </div>
      )}
    </div>
  )
}
