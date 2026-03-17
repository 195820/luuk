import { useState, useEffect, useCallback, useRef } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import './ImageViewer.minimal.css'

export type FitMode = 'fit-window' | 'actual-size' | 'fit-width' | 'fit-height'

export interface SlideshowSettings {
  enabled: boolean
  interval: number
}

interface ImageViewerMinimalProps {
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

interface ViewerContentProps {
  src: string
  alt: string
  rotation: number
  flipHorizontal: boolean
  flipVertical: boolean
  fitMode: FitMode
  onImageLoaded: (width: number, height: number) => void
  setTransformFn: React.MutableRefObject<((scale: number) => void) | null>
  imageRef: React.RefObject<HTMLImageElement | null>
  onApplyFitMode: (scale: number) => void
}

function ViewerContent({
  src,
  alt,
  rotation,
  flipHorizontal,
  flipVertical,
  fitMode,
  onImageLoaded,
  setTransformFn,
  imageRef,
  onApplyFitMode,
}: ViewerContentProps) {
  const transformStyle = {
    transform: `rotate(${rotation}deg) scaleX(${flipHorizontal ? -1 : 1}) scaleY(${flipVertical ? -1 : 1})`,
    transformOrigin: 'center center',
  }

  const applyScale = useCallback((scale: number) => {
    if (setTransformFn.current) {
      requestAnimationFrame(() => {
        setTransformFn.current?.(scale)
      })
    }
  }, [setTransformFn])

  useEffect(() => {
    const img = imageRef.current
    if (!img?.complete || !img.naturalWidth) return

    const container = document.querySelector('.image-viewer-minimal') as HTMLElement
    if (!container) return

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight

    let scale = 1
    switch (fitMode) {
      case 'fit-window':
        scale = Math.min(containerWidth / img.naturalWidth, containerHeight / img.naturalHeight, 1)
        break
      case 'actual-size':
        scale = 1
        break
      case 'fit-width':
        scale = containerWidth / img.naturalWidth
        break
      case 'fit-height':
        scale = containerHeight / img.naturalHeight
        break
    }

    applyScale(scale)
  }, [fitMode, rotation, applyScale, src])

  return (
    <TransformComponent>
      <div className="image-wrapper-minimal" style={transformStyle}>
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          className="viewer-image-minimal"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget
            const width = img.naturalWidth
            const height = img.naturalHeight
            onImageLoaded(width, height)
            const container = document.querySelector('.image-viewer-minimal') as HTMLElement
            if (container && fitMode === 'fit-window') {
              const containerWidth = container.clientWidth
              const containerHeight = container.clientHeight
              const scale = Math.min(containerWidth / width, containerHeight / height, 1)
              onApplyFitMode(scale)
            }
          }}
        />
      </div>
    </TransformComponent>
  )
}

export function ImageViewerMinimal({
  src,
  alt = '图片',
  currentIndex = 0,
  totalImages = 1,
  onPrevious,
  onNext,
  onClose,
  imageInfo,
  isFavorite = false,
  onFavoriteChange,
}: ImageViewerMinimalProps) {
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
  const setTransformFn = useRef<((scale: number) => void) | null>(null)

  const calculateFitWindowScale = useCallback((): number => {
    const img = imageRef.current
    const container = document.querySelector('.image-viewer-minimal') as HTMLElement
    if (!img?.complete || !img.naturalWidth || !container) return 1

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    return Math.min(containerWidth / img.naturalWidth, containerHeight / img.naturalHeight, 1)
  }, [])

  const handleReset = useCallback(() => {
    const scale = calculateFitWindowScale()
    setFitMode('fit-window')
    if (setTransformFn.current) {
      requestAnimationFrame(() => {
        setTransformFn.current?.(scale)
      })
    }
    setRotation(0)
    setFlipHorizontal(false)
    setFlipVertical(false)
  }, [calculateFitWindowScale])

  const handleRotate = useCallback(() => {
    setRotation(prev => (prev + 90) % 360)
  }, [])

  const handleFlipHorizontal = useCallback(() => {
    setFlipHorizontal(prev => !prev)
  }, [])

  const handleFlipVertical = useCallback(() => {
    setFlipVertical(prev => !prev)
  }, [])

  const handleFitModeChange = useCallback((mode: FitMode) => {
    setFitMode(mode)
  }, [])

  const handleApplyFitMode = useCallback((scale: number) => {
    if (setTransformFn.current) {
      setTransformFn.current(scale)
    }
  }, [])

  const handleImageLoaded = useCallback((width: number, height: number) => {
    setLoadingState({
      loading: false,
      error: false,
      naturalWidth: width,
      naturalHeight: height,
    })
  }, [])

  useEffect(() => {
    setLoadingState({
      loading: true,
      error: false,
      naturalWidth: 0,
      naturalHeight: 0,
    })
  }, [src])

  useEffect(() => {
    const handleResetEvent = () => handleReset()
    window.addEventListener('image-viewer-reset', handleResetEvent)
    return () => window.removeEventListener('image-viewer-reset', handleResetEvent)
  }, [handleReset])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case '0': setFitMode('fit-window'); break
        case '1': setFitMode('actual-size'); break
        case 'h':
        case 'H': setFlipHorizontal(prev => !prev); break
        case 'v':
        case 'V': setFlipVertical(prev => !prev); break
        case 'i':
        case 'I': setShowInfo(prev => !prev); break
        case 'Escape': onClose?.(); break
        case 'ArrowLeft': onPrevious?.(); break
        case 'ArrowRight': onNext?.(); break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, onPrevious, onNext])

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="image-viewer-minimal">
      {/* 顶部工具栏 - 悬浮岛屿 */}
      <div className="viewer-toolbar-minimal">
        <div className="toolbar-group-minimal">
          <button onClick={onClose} className="toolbar-btn-minimal" title="关闭 (Esc)">
            ✕
          </button>
        </div>

        <div className="toolbar-group-minimal">
          <button onClick={onPrevious} disabled={currentIndex <= 0} className="toolbar-btn-minimal" title="上一张 (←)">
            ‹
          </button>
          <button onClick={onNext} disabled={currentIndex >= totalImages - 1} className="toolbar-btn-minimal" title="下一张 (→)">
            ›
          </button>
        </div>

        <div className="toolbar-group-minimal">
          <span className="toolbar-counter-minimal">
            {currentIndex + 1} <span style={{ opacity: 0.3 }}>/</span> {totalImages}
          </span>
        </div>

        <div className="toolbar-group-minimal">
          <button onClick={handleRotate} className="toolbar-btn-minimal" title="旋转 (R)">
            ↻
          </button>
          <button onClick={handleFlipHorizontal} className="toolbar-btn-minimal" title="水平翻转 (H)">
            ↔
          </button>
          <button onClick={handleFlipVertical} className="toolbar-btn-minimal" title="垂直翻转 (V)">
            ↕
          </button>
        </div>

        <div className="toolbar-group-minimal">
          <button
            onClick={() => handleFitModeChange('fit-window')}
            className={`toolbar-btn-minimal ${fitMode === 'fit-window' ? 'active' : ''}`}
            title="适应窗口 (0)"
          >
            ⊞
          </button>
          <button
            onClick={() => handleFitModeChange('actual-size')}
            className={`toolbar-btn-minimal ${fitMode === 'actual-size' ? 'active' : ''}`}
            title="实际大小 (1)"
          >
            1:1
          </button>
        </div>

        <div className="toolbar-group-minimal">
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`toolbar-btn-minimal ${showInfo ? 'active' : ''}`}
            title="图片信息 (I)"
          >
            ℹ
          </button>
        </div>
      </div>

      {/* 收藏按钮 */}
      {onFavoriteChange && (
        <button
          onClick={() => onFavoriteChange(!isFavorite)}
          className={`viewer-favorite-minimal ${isFavorite ? 'is-favorited' : ''}`}
          title={isFavorite ? '取消收藏' : '收藏'}
        >
          {isFavorite ? '♥' : '♡'}
        </button>
      )}

      {/* 导航区域 */}
      <div className="viewer-nav-zone-minimal prev" onClick={onPrevious}>
        <span className="nav-arrow-minimal">‹</span>
      </div>
      <div className="viewer-nav-zone-minimal next" onClick={onNext}>
        <span className="nav-arrow-minimal">›</span>
      </div>

      {/* 图片查看区域 */}
      <TransformWrapper
        initialScale={1}
        minScale={0.1}
        maxScale={10}
        limitToBounds={false}
        centerOnInit
        wheel={{ step: 0.5 }}
        pinch={{ step: 0.5 }}
        doubleClick={{ step: 1.5 }}
        ref={(ref) => {
          if (ref) {
            setTransformFn.current = (scale: number) => {
              ref.centerView(scale)
            }
          }
        }}
      >
        <ViewerContent
          src={src}
          alt={alt}
          rotation={rotation}
          flipHorizontal={flipHorizontal}
          flipVertical={flipVertical}
          fitMode={fitMode}
          onImageLoaded={handleImageLoaded}
          setTransformFn={setTransformFn}
          imageRef={imageRef}
          onApplyFitMode={handleApplyFitMode}
        />
      </TransformWrapper>

      {/* 加载状态 */}
      {loadingState.loading && (
        <div className="image-loading-minimal">
          <div className="loading-indicator-minimal">
            <div className="loading-ring-minimal"></div>
          </div>
          <span className="loading-text-minimal">Loading</span>
        </div>
      )}

      {/* 错误状态 */}
      {loadingState.error && (
        <div className="image-error-minimal">
          <span className="error-icon-minimal">!</span>
          <span className="error-text-minimal">加载失败</span>
          <button
            onClick={() => setLoadingState(prev => ({ ...prev, loading: true, error: false }))}
            className="retry-btn-minimal"
          >
            重试
          </button>
        </div>
      )}

      {/* 图片信息面板 */}
      {showInfo && !loadingState.loading && !loadingState.error && (
        <div className="image-info-panel-minimal">
          <div className="info-header-minimal">
            <span className="info-title-minimal">Image Info</span>
            <button onClick={() => setShowInfo(false)} className="info-close-minimal">×</button>
          </div>
          <div className="info-content-minimal">
            <div className="info-row-minimal">
              <span className="info-label-minimal">Filename</span>
              <span className="info-value-minimal">{alt}</span>
            </div>
            <div className="info-row-minimal">
              <span className="info-label-minimal">Dimensions</span>
              <span className="info-value-minimal">
                {loadingState.naturalWidth || imageInfo?.width} × {loadingState.naturalHeight || imageInfo?.height}
              </span>
            </div>
            {imageInfo?.fileSize && (
              <div className="info-row-minimal">
                <span className="info-label-minimal">Size</span>
                <span className="info-value-minimal">{formatFileSize(imageInfo.fileSize)}</span>
              </div>
            )}
            {imageInfo?.format && (
              <div className="info-row-minimal">
                <span className="info-label-minimal">Format</span>
                <span className="info-value-minimal">{imageInfo.format.toUpperCase()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部控制栏 */}
      <div className="viewer-controls-minimal">
        <button onClick={handleReset} className="control-btn-minimal">
          Reset
        </button>
        <button onClick={() => handleFitModeChange('fit-window')} className="control-btn-minimal">
          Fit
        </button>
        <button onClick={() => handleFitModeChange('actual-size')} className="control-btn-minimal">
          1:1
        </button>
      </div>
    </div>
  )
}
