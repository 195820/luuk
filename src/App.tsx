import { useState, useCallback, useEffect, useRef } from 'react'
import { ImageViewer } from './components/ImageViewer'
import { ImageGrid } from './components/ImageGrid'
import type { ImageGridItem } from './components/ImageGrid'
import './App.css'

// 模拟图片列表（带详细信息）
const IMAGES = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  src: `https://picsum.photos/seed/${i + 1}/1920/1080`,
  alt: `图片 ${i + 1}`,
  width: 1920,
  height: 1080,
  fileSize: 2 * 1024 * 1024 + i * 10240, // 模拟 2MB+ 文件大小
  format: 'jpg',
}))

function App() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewMode, setViewMode] = useState<'grid' | 'viewer'>('grid')
  const [thumbnailSize, setThumbnailSize] = useState(200)
  const gridScrollRef = useRef<number>(0)

  const handlePrevious = useCallback(() => {
    setCurrentIndex(prev => Math.max(0, prev - 1))
  }, [])

  const handleNext = useCallback(() => {
    setCurrentIndex(prev => Math.min(IMAGES.length - 1, prev + 1))
  }, [])

  const handleFirst = useCallback(() => {
    setCurrentIndex(0)
  }, [])

  const handleLast = useCallback(() => {
    setCurrentIndex(IMAGES.length - 1)
  }, [])

  const handleImageClick = (image: ImageGridItem) => {
    setCurrentIndex(image.id - 1)
  }

  const handleImageDoubleClick = (image: ImageGridItem) => {
    setCurrentIndex(image.id - 1)
    setViewMode('viewer')
  }

  const handleClose = useCallback(() => {
    setViewMode('grid')
  }, [])

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 全局快捷键（任何模式都有效）
      if (e.key === 'F5') {
        e.preventDefault()
        setViewMode(prev => prev === 'grid' ? 'viewer' : 'grid')
        return
      }

      if (viewMode === 'viewer') {
        // 导航键
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') handlePrevious()
        if (e.key === 'ArrowRight' || e.key === 'PageDown') handleNext()
        if (e.key === 'Home') handleFirst()
        if (e.key === 'End') handleLast()
        if (e.key === 'Escape') handleClose()

        // 视图控制
        if (e.key === '0') {
          e.preventDefault()
          // 适应窗口 - 通过自定义事件通知 ImageViewer
          window.dispatchEvent(new CustomEvent('image-viewer-fit', { detail: 'fit-window' }))
        }
        if (e.key === '1') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('image-viewer-fit', { detail: 'actual-size' }))
        }

        // 图片操作
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('image-viewer-reset'))
        }
        if (e.key === 'h' || e.key === 'H') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('image-viewer-flip-h'))
        }
        if (e.key === 'v' || e.key === 'V') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('image-viewer-flip-v'))
        }
        if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('image-viewer-zoom', { detail: 'in' }))
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('image-viewer-zoom', { detail: 'out' }))
        }

        // 信息显示
        if (e.key === 'i' || e.key === 'I') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('image-viewer-info'))
        }
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault()
          // 收藏功能（待实现）
          console.log('收藏当前图片:', currentIndex)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, handlePrevious, handleNext, handleFirst, handleLast, handleClose, currentIndex])

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>📷 图片查看器</h1>
        <div className="header-actions">
          <span className="image-count">{IMAGES.length} 张图片</span>
          
          {/* 缩略图尺寸调节 */}
          {viewMode === 'grid' && (
            <div className="thumbnail-size-control">
              <label htmlFor="thumbnail-size">缩略图:</label>
              <input
                id="thumbnail-size"
                type="range"
                min="80"
                max="400"
                step="20"
                value={thumbnailSize}
                onChange={(e) => setThumbnailSize(Number(e.target.value))}
              />
              <span>{thumbnailSize}px</span>
            </div>
          )}
          
          <button
            onClick={() => setViewMode(viewMode === 'grid' ? 'viewer' : 'grid')}
            className="view-toggle-btn"
          >
            {viewMode === 'grid' ? '▶ 查看' : '▦ 网格'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {viewMode === 'grid' ? (
          <ImageGrid
            images={IMAGES}
            selectedId={IMAGES[currentIndex]?.id}
            onImageClick={handleImageClick}
            onImageDoubleClick={handleImageDoubleClick}
            thumbnailSize={thumbnailSize}
            scrollPosition={gridScrollRef.current}
            onScrollChange={(pos) => { gridScrollRef.current = pos }}
          />
        ) : (
          <ImageViewer
            src={IMAGES[currentIndex].src}
            alt={IMAGES[currentIndex].alt}
            currentIndex={currentIndex}
            totalImages={IMAGES.length}
            onPrevious={handlePrevious}
            onNext={handleNext}
            onClose={handleClose}
            imageInfo={{
              width: IMAGES[currentIndex].width,
              height: IMAGES[currentIndex].height,
              fileSize: IMAGES[currentIndex].fileSize,
              format: IMAGES[currentIndex].format,
            }}
          />
        )}
      </main>

      {/* 快捷键提示 */}
      <footer className="app-footer">
        <span>←/→: 上一张/下一张</span>
        <span>Home/End: 第一张/最后一张</span>
        <span>0: 适应窗口</span>
        <span>1: 实际大小</span>
        <span>R: 重置</span>
        <span>H/V: 翻转</span>
        <span>I: 信息</span>
        <span>Esc: 关闭</span>
      </footer>
    </div>
  )
}

export default App
