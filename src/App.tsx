import { useState, useCallback, useEffect, useRef } from 'react'
import { ImageViewer, type SlideshowSettings } from './components/ImageViewer'
import { ImageGrid } from './components/ImageGrid'
import { FolderTree } from './components/FolderTree'
import { ScanProgress } from './components/ScanProgress'
import type { ImageGridItem } from './components/ImageGrid'
import { useImageStore } from './stores/imageStore'
import type { Library } from './types'
import './App.css'

const SLIDESHOW_INTERVALS = [3, 5, 10, 30]

function App() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewMode, setViewMode] = useState<'grid' | 'viewer'>('grid')
  const [thumbnailSize, setThumbnailSize] = useState(200)
  const [slideshow, setSlideshow] = useState<SlideshowSettings>({ enabled: false, interval: 5 })
  const [selectedInterval, setSelectedInterval] = useState(5)
  const gridScrollRef = useRef<number>(0)
  const slideshowTimerRef = useRef<NodeJS.Timeout | null>(null)

  const {
    libraries,
    currentLibraryId,
    images,
    totalImages,
    currentImage,
    isLoading,
    error,
    initialize,
    loadLibraries,
    addLibrary,
    removeLibrary,
    setCurrentLibrary,
    scanLibrary,
    loadImages,
    loadFolderTree,
    setCurrentImage,
    folderTree,
    selectedFolder,
    setSelectedFolder,
    toggleFolderSidebar,
    folderSidebarOpen,
  } = useImageStore()

  const [showLibraryPanel, setShowLibraryPanel] = useState(false)
  const [currentImagePath, setCurrentImagePath] = useState<string>('')

  // 初始化服务
  useEffect(() => {
    const init = async () => {
      await initialize()
      await loadLibraries()
    }
    init()
  }, [])

  // 加载当前库的图片
  useEffect(() => {
    if (currentLibraryId) {
      loadImages()
    }
  }, [currentLibraryId])

  // 将数据库图片转换为 Grid 需要的格式
  const gridImages: ImageGridItem[] = images.map((img: any) => ({
    id: img.id,
    src: '', // 缩略图在 ImageGridItem 内部加载
    alt: img.relative_path.split('/').pop() || img.relative_path,
    width: img.width,
    height: img.height,
    fileSize: img.file_size,
    format: img.format.toLowerCase(),
  }))

  // 处理文件夹选择
  const handleFolderSelect = useCallback((folderPath: string | null) => {
    // 如果当前在查看器模式，切换到网格视图
    if (viewMode === 'viewer') {
      setViewMode('grid')
    }
    setSelectedFolder(folderPath)
  }, [setSelectedFolder, viewMode])

  const handlePrevious = useCallback(() => {
    setCurrentIndex(prev => Math.max(0, prev - 1))
  }, [])

  const handleNext = useCallback(() => {
    setCurrentIndex(prev => {
      if (prev >= images.length - 1) return 0
      return prev + 1
    })
  }, [images.length])

  const handleFirst = useCallback(() => {
    setCurrentIndex(0)
  }, [])

  const handleLast = useCallback(() => {
    setCurrentIndex(images.length - 1)
  }, [images.length])

  // 当 currentIndex 变化时，更新 currentImage
  useEffect(() => {
    if (viewMode === 'viewer' && images.length > 0) {
      const img = images[currentIndex]
      if (img) {
        setCurrentImage(img)
      }
    }
  }, [currentIndex, images, viewMode])

  const handleImageClick = (image: ImageGridItem) => {
    const img = images.find((i: any) => i.id === image.id)
    if (img) {
      setCurrentImage(img)
      setCurrentIndex(images.findIndex((i: any) => i.id === image.id))
    }
  }

  const handleImageDoubleClick = (image: ImageGridItem) => {
    const img = images.find((i: any) => i.id === image.id)
    if (img) {
      setCurrentImage(img)
      setCurrentIndex(images.findIndex((i: any) => i.id === image.id))
      setViewMode('viewer')
    }
  }

  const handleClose = useCallback(() => {
    setViewMode('grid')
    setSlideshow(prev => ({ ...prev, enabled: false }))
  }, [])

  const toggleSlideshow = useCallback(() => {
    setSlideshow(prev => ({ ...prev, enabled: !prev.enabled }))
  }, [])

  const changeSlideshowInterval = useCallback((interval: number) => {
    setSlideshow(prev => ({ ...prev, interval }))
    setSelectedInterval(interval)
  }, [])

  // 幻灯片定时器
  useEffect(() => {
    if (slideshow.enabled && viewMode === 'viewer') {
      slideshowTimerRef.current = setInterval(() => {
        handleNext()
      }, slideshow.interval * 1000)
    } else {
      if (slideshowTimerRef.current) {
        clearInterval(slideshowTimerRef.current)
      }
    }

    return () => {
      if (slideshowTimerRef.current) {
        clearInterval(slideshowTimerRef.current)
      }
    }
  }, [slideshow.enabled, slideshow.interval, viewMode, handleNext])

  // 添加库
  const handleAddLibrary = async () => {
    try {
      if (!(window as any).electronAPI?.selectFolder) {
        throw new Error('electronAPI.selectFolder 不可用')
      }
      const folderPath = await (window as any).electronAPI.selectFolder()
      if (!folderPath) return

      const folderName = folderPath.split(/[/\\]/).pop() || '未命名库'
      const library = await addLibrary(folderName, folderPath, true)
      setShowLibraryPanel(false)

      setCurrentLibrary(library.id)

      const checkScanComplete = async () => {
        for (let i = 0; i < 600; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000))

          await loadLibraries()

          const currentLibs = useImageStore.getState().libraries
          const updatedLib = currentLibs.find(l => l.id === library.id)

          if (updatedLib && updatedLib.image_count > 0) {
            const state = useImageStore.getState()
            if (state.currentLibraryId !== library.id) {
              setCurrentLibrary(library.id)
              await new Promise(resolve => setTimeout(resolve, 500))
            }

            try {
              const currentState = useImageStore.getState()

              if (!currentState.currentLibraryId) {
                setCurrentLibrary(library.id)
                await new Promise(resolve => setTimeout(resolve, 500))
              }

              await loadFolderTree()
              const treeState = useImageStore.getState().folderTree

              await loadImages()
              const imagesState = useImageStore.getState().images

              if (imagesState.length === 0 && treeState.length === 0) {
                setCurrentLibrary(null)
                await new Promise(resolve => setTimeout(resolve, 100))
                setCurrentLibrary(library.id)
                await new Promise(resolve => setTimeout(resolve, 500))
                await loadFolderTree()
                await loadImages()
              }

              await loadLibraries()

            } catch (err) {
              console.error('[App] 加载数据失败:', err)
            }

            break
          }
        }
      }

      checkScanComplete()
      
    } catch (error: any) {
      if (error?.message?.includes('UNIQUE constraint failed') || error?.message?.includes('库已存在')) {
        alert('该文件夹已经被添加过了，无需重复添加！')
      } else if (error?.message?.includes('子文件夹')) {
        alert(error.message)
      } else if (error?.message?.includes('包含已存在的库')) {
        alert(error.message)
      } else {
        console.error('添加库失败:', error)
        alert('添加库失败：' + (error?.message || '未知错误'))
      }
    }
  }

  // 删除库
  const handleRemoveLibrary = async (lib: Library) => {
    if (!confirm(`确定要删除库 "${lib.name}" 吗？`)) {
      return
    }
    await removeLibrary(lib.id)
  }

  // 扫描库
  const handleScanLibrary = async (libId: number) => {
    try {
      await scanLibrary(libId)
      // 扫描成功后刷新库列表
      await loadLibraries()
    } catch (error: any) {
      console.error('扫描库失败:', error)
      // 即使是错误，也刷新库列表（因为状态可能已更新为离线）
      await loadLibraries()
      // 显示错误提示
      alert(`扫描失败：${error.message}`)
    }
  }

  const getCurrentImageInfo = () => {
    if (!currentImage) return null
    return {
      width: currentImage.width,
      height: currentImage.height,
      fileSize: currentImage.file_size,
      format: currentImage.format,
    }
  }

  // 加载当前图片路径
  useEffect(() => {
    if (currentImage && currentLibraryId) {
      getCurrentImagePath().then(setCurrentImagePath).catch(err => {
        console.error('获取图片路径失败:', err)
        setCurrentImagePath('')
      })
    } else {
      setCurrentImagePath('')
    }
  }, [currentImage, currentLibraryId])

  const getCurrentImagePath = async () => {
    if (!currentLibraryId || !currentImage) return ''
    try {
      return await (window as any).electronAPI.getImagePath(currentLibraryId, currentImage.id)
    } catch (error) {
      console.error('获取图片路径失败:', error)
      return ''
    }
  }

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault()
        setViewMode(prev => prev === 'grid' ? 'viewer' : 'grid')
        return
      }

      if (e.key === 'F6') {
        e.preventDefault()
        toggleFolderSidebar()
        return
      }

      if (viewMode === 'viewer') {
        // 方向键由 ImageViewer 组件内部处理
        if (e.key === 'Escape') handleClose()

        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault()
          toggleSlideshow()
        }

        // Home/End/R 由父组件处理
        if (e.key === 'Home') {
          e.preventDefault()
          handleFirst()
        }
        if (e.key === 'End') {
          e.preventDefault()
          handleLast()
        }
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('image-viewer-reset'))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, handleClose, toggleSlideshow, toggleFolderSidebar, handleFirst, handleLast])

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>📷 图片查看器</h1>
        <div className="header-actions">
          <button onClick={toggleFolderSidebar} className="folder-toggle-btn" title="切换文件夹面板 (F6)">
            📁
          </button>
          <div className="library-selector">
            <select
              value={currentLibraryId || ''}
              onChange={(e) => setCurrentLibrary(e.target.value ? Number(e.target.value) : null)}
              disabled={libraries.length === 0}
            >
              <option value="">选择库...</option>
              {libraries.map(lib => (
                <option key={lib.id} value={lib.id}>
                  {lib.name} ({lib.status === 'online' ? '🟢 在线' : '🔴 离线'}) - {lib.image_count} 张
                </option>
              ))}
            </select>
            <button onClick={() => setShowLibraryPanel(!showLibraryPanel)} className="library-btn">
              📁 管理
            </button>
          </div>

          <span className="image-count">
            {currentLibraryId ? `${totalImages} 张图片` : '请先选择或添加库'}
          </span>

          {viewMode === 'grid' && currentLibraryId && (
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
            disabled={!currentLibraryId || images.length === 0}
          >
            {viewMode === 'grid' ? '▶ 查看' : '▦ 网格'}
          </button>
        </div>
      </header>

      <div className="app-body">
        {/* 左侧文件夹边栏 */}
        {folderSidebarOpen && currentLibraryId && (
          <aside className="folder-sidebar">
            <div className="folder-sidebar-header">
              <span>📂 文件夹</span>
              <button onClick={toggleFolderSidebar} className="close-sidebar-btn">×</button>
            </div>
            <div className="folder-sidebar-content">
              <FolderTree
                folders={folderTree}
                selectedFolder={selectedFolder}
                onFolderSelect={handleFolderSelect}
              />
            </div>
          </aside>
        )}

        {/* 主内容区域 */}
        <main className={`app-main ${folderSidebarOpen ? 'with-sidebar' : ''}`}>
          {isLoading && !currentImage && (
            <div className="global-loading">
              <div className="loading-spinner"></div>
              <span>加载中...</span>
            </div>
          )}

          {error && (
            <div className="global-error">
              <span className="error-icon">⚠</span>
              <span>{error}</span>
            </div>
          )}

          {!currentLibraryId ? (
            <div className="no-library-hint">
              <h2>📁 请先添加或选择一个图片库</h2>
              <p>点击左上角的"管理"按钮添加包含图片的文件夹</p>
              <button onClick={handleAddLibrary} className="add-library-btn-large">
                + 添加库
              </button>
            </div>
          ) : images.length === 0 && !isLoading ? (
            <div className="no-images-hint">
              <h2>📷 这个{selectedFolder ? `"${selectedFolder.split('/').pop()}"` : '库'}还没有图片</h2>
              <p>点击"扫描"按钮来索引图片文件夹</p>
              <button onClick={() => currentLibraryId && handleScanLibrary(currentLibraryId)} className="scan-btn-large">
                🔄 扫描图片
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <ImageGrid
              key={`${currentLibraryId}-${selectedFolder || 'all'}`}
              images={gridImages}
              selectedId={currentImage?.id}
              onImageClick={handleImageClick}
              onImageDoubleClick={handleImageDoubleClick}
              thumbnailSize={thumbnailSize}
              scrollPosition={gridScrollRef.current}
              onScrollChange={(pos) => { gridScrollRef.current = pos }}
              libraryId={currentLibraryId!}
            />
          ) : currentImage ? (
            <ImageViewer
              src={`file://${currentImagePath}`}
              alt={currentImage.relative_path.split('/').pop() || ''}
              currentIndex={currentIndex}
              totalImages={images.length}
              onPrevious={handlePrevious}
              onNext={handleNext}
              onClose={handleClose}
              imageInfo={getCurrentImageInfo() || undefined}
              slideshowSettings={slideshow}
              onSlideshowChange={(enabled) => setSlideshow(prev => ({ ...prev, enabled }))}
            />
          ) : null}
        </main>
      </div>

      {showLibraryPanel && (
        <div className="library-panel">
          <div className="library-panel-header">
            <h3>📁 库管理</h3>
            <button onClick={() => setShowLibraryPanel(false)} className="close-btn">×</button>
          </div>
          <div className="library-panel-content">
            <button onClick={handleAddLibrary} className="add-library-btn">
              + 添加库
            </button>
            {libraries.length === 0 ? (
              <p className="empty-hint">暂无库，点击"添加库"选择图片文件夹</p>
            ) : (
              <ul className="library-list">
                {libraries.map(lib => (
                  <li key={lib.id} className={`library-item ${lib.id === currentLibraryId ? 'active' : ''}`}>
                    <div className="library-item-info">
                      <strong>{lib.name}</strong>
                      <span className="library-path">{lib.root_path}</span>
                      <span className="library-status">
                        状态：{lib.status === 'online' ? '🟢 在线' : '🔴 离线'} | {lib.image_count} 张
                      </span>
                    </div>
                    <div className="library-item-actions">
                      <button onClick={() => handleScanLibrary(lib.id)} className="scan-btn">
                        🔄 扫描
                      </button>
                      <button onClick={() => handleRemoveLibrary(lib)} className="remove-btn">
                        🗑 删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {viewMode === 'viewer' && slideshow.enabled && (
        <div className="slideshow-bar">
          <span>🎬 幻灯片播放中</span>
          <div className="slideshow-controls">
            <span>间隔:</span>
            <select
              value={selectedInterval}
              onChange={(e) => changeSlideshowInterval(Number(e.target.value))}
            >
              {SLIDESHOW_INTERVALS.map(interval => (
                <option key={interval} value={interval}>{interval}秒</option>
              ))}
            </select>
            <button onClick={toggleSlideshow} className="slideshow-stop-btn">
              ⏸ 暂停
            </button>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <span>←/→: 上一张/下一张</span>
        <span>Home/End: 第一张/最后一张</span>
        <span>0: 适应窗口</span>
        <span>1: 实际大小</span>
        <span>R: 重置</span>
        <span>H/V: 翻转</span>
        <span>I: 信息</span>
        <span>Space: 幻灯片</span>
        <span>Esc: 关闭</span>
        <span>F5: 切换视图</span>
        <span>F6: 文件夹面板</span>
      </footer>

      {/* 扫描进度条 */}
      <ScanProgress />
    </div>
  )
}

export default App
