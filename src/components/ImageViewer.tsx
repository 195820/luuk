import { useState, useEffect, useCallback, useRef } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
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
}: ImageViewerProps) {
  const [rotation, setRotation] = useState(0)
  const [flipHorizontal, setFlipHorizontal] = useState(false)
  const [flipVertical, setFlipVertical] = useState(false)
  const [fitMode, setFitMode] = useState<FitMode>('fit-window')
  const [loadingState, setLoadingState] = useState<LoadingState>({
    loading: true,
    error: false,
    naturalWidth: 0,
    naturalHeight: 0,
  })
  const [showInfo, setShowInfo] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const transformRef = useRef<any>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const pendingImageRef = useRef<{ width: number; height: number } | null>(null)

  // 计算目标缩放比例
  const calcScale = useCallback(
    (imgWidth: number, imgHeight: number): number => {
      const wrapper = wrapperRef.current
      if (!wrapper || imgWidth === 0 || imgHeight === 0) return 1
      const containerWidth = wrapper.clientWidth
      const containerHeight = wrapper.clientHeight
      if (containerWidth === 0 || containerHeight === 0) return 1
      switch (fitMode) {
        case 'fit-window':
          return Math.min(containerWidth / imgWidth, containerHeight / imgHeight)
        case 'actual-size':
          return 1
        case 'fit-width':
          return containerWidth / imgWidth
        case 'fit-height':
          return containerHeight / imgHeight
        default:
          return 1
      }
    },
    [fitMode]
  )

  // 在库完全初始化后应用缩放
  const applyFit = useCallback(() => {
    const controller = transformRef.current
    const wrapper = wrapperRef.current
    const pending = pendingImageRef.current
    if (!controller || !wrapper || !pending) return
    const scale = calcScale(pending.width, pending.height)
    const scaledWidth = pending.width * scale
    const scaledHeight = pending.height * scale
    const positionX = (wrapper.clientWidth - scaledWidth) / 2
    const positionY = (wrapper.clientHeight - scaledHeight) / 2
    controller.setTransform(positionX, positionY, scale, 0)
  }, [calcScale])

  // 重置变换
  const handleReset = useCallback(() => {
    setFitMode('fit-window')
    setRotation(0)
    setFlipHorizontal(false)
    setFlipVertical(false)
    requestAnimationFrame(() => {
      const img = imageRef.current
      if (img?.complete && img.naturalWidth) {
        pendingImageRef.current = { width: img.naturalWidth, height: img.naturalHeight }
        applyFit()
      }
    })
  }, [applyFit])

  // 旋转
  const handleRotate = useCallback(() => {
    setRotation(prev => (prev + 90) % 360)
  }, [])

  // 水平翻转
  const handleFlipHorizontal = useCallback(() => {
    setFlipHorizontal(prev => !prev)
  }, [])

  // 垂直翻转
  const handleFlipVertical = useCallback(() => {
    setFlipVertical(prev => !prev)
  }, [])

  // 放大
  const handleZoomIn = useCallback(() => {
    transformRef.current?.zoomIn(0.5)
  }, [])

  // 缩小
  const handleZoomOut = useCallback(() => {
    transformRef.current?.zoomOut(0.5)
  }, [])

  // 适应模式切换
  const handleFitModeChange = useCallback((mode: FitMode) => {
    setFitMode(mode)
  }, [])

  // 图片加载完成
  const handleImageLoaded = useCallback(
    (width: number, height: number) => {
      setLoadingState({
        loading: false,
        error: false,
        naturalWidth: width,
        naturalHeight: height,
      })
      pendingImageRef.current = { width, height }
      applyFit()
    },
    [applyFit]
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

  // fitMode 变化时重新应用缩放
  useEffect(() => {
    const img = imageRef.current
    if (img?.complete && img.naturalWidth) {
      pendingImageRef.current = { width: img.naturalWidth, height: img.naturalHeight }
      applyFit()
    }
  }, [fitMode, applyFit])

  // rotation/flip 变化时重新居中
  useEffect(() => {
    requestAnimationFrame(() => {
      const controller = transformRef.current
      if (!controller) return
      controller.centerView(undefined, 0)
    })
  }, [rotation, flipHorizontal, flipVertical])

  // 监听全局重置事件
  useEffect(() => {
    const handleResetEvent = () => {
      handleReset()
    }
    window.addEventListener('image-viewer-reset', handleResetEvent)
    return () => {
      window.removeEventListener('image-viewer-reset', handleResetEvent)
    }
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
        case '0':
          setFitMode('fit-window')
          break
        case '1':
          setFitMode('actual-size')
          break
        case 'h':
        case 'H':
          setFlipHorizontal(prev => !prev)
          break
        case 'v':
        case 'V':
          setFlipVertical(prev => !prev)
          break
        case 'i':
        case 'I':
          setShowInfo(prev => !prev)
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleReset, onClose, onPrevious, onNext])

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const transformStyle = {
    transform: `rotate(${rotation}deg) scaleX(${flipHorizontal ? -1 : 1}) scaleY(${flipVertical ? -1 : 1})`,
    transformOrigin: 'center center',
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

        <div className="toolbar-group">
          <button onClick={handleRotate} className="toolbar-btn" title="旋转 90° (R)">
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
          <button
            onClick={() => handleFitModeChange('fit-window')}
            className={`toolbar-btn ${fitMode === 'fit-window' ? 'active' : ''}`}
            title="适应窗口 (0)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          </button>
          <button
            onClick={() => handleFitModeChange('actual-size')}
            className={`toolbar-btn ${fitMode === 'actual-size' ? 'active' : ''}`}
            title="实际大小 (1)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 21H3V3h18v18z"/>
              <path d="M9 9h6v6H9z"/>
            </svg>
          </button>
        </div>

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

      {/* 图片查看区域 */}
      <div ref={wrapperRef} className="viewer-canvas">
        <TransformWrapper
          initialScale={1}
          minScale={0.1}
          maxScale={10}
          limitToBounds={false}
          centerZoomedOut={true}
          centerOnInit={false}
          animationTime={0}
          alignmentAnimation={{ disabled: true }}
          onInit={() => {
            if (pendingImageRef.current) {
              applyFit()
            }
          }}
          wheel={{ step: 0.5 }}
          pinch={{ step: 0.5 }}
          doubleClick={{ step: 1.5 }}
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%' }}
          ref={(ref) => { if (ref) transformRef.current = ref }}
        >
          <TransformComponent>
            <img
              ref={imageRef}
              src={src}
              alt={alt || '图片'}
              className="viewer-image"
              draggable={false}
              style={transformStyle}
              onLoad={(e) => {
                const img = e.currentTarget
                handleImageLoaded(img.naturalWidth, img.naturalHeight)
              }}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>

      {/* 加载状态 */}
      {loadingState.loading && (
        <div className="image-loading">
          <svg className="loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" strokeWidth="2" strokeDasharray="32" strokeLinecap="round"/>
          </svg>
          <span>正在加载图片...</span>
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
          <span>图片加载失败</span>
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

      {/* 控制按钮 */}
      <div className="viewer-controls">
        <button onClick={handleReset} className="control-btn" title="重置 (R)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
          <span>重置</span>
        </button>
        <button onClick={handleZoomOut} className="control-btn" title="缩小 (-)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button onClick={handleZoomIn} className="control-btn" title="放大 (+)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
