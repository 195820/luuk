import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import './ImageGrid.css'

export interface ImageGridItem {
  id: number
  src: string
  alt: string
  width?: number
  height?: number
  fileSize?: number
  format?: string
}

interface ImageGridProps {
  images: ImageGridItem[]
  selectedId?: number
  onImageClick?: (image: ImageGridItem) => void
  onImageDoubleClick?: (image: ImageGridItem) => void
  thumbnailSize?: number
  scrollPosition?: number
  onScrollChange?: (position: number) => void
  libraryId: number
}

export function ImageGrid({
  images,
  selectedId,
  onImageClick,
  onImageDoubleClick,
  thumbnailSize = 200,
  scrollPosition = 0,
  onScrollChange,
  libraryId,
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
  const formatFileSize = (bytes?: number): string => {
    if (!bytes || bytes === 0) return ''
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

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
              key={`${libraryId}-${rowIndex}`}
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
                  key={`${libraryId}-${image.id}`}
                  image={image}
                  isSelected={selectedId === image.id}
                  onClick={() => onImageClick?.(image)}
                  onDoubleClick={() => onImageDoubleClick?.(image)}
                  thumbnailSize={thumbnailSize}
                  formatFileSize={formatFileSize}
                  libraryId={libraryId}
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
  onClick: () => void
  onDoubleClick: () => void
  thumbnailSize: number
  formatFileSize: (bytes?: number) => string
  libraryId: number
}

const ImageGridItem = function ImageGridItem({
  image,
  isSelected,
  onClick,
  onDoubleClick,
  thumbnailSize,
  formatFileSize,
  libraryId,
}: ImageGridItemProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [thumbnailSrc, setThumbnailSrc] = useState<string>('')

  // 加载缩略图
  useEffect(() => {
    if (!libraryId) return

    let cancelled = false

    const loadThumbnail = async () => {
      try {
        // @ts-ignore
        const thumbnail = await window.electronAPI.getThumbnail(libraryId, image.id, 'medium')

        if (!cancelled && thumbnail) {
          setThumbnailSrc(thumbnail)
          setIsLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(true)
          setIsLoading(false)
        }
      }
    }

    loadThumbnail()

    return () => {
      cancelled = true
    }
  }, [libraryId, image.id])

  return (
    <div
      className={`image-grid-item ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ width: thumbnailSize, flexShrink: 0 }}
    >
      <div className="image-grid-thumbnail">
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
          <div style={{ width: '100%', height: '100%', background: '#333' }}>加载中</div>
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
