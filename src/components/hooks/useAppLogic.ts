import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useImageStore, FAVORITE_LIBRARY_ID } from '../../stores/imageStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { useFolderStore } from '../../stores/folderStore'
import { useFavoriteStore } from '../../stores/favoriteStore'
import { useUIStore } from '../../stores/uiStore'
import type { ImageGridItem } from '../ImageGrid'
import type { Library } from '../../types'
import { useDebugLog } from './useDebugLog'

/**
 * App 逻辑自定义 Hook
 * 提取 App 组件中的业务逻辑和回调函数
 */
export function useAppLogic() {
  // 本地状态
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewMode, setViewMode] = useState<'grid' | 'viewer'>('grid')
  const [isViewTransitioning, setIsViewTransitioning] = useState(false)
  const [thumbnailSize, setThumbnailSize] = useState(200)
  const [slideshow, setSlideshow] = useState({ enabled: false, interval: 5 })
  const [selectedInterval, setSelectedInterval] = useState(5)
  const [showLibraryPanel, setShowLibraryPanel] = useState(false)
  const [currentImagePath, setCurrentImagePath] = useState<string>('')

  const gridScrollRef = useRef<number>(0)
  const slideshowTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Store 状态
  const {
    images,
    totalImages,
    currentImage,
    setCurrentImage,
    loadImages,
  } = useImageStore()

  const {
    libraries,
    currentLibraryId,
    initialize,
    loadLibraries,
    addLibrary,
    removeLibrary,
    setCurrentLibrary,
    scanLibrary,
  } = useLibraryStore()

  const {
    folderTree,
    selectedFolder,
    favoriteFolderTree,
    selectedFavoriteFolder,
    loadFolderTree,
    setSelectedFolder,
    loadFavoriteFolderTree,
    toggleFavoriteFolder,
    setSelectedFavoriteFolder,
  } = useFolderStore()

  const {
    favorites,
    favoriteImages,
    favoriteCount,
    singleFavoriteImages,
    singleFavoriteCount,
    favoriteViewMode,
    toggleFavorite,
    loadFavorites,
    loadFavoriteImages,
    loadFavoriteFolderImages,
    loadSingleFavoriteImages,
    isFavorite,
  } = useFavoriteStore()

  const {
    folderSidebarOpen,
    isLoading,
    error,
    gridLayoutMode,
    imageSortBy,
    imageSortOrder,
    scanProgress,
    toggleFolderSidebar,
    setGridLayoutMode,
    setSortBy,
    setSortOrder,
  } = useUIStore()

  // 初始化服务
  useEffect(() => {
    const init = async () => {
      await initialize()
      await loadLibraries()
      await loadFavorites()
      await loadFavoriteFolderTree()

      // 默认选中收藏库
      setCurrentLibrary(FAVORITE_LIBRARY_ID)
      await loadFavoriteImages()

      useFolderStore.setState({ folderTree: [], selectedFolder: null })
    }
    init()
  }, [])

  // 加载当前库的图片
  useEffect(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      if (favoriteViewMode === 'single') {
        loadSingleFavoriteImages()
      } else {
        loadFavoriteImages()
      }
      setFavoriteImageIndex(0)
    } else if (currentLibraryId) {
      loadImages()
    }
  }, [currentLibraryId, favoriteViewMode, loadImages, loadFavoriteImages, loadSingleFavoriteImages])

  // 将数据库图片转换为 Grid 需要的格式
  const gridImages: ImageGridItem[] = useMemo(() => {
    return images.map((img: any) => ({
      id: img.id,
      src: '',
      alt: img.relative_path.split('/').pop() || img.relative_path,
      width: img.width,
      height: img.height,
      fileSize: img.file_size,
      format: img.format.toLowerCase(),
      isFavorite: isFavorite(currentLibraryId || 0, img.relative_path),
      thumbnail: img.thumbnail,
    }));
  }, [images, currentLibraryId, isFavorite]);

  // 收藏库图片
  const favoriteGridImages: ImageGridItem[] = useMemo(() => {
    const sourceArray = favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages || []
    return sourceArray.map((fav: any, index: number) => ({
      id: `${fav.library_id}-${fav.relative_path || ''}-${index}`,
      src: '',
      alt: (fav.relative_path || '').split('/').pop() || (fav.relative_path || ''),
      width: fav.width || 0,
      height: fav.height || 0,
      fileSize: fav.file_size || 0,
      format: (fav.format || '').toLowerCase(),
      isFavorite: favoriteViewMode === 'single' ? true : isFavorite(fav.library_id, fav.relative_path),
      libraryId: fav.library_id,
      imagePath: fav.relative_path,
      thumbnail: fav.thumbnail,
    }));
  }, [favoriteViewMode, singleFavoriteImages, favoriteImages, isFavorite]);

  // 收藏图片索引状态
  const [favoriteImageIndex, setFavoriteImageIndex] = useState(0)

  // 处理文件夹选择
  const handleFolderSelect = useCallback((folderPath: string | null) => {
    if (viewMode === 'viewer') {
      setViewMode('grid')
    }

    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      if (folderPath) {
        loadFavoriteFolderImages(folderPath)
      } else {
        loadFavoriteImages()
      }
      setSelectedFavoriteFolder(folderPath)
    } else {
      setSelectedFolder(folderPath)
    }
  }, [viewMode, currentLibraryId, loadFavoriteFolderImages, loadFavoriteImages, setSelectedFavoriteFolder, setSelectedFolder])

  // 切换到单图收藏视图
  const handleSwitchToSingleView = useCallback(() => {
    if (viewMode === 'viewer') {
      setViewMode('grid')
    }
  }, [viewMode])

  // 导航函数
  const handlePrevious = useCallback(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      setFavoriteImageIndex(prev => Math.max(0, prev - 1))
    } else {
      setCurrentIndex(prev => Math.max(0, prev - 1))
    }
  }, [currentLibraryId])

  const handleNext = useCallback(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
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
  }, [currentLibraryId])

  const handleLast = useCallback(() => {
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
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
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      const targetArray = favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages
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
    setIsViewTransitioning(true)
    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      const targetArray = favoriteViewMode === 'single' ? singleFavoriteImages : favoriteImages
      const index = targetArray.findIndex((fav: any) => {
        return fav.relative_path === image.imagePath && fav.library_id === image.libraryId
      })
      if (index >= 0) {
        setFavoriteImageIndex(index)
        setCurrentImage(targetArray[index] as any)
        setViewMode('viewer')
        setTimeout(() => setIsViewTransitioning(false), 300)
      }
    } else {
      const img = images.find((i: any) => i.id === image.id)
      if (img) {
        setCurrentImage(img)
        setCurrentIndex(images.findIndex((i: any) => i.id === image.id))
        setViewMode('viewer')
        setTimeout(() => setIsViewTransitioning(false), 300)
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

  // 切换收藏状态
  const handleToggleFavorite = useCallback(async () => {
    if (!currentLibraryId) return

    if (currentLibraryId === FAVORITE_LIBRARY_ID) {
      const currentFavImage = favoriteImages[favoriteImageIndex]
      if (!currentFavImage) return

      const libraryId = currentFavImage.library_id
      const imagePath = currentFavImage.relative_path

      try {
        const result = await toggleFavorite(libraryId, imagePath)
        if (!result) {
          await loadFavoriteImages()
          if (favoriteImageIndex >= favoriteImages.length - 1) {
            setFavoriteImageIndex(Math.max(0, favoriteImages.length - 2))
          }
        }
      } catch (error) {
        console.error('[App] 切换收藏失败:', error)
      }
      return
    }

    if (images.length === 0) return
    const currentImg = images[currentIndex]
    if (!currentImg) return

    const imagePath = currentImg.relative_path
    try {
      const result = await toggleFavorite(currentLibraryId, imagePath)
      if (!result) {
        await loadFavoriteImages()
      }
    } catch (error) {
      console.error('[App] 切换收藏失败:', error)
    }
  }, [currentLibraryId, images, currentIndex, favoriteImages, favoriteImageIndex, toggleFavorite, loadFavoriteImages])

  // 处理网格中图片的收藏切换
  const handleGridToggleFavorite = useCallback(async (image: ImageGridItem) => {
    const libraryId = image.libraryId || currentLibraryId
    const imagePath = image.imagePath || image.alt

    if (!libraryId) return

    try {
      await toggleFavorite(libraryId, imagePath)
      if (currentLibraryId === FAVORITE_LIBRARY_ID && favoriteViewMode === 'single') {
        await loadSingleFavoriteImages()
      }
    } catch (error) {
      console.error('[App] 切换收藏失败:', error)    }
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
        let delay = 500

        while (attempts < maxAttempts) {
          attempts++
          await new Promise(resolve => setTimeout(resolve, delay))
          delay = Math.min(delay * 1.5, 3000)
          await loadLibraries()

          const currentLibs = useLibraryStore.getState().libraries
          const updatedLib = currentLibs.find(l => l.id === library.id)

          if (updatedLib && updatedLib.image_count > 0) {
            const state = useLibraryStore.getState()
            if (state.currentLibraryId !== library.id) {
              setCurrentLibrary(library.id)
              await new Promise(resolve => setTimeout(resolve, 300))
            }

            try {
              const currentState = useLibraryStore.getState()

              if (!currentState.currentLibraryId) {
                setCurrentLibrary(library.id)
                await new Promise(resolve => setTimeout(resolve, 300))
              }

              await loadFolderTree(library.id)
              const treeState = useFolderStore.getState().folderTree

              await loadImages()
              const imagesState = useImageStore.getState().images

              if (imagesState.length === 0 && treeState.length === 0) {
                setCurrentLibrary(null)
                await new Promise(resolve => setTimeout(resolve, 100))
                setCurrentLibrary(library.id)
                await new Promise(resolve => setTimeout(resolve, 300))
                await loadFolderTree(library.id)
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
      await loadLibraries()
    } catch (error: any) {
      await loadLibraries()
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

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        handleToggleFavorite()
        return
      }

      if (viewMode === 'viewer') {
        if (e.key === 'Escape') handleClose()

        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault()
          toggleSlideshow()
        }

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

  return {
    // 状态
    currentIndex,
    favoriteImageIndex,
    viewMode,
    isViewTransitioning,
    thumbnailSize,
    slideshow,
    selectedInterval,
    showLibraryPanel,
    currentImagePath,
    gridScrollRef,

    // Store 状态
    libraries,
    currentLibraryId,
    images,
    totalImages,
    currentImage,
    isLoading,
    error,
    folderTree,
    selectedFolder,
    folderSidebarOpen,
    favorites,
    favoriteImages,
    favoriteCount,
    singleFavoriteImages,
    singleFavoriteCount,
    favoriteViewMode,
    favoriteFolderTree,
    selectedFavoriteFolder,
    imageSortBy,
    imageSortOrder,
    gridLayoutMode,
    scanProgress,

    // 转换后的数据
    gridImages,
    favoriteGridImages,

    // 回调函数
    handleFolderSelect,
    handleSwitchToSingleView,
    handlePrevious,
    handleNext,
    handleFirst,
    handleLast,
    handleImageClick,
    handleImageDoubleClick,
    handleClose,
    toggleSlideshow,
    changeSlideshowInterval,
    handleToggleFavorite,
    handleGridToggleFavorite,
    handleAddLibrary,
    handleRemoveLibrary,
    handleScanLibrary,
    getCurrentImageInfo,

    // Store 方法
    setCurrentLibrary,
    loadFavorites,
    loadFavoriteImages,
    loadFavoriteFolderImages,
    loadSingleFavoriteImages,
    loadFolderTree,
    loadImages,
    toggleFavorite,
    isFavorite,
    toggleFavoriteFolder,
    setSelectedFavoriteFolder,
    setSortBy,
    setSortOrder,
    setGridLayoutMode,
    toggleFolderSidebar,

    // 状态设置
    setViewMode,
    setIsViewTransitioning,
    setThumbnailSize,
    setSlideshow,
    setSelectedInterval,
    setShowLibraryPanel,
    setCurrentImagePath,
    setCurrentIndex,
    setFavoriteImageIndex,

    // 计算值
    isFavoriteLibrary,
  }
}
