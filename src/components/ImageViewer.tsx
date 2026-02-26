import { useState } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import './ImageViewer.css'

interface ImageViewerProps {
  src: string
  alt?: string
  currentIndex?: number
  totalImages?: number
  onPrevious?: () => void
  onNext?: () => void
  onClose?: () => void
}

export function ImageViewer({ 
  src, 
  alt = '图片',
  currentIndex = 0,
  totalImages = 1,
  onPrevious,
  onNext,
  onClose 
}: ImageViewerProps) {
  const [rotation, setRotation] = useState(0)
  const [flipHorizontal, setFlipHorizontal] = useState(false)
  const [flipVertical, setFlipVertical] = useState(false)

  // 重置变换
  const handleReset = (resetTransform: () => void) => {
    setRotation(0)
    setFlipHorizontal(false)
    setFlipVertical(false)
    resetTransform()
  }

  // 旋转
  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360)
  }

  // 水平翻转
  const handleFlipHorizontal = () => {
    setFlipHorizontal(prev => !prev)
  }

  // 垂直翻转
  const handleFlipVertical = () => {
    setFlipVertical(prev => !prev)
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
          <button onClick={handleRotate} className="toolbar-btn" title="旋转 90°">
            ↻
          </button>
          <button onClick={handleFlipHorizontal} className="toolbar-btn" title="水平翻转">
            ↔
          </button>
          <button onClick={handleFlipVertical} className="toolbar-btn" title="垂直翻转">
            ↕
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
      >
        {({ resetTransform }) => (
          <>
            <TransformComponent>
              <div 
                className="image-wrapper"
                style={transformStyle}
              >
                <img 
                  src={src} 
                  alt={alt}
                  className="viewer-image"
                  draggable={false}
                />
              </div>
            </TransformComponent>
            
            {/* 控制按钮 */}
            <div className="viewer-controls">
              <button onClick={() => handleReset(resetTransform)} className="control-btn" title="重置 (R)">
                ⟲ 重置
              </button>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  )
}
