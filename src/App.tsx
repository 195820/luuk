import { useState, useCallback } from 'react'
import { ImageViewer } from './components/ImageViewer'
import { ImageGrid } from './components/ImageGrid'
import './App.css'

// 模拟图片列表
const IMAGES = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  src: `https://picsum.photos/seed/${i + 1}/800/600`,
  alt: `图片 ${i + 1}`,
}))

function App() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewMode, setViewMode] = useState<'grid' | 'viewer'>('grid')

  const handlePrevious = useCallback(() => {
    setCurrentIndex(prev => Math.max(0, prev - 1))
  }, [])

  const handleNext = useCallback(() => {
    setCurrentIndex(prev => Math.min(IMAGES.length - 1, prev + 1))
  }, [])

  const handleImageClick = (image: typeof IMAGES[0]) => {
    setCurrentIndex(image.id - 1)
  }

  const handleImageDoubleClick = (image: typeof IMAGES[0]) => {
    setCurrentIndex(image.id - 1)
    setViewMode('viewer')
  }

  const handleClose = useCallback(() => {
    setViewMode('grid')
  }, [])

  // 键盘导航
  useCallback(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode === 'viewer') {
        if (e.key === 'ArrowLeft') handlePrevious()
        if (e.key === 'ArrowRight') handleNext()
        if (e.key === 'Escape') handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, handlePrevious, handleNext, handleClose])

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>📷 图片查看器</h1>
        <div className="header-actions">
          <span className="image-count">{IMAGES.length} 张图片</span>
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
            thumbnailSize={200}
          />
        ) : (
          <ImageViewer 
            src={IMAGES[currentIndex].src.replace('800/600', '1920/1080')}
            alt={IMAGES[currentIndex].alt}
            currentIndex={currentIndex}
            totalImages={IMAGES.length}
            onPrevious={handlePrevious}
            onNext={handleNext}
            onClose={handleClose}
          />
        )}
      </main>
    </div>
  )
}

export default App
