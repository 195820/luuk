import { useState, useEffect, useCallback } from 'react'
import type { ImageGridItem } from './ImageGrid'

export interface ImageGridItemProps {
  image: ImageGridItem
  isSelected: boolean
  onClick?: (image: ImageGridItem) => void
  onDoubleClick?: (image: ImageGridItem) => void
  onToggleFavorite?: (image: ImageGridItem) => void
  thumbnailSize: number
  formatFileSize: (bytes?: number) => string
  libraryId: number
  isFavoriteLibrary?: boolean
  isMasonry?: boolean // 是否为瀑布流模式
}

export function ImageGridItemComponent({
  image,
  isSelected,
  onClick,
  onDoubleClick,
  onToggleFavorite,
  thumbnailSize,
  formatFileSize,
  libraryId,
  isFavoriteLibrary,
  isMasonry,
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

  const handleClick = useCallback(() => {
    onClick?.(image)
  }, [onClick, image])

  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.(image)
  }, [onDoubleClick, image])

  const handleFavoriteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleFavorite?.(image)
  }, [onToggleFavorite, image])

  // 格式化视频时长
  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div
      className={`image-grid-item ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{
        width: isMasonry ? '100%' : thumbnailSize,
        flexShrink: 0,
        height: isMasonry ? '100%' : 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="image-grid-thumbnail" style={{ height: isMasonry ? '100%' : undefined }}>
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
        {/* 视频时长 badge */}
        {image.mediaType === 'video' && (
          <span className="video-duration-badge">
            {image.duration ? formatDuration(image.duration) : 'VIDEO'}
          </span>
        )}
        {/* 不支持的格式 overlay */}
        {image.mediaType === 'video' && (['avi', 'mkv'].includes(image.format?.toLowerCase() || '')) && (
          <div className="unsupported-format-overlay">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>不支持</span>
          </div>
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
