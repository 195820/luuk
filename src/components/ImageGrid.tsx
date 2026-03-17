import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import './ImageGrid.css'

export interface ImageGridItem {
  id: number | string
  src: string
  alt: string
  width?: number
  height?: number
  fileSize?: number
  format?: string
  libraryId?: number
  imagePath?: string
  isFavorite?: boolean
}

interface ImageGridProps {
  images: ImageGridItem[]
  selectedId?: number
  onImageClick?: (image: ImageGridItem) => void
  onImageDoubleClick?: (image: ImageGridItem) => void
  onToggleFavorite?: (image: ImageGridItem) => void
  thumbnailSize?: number
  scrollPosition?: number
  onScrollChange?: (position: number) => void
  libraryId: number
  isFavoriteLibrary?: boolean
}

export function ImageGrid({
  images,
  selectedId,
  onImageClick,
  onImageDoubleClick,
  onToggleFavorite,
  thumbnailSize = 200,
  scrollPosition = 0,
  onScrollChange,
  libraryId,
  isFavoriteLibrary,
}: ImageGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const scrollRestoreRef = useRef<boolean>(true)

  // 计算每行能放多少张图片
  const columns = Math.max(1, Math.floor(containerWidth / (thumbnailSize + 32)))
  const rowCount = Math.ceil(images.length / columns)

  // 更新容器宽度
  useEffect(() => {
    const updateWidth = () => {
      if (parentRef.current) {
        setContainerWidth(parentRef.current.clientWidth)
      }
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => thumbnailSize + 60,
    overscan: 5,
  })

  // 库变化时重置滚动位置
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0
    }
  }, [libraryId])

  // 恢复滚动位置
  useEffect(() => {
    if (parentRef.current && scrollRestoreRef.current && scrollPosition > 0) {
      parentRef.current.scrollTop = scrollPosition
      scrollRestoreRef.current = false
    }
  }, [scrollPosition])

  // 监听滚动事件
  const handleScroll = useCallback(() => {
    if (parentRef.current && onScrollChange) {
      onScrollChange(parentRef.current.scrollTop)
    }
  }, [onScrollChange])

  useEffect(() => {
    const element = parentRef.current
    if (element) {
      element.addEventListener('scroll', handleScroll, { passive: true })
      return () => element.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  // 格式化文件大小
  const formatFileSize = useCallback((bytes?: number): string => {
    if (!bytes || bytes === 0) return ''
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }, [])

  return (
    <div
      ref={parentRef}
      className="image-grid"
      style={{ height: '100%', overflow: 'auto' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowIndex = virtualRow.index
          const startIndex = rowIndex * columns
          const endIndex = Math.min(startIndex + columns, images.length)
          const rowImages = images.slice(startIndex, endIndex)

          return (
            <div
              key={`row-${rowIndex}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                gap: '16px',
                padding: '0 8px',
                boxSizing: 'border-box',
              }}
            >
              {rowImages.map((image) => (
                <ImageGridItem
                  key={image.id}
                  image={image}
                  isSelected={selectedId === image.id}
                  onClick={onImageClick}
                  onDoubleClick={onImageDoubleClick}
                  onToggleFavorite={onToggleFavorite}
                  thumbnailSize={thumbnailSize}
                  formatFileSize={formatFileSize}
                  libraryId={libraryId}
                  isFavoriteLibrary={isFavoriteLibrary}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface ImageGridItemProps {
  image: ImageGridItem
  isSelected: boolean
  onClick?: (image: ImageGridItem) => void
  onDoubleClick?: (image: ImageGridItem) => void
  onToggleFavorite?: (image: ImageGridItem) => void
  thumbnailSize: number
  formatFileSize: (bytes?: number) => string
  libraryId: number
  isFavoriteLibrary?: boolean
}

const ImageGridItem = function ImageGridItem({
  image,
  isSelected,
  onClick,
  onDoubleClick,
  onToggleFavorite,
  thumbnailSize,
  formatFileSize,
  libraryId,
  isFavoriteLibrary,
}: ImageGridItemProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [thumbnailSrc, setThumbnailSrc] = useState<string>('')
  const [realImageId, setRealImageId] = useState<number | string | null>(null)
  const [hasLoadedImageInfo, setHasLoadedImageInfo] = useState(false)

  // 收藏库需要获取真实的图片 ID
  useEffect(() => {
    if (isFavoriteLibrary && image.libraryId && image.imagePath && !hasLoadedImageInfo) {
      const fetchRealImageId = async () => {
        try {
          // @ts-ignore
          const imageInfo = await window.electronAPI.getImageByRelativePath(image.libraryId, image.imagePath)
          if (imageInfo && imageInfo.id) {
            setRealImageId(imageInfo.id)
          }
        } catch (err) {
          console.error('获取图片 ID 失败:', err)
        } finally {
          setHasLoadedImageInfo(true)
        }
      }
      fetchRealImageId()
    } else if (isFavoriteLibrary && image.id && typeof image.id === 'string' && image.id.includes('-')) {
      // 处理收藏文件夹中的图片，ID 格式为 "libraryId-relativePath-index"
      // 直接从 image 对象中获取 libraryId 和相对路径
      if (image.libraryId && image.imagePath) {
        const fetchRealImageId = async () => {
          try {
            // @ts-ignore
            const imageInfo = await window.electronAPI.getImageByRelativePath(image.libraryId, image.imagePath)
            if (imageInfo && imageInfo.id) {
              setRealImageId(imageInfo.id)
            }
          } catch (err) {
            console.error('获取图片 ID 失败（收藏文件夹）:', err)
          } finally {
            setHasLoadedImageInfo(true)
          }
        }
        fetchRealImageId()
        return
      }
    } else if (!isFavoriteLibrary) {
      setRealImageId(typeof image.id === 'number' ? image.id : null)
      setHasLoadedImageInfo(true)
    }
  }, [isFavoriteLibrary, image.libraryId, image.imagePath, image.id, hasLoadedImageInfo])

  // 加载缩略图
  useEffect(() => {
    let cancelled = false

    const loadThumbnail = async () => {
      // 等待获取真实 ID
      if (!hasLoadedImageInfo) return

      // 如果没有真实 ID，标记为错误
      if (realImageId === null && isFavoriteLibrary) {
        setError(true)
        setIsLoading(false)
        return
      }

      try {
        // 收藏库使用图片实际的 libraryId 和真实 ID
        const thumbLibraryId = isFavoriteLibrary && image.libraryId ? image.libraryId : libraryId
        const thumbImageId = realImageId !== null ? realImageId : (typeof image.id === 'number' ? image.id : null)

        if (thumbImageId === null || (typeof thumbImageId === 'number' && thumbImageId <= 0)) {
          setError(true)
          setIsLoading(false)
          return
        }

        // @ts-ignore
        const thumbnail = await window.electronAPI.getThumbnail(thumbLibraryId, thumbImageId, 'medium')

        if (!cancelled && thumbnail) {
          setThumbnailSrc(thumbnail)
          setIsLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('加载缩略图失败:', image.alt, err)
          setError(true)
          setIsLoading(false)
        }
      }
    }

    loadThumbnail()

    return () => {
      cancelled = true
    }
  }, [libraryId, image.id, realImageId, isFavoriteLibrary, image.libraryId, hasLoadedImageInfo, image.alt])

  const handleClick = useCallback((e: React.MouseEvent) => {
    console.log('[ImageGridItem] handleClick 被调用', { image, clickCount: e.detail })
    onClick?.(image)
  }, [onClick, image])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    console.log('[ImageGridItem] handleDoubleClick 被调用', { image, clickCount: e.detail })
    onDoubleClick?.(image)
  }, [onDoubleClick, image])

  const handleFavoriteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleFavorite?.(image)
  }, [onToggleFavorite, image])

  return (
    <div
      className={`image-grid-item ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{ 
        width: thumbnailSize, 
        flexShrink: 0,
      }}
    >
      <div className="image-grid-thumbnail">
        <button
          className="image-grid-favorite-btn"
          onClick={handleFavoriteClick}
          title={image.isFavorite ? '取消收藏' : '收藏'}
        >
          <svg viewBox="0 0 24 24" fill={image.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </button>
        {isLoading && <div className="image-grid-loading">加载中...</div>}
        {error && (
          <div className="image-grid-error">
            <span>加载失败</span>
          </div>
        )}
        {thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt={image.alt}
            loading="lazy"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setError(true)
              setIsLoading(false)
            }}
            style={{
              display: isLoading || error ? 'none' : 'block',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'var(--bg-tertiary)' }}>加载中</div>
        )}
      </div>
      <div className="image-grid-info">
        <span className="image-grid-name" title={image.alt}>
          {image.alt}
        </span>
        <div className="image-grid-meta">
          {image.width && image.height ? (
            <span>{image.width}×{image.height}</span>
          ) : (
            <span>1920×1080</span>
          )}
          {image.fileSize && (
            <span className="file-size">{formatFileSize(image.fileSize)}</span>
          )}
        </div>
      </div>
    </div>
  )
}
