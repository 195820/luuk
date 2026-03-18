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
  // 收藏相关
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

  // 应用缩放
  const applyScale = useCallback((scale: number) => {
    if (setTransformFn.current) {
      requestAnimationFrame(() => {
        setTransformFn.current?.(scale)
      })
    }
  }, [setTransformFn])

  // 适应模式处理
  useEffect(() => {
    const img = imageRef.current
    if (!img?.complete || !img.naturalWidth) {
      return
    }

    const container = document.querySelector('.image-viewer') as HTMLElement
    if (!container) return

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight

    let scale = 1
    switch (fitMode) {
      case 'fit-window':
        // 移除 1 的限制，让图片可以放大以填满窗口
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

    applyScale(scale)
  }, [fitMode, rotation, applyScale, src])

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
            const width = img.naturalWidth
            const height = img.naturalHeight
            onImageLoaded(width, height)
            // 图片加载完成后，应用适应窗口
            const container = document.querySelector('.image-viewer') as HTMLElement
            if (container && fitMode === 'fit-window') {
              const containerWidth = container.clientWidth
              const containerHeight = container.clientHeight
              // 移除 1 的限制，让图片可以放大以填满窗口
              const scale = Math.min(containerWidth / width, containerHeight / height)
              onApplyFitMode(scale)
            }
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
  const imageRef = useRef<HTMLImageElement>(null)

  // 存储 setTransform 函数
  const setTransformFn = useRef<((scale: number) => void) | null>(null)

  // 计算适应窗口的缩放比例
  const calculateFitWindowScale = useCallback((): number => {
    const img = imageRef.current
    const container = document.querySelector('.image-viewer') as HTMLElement
    if (!img?.complete || !img.naturalWidth || !container) return 1

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    // 移除 1 的限制，让图片可以放大以填满窗口
    return Math.min(containerWidth / img.naturalWidth, containerHeight / img.naturalHeight)
  }, [])

  // 重置变换 - 使用适应窗口模式
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

  // 处理适应模式应用
  const handleApplyFitMode = useCallback((scale: number) => {
    if (setTransformFn.current) {
      setTransformFn.current(scale)
    }
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
      // 避免在输入框中触发
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case '0':
          // 适应窗口
          setFitMode('fit-window')
          break
        case '1':
          // 实际大小
          setFitMode('actual-size')
          break
        case 'h':
        case 'H':
          // 水平翻转
          setFlipHorizontal(prev => !prev)
          break
        case 'v':
        case 'V':
          // 垂直翻转
          setFlipVertical(prev => !prev)
          break
        case 'i':
        case 'I':
          // 显示信息
          setShowInfo(prev => !prev)
          break
        case 'Escape':
          // 关闭查看器
          onClose?.()
          break
        case 'ArrowLeft':
          // 上一张
          onPrevious?.()
          break
        case 'ArrowRight':
          // 下一张
          onNext?.()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, onPrevious, onNext])

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
            // 存储 setTransform 函数
            setTransformFn.current = (scale: number) => {
              // 使用 centerView 方法居中并缩放
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
