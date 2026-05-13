import { useState, useCallback, useEffect, useRef } from 'react'
import { ImageViewer, type SlideshowSettings } from './components/ImageViewer'
import { ImageGrid } from './components/ImageGrid'
import { MasonryGrid } from './components/MasonryGrid'
import { FolderTree } from './components/FolderTree'
import { ScanProgress } from './components/ScanProgress'
import { SortControl } from './components/SortControl'
import type { ImageGridItem } from './components/ImageGrid'
import { useImageStore, FAVORITE_LIBRARY_ID } from './stores/imageStore'
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
    loadFavorites,
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
    toggleFavorite,
    favoriteCount,
    favoriteImages,
    loadFavoriteImages,
    loadFavoriteFolderImages,
    isFavorite,
    favoriteFolderTree,
    loadFavoriteFolderTree,
    toggleFavoriteFolder,
    setSelectedFavoriteFolder,
    singleFavoriteImages,
    loadSingleFavoriteImages,
    favoriteViewMode,
    imageSortBy,
    imageSortOrder,
    setSortBy,
    setSortOrder,
    gridLayoutMode,
    setGridLayoutMode,
  } = useImageStore()

  const [showLibraryPanel, setShowLibraryPanel] = useState(false)
  const [currentImagePath, setCurrentImagePath] = useState<string>('')
  const [favoriteImageIndex, setFavoriteImageIndex] = useState(0)

  // 初始化服务
  useEffect(() => {
    const init = async () => {
      await initialize()
      await loadLibraries()
      await loadFavorites() // 加载收藏列表
      // 启动时默认进入收藏库
      setCurrentLibrary(FAVORITE_LIBRARY_ID)
      await loadFavoriteImages()
      await loadFavoriteFolderTree() // 加载收藏文件夹树
      // 收藏库不需要加载文件夹树
      useImageStore.setState({ folderTree: [], selectedFolder: null })
    }
    init()
  }, [])

  // 加载当前库的图片
  useEffect(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 根据视图模式加载不同的图片
      if (favoriteViewMode === 'single') {
        loadSingleFavoriteImages()
      } else {
        // 'folder' 或 'all' 模式加载所有收藏图片
        loadFavoriteImages()
      }
      // 视图模式切换时重置索引为 0
      setFavoriteImageIndex(0)
    } else if (currentLibraryId) {
      loadImages()
    }
  }, [currentLibraryId, favoriteViewMode])

  // 将数据库图片转换为 Grid 需要的格式
  const gridImages: ImageGridItem[] = images.map((img: any) => ({
    id: img.id,
    src: '', // 缩略图在 ImageGridItem 内部加载
    alt: img.relative_path.split('/').pop() || img.relative_path,
    width: img.width,
    height: img.height,
    fileSize: img.file_size,
    format: img.format.toLowerCase(),
    isFavorite: isFavorite(currentLibraryId || 0, img.relative_path),
  }))

  // 收藏库图片
  // - 单图收藏模式：显示单图收藏列表，isFavorite = true
  // - 文件夹收藏模式：显示文件夹收藏中的图片，isFavorite = 该图片是否也在单图收藏中
  const favoriteGridImages: ImageGridItem[] = (favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages || []).map((fav: any) => ({
    id: `${fav.library_id}-${fav.relative_path || ''}`,
    src: '',
    alt: (fav.relative_path || '').split('/').pop() || (fav.relative_path || ''),
    width: fav.width || 0,
    height: fav.height || 0,
    fileSize: fav.file_size || 0,
    format: (fav.format || '').toLowerCase(),
    // 单图收藏模式下都是已收藏，文件夹收藏模式下检查是否也在单图收藏中
    isFavorite: favoriteViewMode === 'single' ? true : isFavorite(fav.library_id, fav.relative_path),
    libraryId: fav.library_id,
    imagePath: fav.relative_path, // 使用 relative_path 字段
  }))

  // 处理文件夹选择
  const handleFolderSelect = useCallback((folderPath: string | null) => {
    // 如果当前在查看器模式，切换到网格视图
    if (viewMode === 'viewer') {
      setViewMode('grid')
    }

    // 在收藏库中选中文件夹时，加载该文件夹下的收藏图片
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      if (folderPath) {
        loadFavoriteFolderImages(folderPath)
      } else {
        // 选中"全部图片"时，加载所有收藏图片
        loadFavoriteImages()
      }
      setSelectedFavoriteFolder(folderPath)
    } else {
      setSelectedFolder(folderPath)
    }
  }, [viewMode, currentLibraryId, loadFavoriteFolderImages, loadFavoriteImages, setSelectedFavoriteFolder, setSelectedFolder])

  // 切换到单图收藏视图（从文件夹收藏标签页切换）
  const handleSwitchToSingleView = useCallback(() => {
    // 如果当前在查看器模式，切换到网格视图
    if (viewMode === 'viewer') {
      setViewMode('grid')
    }
  }, [viewMode])

  const handlePrevious = useCallback(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      setFavoriteImageIndex(prev => Math.max(0, prev - 1))
    } else {
      setCurrentIndex(prev => Math.max(0, prev - 1))
    }
  }, [currentLibraryId, favoriteViewMode, singleFavoriteImages.length, favoriteImages.length])

  const handleNext = useCallback(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 根据视图模式使用正确的数组长度
      const currentArray = favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages
      setFavoriteImageIndex(prev => {
        if (prev >= currentArray.length - 1) return 0
        return prev + 1
      })
    } else {
      setCurrentIndex(prev => {
        if (prev >= images.length - 1) return 0
        return prev + 1
      })
    }
  }, [currentLibraryId, images.length, favoriteViewMode, singleFavoriteImages.length, favoriteImages.length])

  const handleFirst = useCallback(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      setFavoriteImageIndex(0)
    } else {
      setCurrentIndex(0)
    }
  }, [currentLibraryId, favoriteViewMode, singleFavoriteImages.length, favoriteImages.length])

  const handleLast = useCallback(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 根据视图模式使用正确的数组
      const targetArray = favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages
      setFavoriteImageIndex(targetArray.length - 1)
    } else {
      setCurrentIndex(images.length - 1)
    }
  }, [currentLibraryId, images.length, favoriteViewMode, singleFavoriteImages.length, favoriteImages.length])

  // 当 currentIndex 变化时，更新 currentImage
  useEffect(() => {
    if (viewMode === 'viewer') {
      if (currentLibraryId === FAVORITE_LIBRARY_ID) {
        // 根据视图模式使用正确的数组
        const targetArray = favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages
        const fav = targetArray[favoriteImageIndex]
        if (fav) {
          setCurrentImage(fav as any)
        }
      } else if (images.length > 0) {
        const img = images[currentIndex]
        if (img) {
          setCurrentImage(img)
        }
      }
    }
  }, [currentIndex, favoriteImageIndex, images, favoriteImages, singleFavoriteImages, favoriteViewMode, viewMode, currentLibraryId])

  const handleImageClick = (image: ImageGridItem) => {
    // 单击只选中图片，不进入查看器
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 根据视图模式使用正确的数组
      const targetArray = favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages

      // 使用 image.imagePath 和 image.libraryId 来查找索引，避免依赖重新创建的数组
      const index = targetArray.findIndex((fav: any) => {
        return fav.relative_path === image.imagePath && fav.library_id === image.libraryId
      })

      if (index >= 0) {
        setFavoriteImageIndex(index)
      }
    } else {
      const img = images.find((i: any) => i.id === image.id)
      if (img) {
        setCurrentIndex(images.findIndex((i: any) => i.id === image.id))
      }
    }
  }

  const handleImageDoubleClick = (image: ImageGridItem) => {
    // 双击进入查看器
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 根据视图模式使用正确的数组
      const targetArray = favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages

      // 使用 image.imagePath 和 image.libraryId 来查找索引，避免依赖重新创建的数组
      const index = targetArray.findIndex((fav: any) => {
        return fav.relative_path === image.imagePath && fav.library_id === image.libraryId
      })

      if (index >= 0) {
        setFavoriteImageIndex(index)
        setCurrentImage(targetArray[index] as any)
        setViewMode('viewer')
      }
    } else {
      const img = images.find((i: any) => i.id === image.id)
      if (img) {
        setCurrentImage(img)
        setCurrentIndex(images.findIndex((i: any) => i.id === image.id))
        setViewMode('viewer')
      }
    }
  }

  const handleClose = useCallback(() => {
    setViewMode('grid')
    setCurrentImage(null)
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
        if (currentLibraryId === FAVORITE_LIBRARY_ID) {
          handleNext()
        } else {
          handleNext()
        }
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
  }, [slideshow.enabled, slideshow.interval, viewMode, handleNext, currentLibraryId])

  // 切换收藏状态
  const handleToggleFavorite = useCallback(async () => {
    if (!currentLibraryId) return

    // 在收藏库中，使用当前图片的 libraryId 和 imagePath
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      const currentFavImage = favoriteImages[favoriteImageIndex]
      if (!currentFavImage) return

      const libraryId = currentFavImage.library_id
      const imagePath = currentFavImage.relative_path

      try {
        const result = await toggleFavorite(libraryId, imagePath)
        // 如果取消了收藏，刷新收藏库
        if (!result) {
          await loadFavoriteImages()
          // 如果索引超出范围，重置为 0
          if (favoriteImageIndex >= favoriteImages.length - 1) {
            setFavoriteImageIndex(Math.max(0, favoriteImages.length - 2))
          }
        }
      } catch (error) {
        console.error('[App] 切换收藏失败:', error)
      }
      return
    }

    // 普通库模式
    if (images.length === 0) return

    const currentImage = images[currentIndex]
    if (!currentImage) return

    const imagePath = currentImage.relative_path
    try {
      const result = await toggleFavorite(currentLibraryId, imagePath)
      // 如果取消了收藏，且当前在收藏库视图中，需要刷新
      if (!result) {
        await loadFavoriteImages()
      }
    } catch (error) {
      console.error('[App] 切换收藏失败:', error)
    }
  }, [currentLibraryId, images, currentIndex, favoriteImages, favoriteImageIndex, toggleFavorite, loadFavoriteImages])

  // 处理网格中图片的收藏切换
  const handleGridToggleFavorite = useCallback(async (image: ImageGridItem) => {
    // 收藏库中使用图片原始的 libraryId 和 imagePath
    const libraryId = image.libraryId || currentLibraryId
    const imagePath = image.imagePath || image.alt

    if (!libraryId) return

    try {
      await toggleFavorite(libraryId, imagePath)
      // 只在单图收藏模式下刷新，确保取消收藏后图标更新
      if (currentLibraryId === FAVORITE_LIBRARY_ID && favoriteViewMode === 'single') {
        await loadSingleFavoriteImages()
      }
    } catch (error) {
      console.error('[App] 切换收藏失败:', error)
    }
  }, [currentLibraryId, favoriteViewMode, toggleFavorite, loadSingleFavoriteImages])

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
        let attempts = 0
        const maxAttempts = 60
        let delay = 500 // 初始延迟 500ms

        while (attempts < maxAttempts) {
          attempts++
          await new Promise(resolve => setTimeout(resolve, delay))

          // 指数退避：每次延迟增加 1.5 倍，最大 3000ms
          delay = Math.min(delay * 1.5, 3000)

          await loadLibraries()

          const currentLibs = useImageStore.getState().libraries
          const updatedLib = currentLibs.find(l => l.id === library.id)

          if (updatedLib && updatedLib.image_count > 0) {
            const state = useImageStore.getState()
            if (state.currentLibraryId !== library.id) {
              setCurrentLibrary(library.id)
              await new Promise(resolve => setTimeout(resolve, 300))
            }

            try {
              const currentState = useImageStore.getState()

              if (!currentState.currentLibraryId) {
                setCurrentLibrary(library.id)
                await new Promise(resolve => setTimeout(resolve, 300))
              }

              await loadFolderTree()
              const treeState = useImageStore.getState().folderTree

              await loadImages()
              const imagesState = useImageStore.getState().images

              if (imagesState.length === 0 && treeState.length === 0) {
                setCurrentLibrary(null)
                await new Promise(resolve => setTimeout(resolve, 100))
                setCurrentLibrary(library.id)
                await new Promise(resolve => setTimeout(resolve, 300))
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
    if (currentImage && currentLibraryId && currentLibraryId !== FAVORITE_LIBRARY_ID) {
      getCurrentImagePath().then(setCurrentImagePath).catch(err => {
        console.error('获取图片路径失败:', err)
        setCurrentImagePath('')
      })
    } else if (currentImage && currentLibraryId === FAVORITE_LIBRARY_ID) {
      // 收藏库中的图片需要从原库获取路径
      const fav = currentImage as any
      const imagePath = fav.relative_path || fav.image_path || fav.imagePath
      const libraryId = fav.library_id || fav.libraryId
      if (libraryId && imagePath) {
        getFavoriteImagePath(libraryId, imagePath).then(setCurrentImagePath).catch(err => {
          console.error('获取收藏图片路径失败:', err)
          setCurrentImagePath('')
        })
      } else {
        console.warn('[App] 收藏库图片缺少 libraryId 或 imagePath', fav)
        setCurrentImagePath('')
      }
    } else {
      setCurrentImagePath('')
    }
  }, [currentImage, currentLibraryId])

  const getCurrentImagePath = async () => {
    if (!currentLibraryId || !currentImage || currentLibraryId === FAVORITE_LIBRARY_ID) return ''
    try {
      return await (window as any).electronAPI.getImagePath(currentLibraryId, currentImage.id)
    } catch (error) {
      console.error('获取图片路径失败:', error)
      return ''
    }
  }

  const getFavoriteImagePath = async (libraryId: number, relativePath: string) => {
    try {
      return await (window as any).electronAPI.getImagePathByRelativePath(libraryId, relativePath)
    } catch (error) {
      console.error('获取收藏图片路径失败:', error)
      return ''
    }
  }

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框中触发
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

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

      // F 键 - 收藏当前图片
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        handleToggleFavorite()
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
  }, [viewMode, handleClose, toggleSlideshow, toggleFolderSidebar, handleFirst, handleLast, handleToggleFavorite])

  const isFavoriteLibrary = currentLibraryId === FAVORITE_LIBRARY_ID

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
              value={currentLibraryId ?? ''}
              onChange={(e) => {
                const value = e.target.value
                if (value === 'favorites') {
                  setCurrentLibrary(FAVORITE_LIBRARY_ID)
                  loadFavoriteImages()
                } else {
                  setCurrentLibrary(value ? Number(value) : null)
                }
              }}
            >
              <option value="favorites">❤️ 收藏夹 ({favoriteCount})</option>
              <option value="" disabled>──────────</option>
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
            {isFavoriteLibrary 
              ? `${favoriteCount} 张收藏图片` 
              : currentLibraryId 
                ? `${totalImages} 张图片` 
                : '请先选择或添加库'
            }
          </span>

          {!isFavoriteLibrary && viewMode === 'grid' && currentLibraryId && (
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

          {viewMode === 'grid' && currentLibraryId && (
            <SortControl
              sortBy={imageSortBy}
              sortOrder={imageSortOrder}
              onSortByChange={setSortBy}
              onSortOrderChange={setSortOrder}
            />
          )}

          {viewMode === 'grid' && currentLibraryId && (
            <button
              onClick={() => setGridLayoutMode(gridLayoutMode === 'grid' ? 'masonry' : 'grid')}
              className="header-action-btn"
              title={gridLayoutMode === 'grid' ? '切换到瀑布流视图' : '切换到网格视图'}
            >
              {gridLayoutMode === 'grid' ? '▦ 网格' : '≣ 瀑布流'}
            </button>
          )}

          <button
            onClick={() => setViewMode(viewMode === 'grid' ? 'viewer' : 'grid')}
            className="header-action-btn header-view-btn"
            disabled={isFavoriteLibrary ? favoriteCount === 0 : !currentLibraryId || images.length === 0}
            title={viewMode === 'grid' ? '进入查看器 (F5)' : '返回网格视图 (F5)'}
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
              <span>📂 {isFavoriteLibrary ? '收藏的文件夹' : '文件夹'}</span>
              <button onClick={toggleFolderSidebar} className="close-sidebar-btn">×</button>
            </div>
            <div className="folder-sidebar-content">
              {isFavoriteLibrary ? (
                <FolderTree
                  folders={favoriteFolderTree}
                  selectedFolder={selectedFolder}
                  onFolderSelect={handleFolderSelect}
                  libraryId={FAVORITE_LIBRARY_ID}
                  isFavoriteLibrary={true}
                  onToggleFavoriteFolder={(folderPath) => {
                    // 在收藏库中，取消收藏文件夹
                    if (currentLibraryId) {
                      // 需要找到原始的 library_id
                      const folder = favoriteFolderTree.find(f => f.path === folderPath)
                      if (folder && folder.library_id) {
                        toggleFavoriteFolder(folder.library_id, folderPath)
                      }
                    }
                  }}
                  onSwitchToSingleView={handleSwitchToSingleView}
                />
              ) : (
                <FolderTree
                  folders={folderTree}
                  selectedFolder={selectedFolder}
                  onFolderSelect={handleFolderSelect}
                  libraryId={currentLibraryId}
                  isFavoriteLibrary={false}
                  onToggleFavoriteFolder={(folderPath) => {
                    if (currentLibraryId) {
                      toggleFavoriteFolder(currentLibraryId, folderPath)
                    }
                  }}
                />
              )}
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

          {isFavoriteLibrary && favoriteCount === 0 ? (
            <div className="no-images-hint">
              <h2>❤️ 还没有收藏</h2>
              <p>浏览图片时按 <kbd>F</kbd> 键或点击心形图标收藏喜欢的图片</p>
            </div>
          ) : !currentLibraryId ? (
            <div className="no-library-hint">
              <h2>📁 请先添加或选择一个图片库</h2>
              <p>点击左上角的"管理"按钮添加包含图片的文件夹</p>
              <button onClick={handleAddLibrary} className="add-library-btn-large">
                + 添加库
              </button>
            </div>
          ) : images.length === 0 && !isLoading && !isFavoriteLibrary ? (
            <div className="no-images-hint">
              <h2>📷 这个{selectedFolder ? `"${selectedFolder.split('/').pop()}"` : '库'}还没有图片</h2>
              <p>点击"扫描"按钮来索引图片文件夹</p>
              <button onClick={() => currentLibraryId && handleScanLibrary(currentLibraryId)} className="scan-btn-large">
                🔄 扫描图片
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid-view-container">
              {isFavoriteLibrary ? (
                gridLayoutMode === 'grid' ? (
                  <ImageGrid
                    key="favorites"
                    images={favoriteGridImages}
                    selectedId={currentImage?.id}
                    onImageClick={handleImageClick}
                    onImageDoubleClick={handleImageDoubleClick}
                    onToggleFavorite={handleGridToggleFavorite}
                    thumbnailSize={thumbnailSize}
                    scrollPosition={gridScrollRef.current}
                    onScrollChange={(pos) => { gridScrollRef.current = pos }}
                    libraryId={FAVORITE_LIBRARY_ID}
                    isFavoriteLibrary={true}
                  />
                ) : (
                  <MasonryGrid
                    key="favorites-masonry"
                    images={favoriteGridImages}
                    selectedId={currentImage?.id}
                    onImageClick={handleImageClick}
                    onImageDoubleClick={handleImageDoubleClick}
                    onToggleFavorite={handleGridToggleFavorite}
                    thumbnailSize={thumbnailSize}
                    scrollPosition={gridScrollRef.current}
                    onScrollChange={(pos) => { gridScrollRef.current = pos }}
                    libraryId={FAVORITE_LIBRARY_ID}
                    isFavoriteLibrary={true}
                  />
                )
              ) : (
                gridLayoutMode === 'grid' ? (
                  <ImageGrid
                    key={`${currentLibraryId}-${selectedFolder || 'all'}`}
                    images={gridImages}
                    selectedId={currentImage?.id}
                    onImageClick={handleImageClick}
                    onImageDoubleClick={handleImageDoubleClick}
                    onToggleFavorite={handleGridToggleFavorite}
                    thumbnailSize={thumbnailSize}
                    scrollPosition={gridScrollRef.current}
                    onScrollChange={(pos) => { gridScrollRef.current = pos }}
                    libraryId={currentLibraryId!}
                  />
                ) : (
                  <MasonryGrid
                    key={`${currentLibraryId}-${selectedFolder || 'all'}-masonry`}
                    images={gridImages}
                    selectedId={currentImage?.id}
                    onImageClick={handleImageClick}
                    onImageDoubleClick={handleImageDoubleClick}
                    onToggleFavorite={handleGridToggleFavorite}
                    thumbnailSize={thumbnailSize}
                    scrollPosition={gridScrollRef.current}
                    onScrollChange={(pos) => { gridScrollRef.current = pos }}
                    libraryId={currentLibraryId!}
                  />
                )
              )}
            </div>
          ) : viewMode === 'viewer' && currentImage ? (
            <div className="image-viewer-container">
              <ImageViewer
                src={`file://${currentImagePath}`}
                alt={currentImage.relative_path?.split('/').pop() || (currentImage as any).relativePath?.split('/').pop() || ''}
                currentIndex={currentLibraryId === FAVORITE_LIBRARY_ID ? favoriteImageIndex : currentIndex}
                totalImages={isFavoriteLibrary ? (favoriteViewMode === 'single' ? singleFavoriteImages.length : favoriteImages.length) : images.length}
                onPrevious={handlePrevious}
                onNext={handleNext}
                onClose={handleClose}
                imageInfo={getCurrentImageInfo() || undefined}
                slideshowSettings={slideshow}
                onSlideshowChange={(enabled) => setSlideshow(prev => ({ ...prev, enabled }))}
              />
            </div>
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
        <span>F: 收藏</span>
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
