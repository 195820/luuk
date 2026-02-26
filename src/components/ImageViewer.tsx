import { useState, useEffect, useCallback, useRef } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import './ImageViewer.css'

export type FitMode = 'fit-window' | 'actual-size' | 'fit-width' | 'fit-height'

export interface SlideshowSettings {
  enabled: boolean
  interval: number // 秒
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
}

interface LoadingState {
  loading: boolean
  error: boolean
  naturalWidth: number
  naturalHeight: number
}

function ViewerContent({
  src,
  alt,
  rotation,
  flipHorizontal,
  flipVertical,
  fitMode,
  onImageLoaded,
}: {
  src: string
  alt: string
  rotation: number
  flipHorizontal: boolean
  flipVertical: boolean
  fitMode: FitMode
  onImageLoaded: (width: number, height: number) => void
}) {
  const imageRef = useRef<HTMLImageElement>(null)

  const transformStyle = {
    transform: `rotate(${rotation}deg) scaleX(${flipHorizontal ? -1 : 1}) scaleY(${flipVertical ? -1 : 1})`,
    transformOrigin: 'center center',
  }

  // 适应模式处理
  useEffect(() => {
    if (!imageRef.current?.complete) return

    const img = imageRef.current
    const container = document.querySelector('.image-viewer') as HTMLElement
    if (!container) return

    const containerWidth = container.clientWidth - 100
    const containerHeight = container.clientHeight - 100

    let scale = 1
    switch (fitMode) {
      case 'fit-window':
        scale = Math.min(containerWidth / img.naturalWidth, containerHeight / img.naturalHeight)
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

    // 通过自定义事件通知父组件设置缩放
    window.dispatchEvent(new CustomEvent('image-viewer-set-scale', { detail: scale }))
  }, [fitMode, rotation])

  return (
    <TransformComponent>
      <div
        className="image-wrapper"
        style={transformStyle}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          className="viewer-image"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget
            onImageLoaded(img.naturalWidth, img.naturalHeight)
          }}
        />
      </div>
    </TransformComponent>
  )
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
  const wrapperRef = useRef<{ resetTransform: () => void } | null>(null)

  // 重置变换
  const handleReset = useCallback(() => {
    wrapperRef.current?.resetTransform()
    setRotation(0)
    setFlipHorizontal(false)
    setFlipVertical(false)
  }, [])

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

  // 适应模式切换
  const handleFitModeChange = useCallback((mode: FitMode) => {
    setFitMode(mode)
  }, [])

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    // 由 TransformWrapper 处理
  }, [])

  const handleZoomOut = useCallback(() => {
    // 由 TransformWrapper 处理
  }, [])

  // 图片加载完成
  const handleImageLoaded = useCallback((width: number, height: number) => {
    setLoadingState({
      loading: false,
      error: false,
      naturalWidth: width,
      naturalHeight: height,
    })
  }, [])

  // 重置状态当 src 变化
  useEffect(() => {
    setLoadingState({
      loading: true,
      error: false,
      naturalWidth: 0,
      naturalHeight: 0,
    })
  }, [src])

  // 监听全局快捷键事件
  useEffect(() => {
    const handleFitMode = (e: Event) => {
      const detail = (e as CustomEvent<FitMode>).detail
      setFitMode(detail)
    }

    const handleReset = () => {
      setRotation(0)
      setFlipHorizontal(false)
      setFlipVertical(false)
    }

    const handleFlipH = () => {
      setFlipHorizontal(prev => !prev)
    }

    const handleFlipV = () => {
      setFlipVertical(prev => !prev)
    }

    const handleInfo = () => {
      setShowInfo(prev => !prev)
    }

    window.addEventListener('image-viewer-fit', handleFitMode as EventListener)
    window.addEventListener('image-viewer-reset', handleReset)
    window.addEventListener('image-viewer-flip-h', handleFlipH)
    window.addEventListener('image-viewer-flip-v', handleFlipV)
    window.addEventListener('image-viewer-info', handleInfo)

    return () => {
      window.removeEventListener('image-viewer-fit', handleFitMode as EventListener)
      window.removeEventListener('image-viewer-reset', handleReset)
      window.removeEventListener('image-viewer-flip-h', handleFlipH)
      window.removeEventListener('image-viewer-flip-v', handleFlipV)
      window.removeEventListener('image-viewer-info', handleInfo)
    }
  }, [])

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
            ✕
          </button>
        </div>

        <div className="toolbar-group">
          <button
            onClick={onPrevious}
            disabled={currentIndex <= 0}
            className="toolbar-btn"
            title="上一张 (←)"
          >
            ‹
          </button>
          <button
            onClick={onNext}
            disabled={currentIndex >= totalImages - 1}
            className="toolbar-btn"
            title="下一张 (→)"
          >
            ›
          </button>
        </div>

        <div className="toolbar-group">
          <span className="toolbar-info">
            {currentIndex + 1} / {totalImages}
          </span>
        </div>

        <div className="toolbar-group">
          <button onClick={handleRotate} className="toolbar-btn" title="旋转 90° (R)">
            ↻
          </button>
          <button onClick={handleFlipHorizontal} className="toolbar-btn" title="水平翻转 (H)">
            ↔
          </button>
          <button onClick={handleFlipVertical} className="toolbar-btn" title="垂直翻转 (V)">
            ↕
          </button>
        </div>

        <div className="toolbar-group">
          <button
            onClick={() => handleFitModeChange('fit-window')}
            className={`toolbar-btn ${fitMode === 'fit-window' ? 'active' : ''}`}
            title="适应窗口 (0)"
          >
            ⊞
          </button>
          <button
            onClick={() => handleFitModeChange('actual-size')}
            className={`toolbar-btn ${fitMode === 'actual-size' ? 'active' : ''}`}
            title="实际大小 (1)"
          >
            1:1
          </button>
        </div>

        <div className="toolbar-group">
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`toolbar-btn ${showInfo ? 'active' : ''}`}
            title="图片信息 (I)"
          >
            ℹ
          </button>
        </div>
      </div>

      {/* 图片查看区域 */}
      <TransformWrapper
        ref={wrapperRef as any}
        initialScale={1}
        minScale={0.1}
        maxScale={10}
        limitToBounds={false}
        centerOnInit
        wheel={{ step: 0.5 }}
        pinch={{ step: 0.5 }}
        doubleClick={{ step: 1.5 }}
      >
        <ViewerContent
          src={src}
          alt={alt}
          rotation={rotation}
          flipHorizontal={flipHorizontal}
          flipVertical={flipVertical}
          fitMode={fitMode}
          onImageLoaded={handleImageLoaded}
        />
      </TransformWrapper>

      {/* 加载状态 */}
      {loadingState.loading && (
        <div className="image-loading">
          <div className="loading-spinner"></div>
          <span>正在加载图片...</span>
        </div>
      )}

      {/* 错误状态 */}
      {loadingState.error && (
        <div className="image-error">
          <div className="error-icon">⚠</div>
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
            <button onClick={() => setShowInfo(false)} className="close-btn">×</button>
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
          ⟲ 重置
        </button>
        <button onClick={handleZoomOut} className="control-btn" title="缩小 (-)">
          🔍 −
        </button>
        <button onClick={handleZoomIn} className="control-btn" title="放大 (+)">
          🔍 +
        </button>
      </div>
    </div>
  )
}
