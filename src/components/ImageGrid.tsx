import { useRef, memo, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import './ImageGrid.css'

interface ImageGridItem {
  id: number
  src: string
  alt: string
}

interface ImageGridProps {
  images: ImageGridItem[]
  selectedId?: number
  onImageClick?: (image: ImageGridItem) => void
  onImageDoubleClick?: (image: ImageGridItem) => void
  thumbnailSize?: number
}

export function ImageGrid({
  images,
  selectedId,
  onImageClick,
  onImageDoubleClick,
  thumbnailSize = 200
}: ImageGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

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
              key={rowIndex}
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
                  onClick={() => onImageClick?.(image)}
                  onDoubleClick={() => onImageDoubleClick?.(image)}
                  thumbnailSize={thumbnailSize}
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
}

const ImageGridItem = memo(function ImageGridItem({
  image,
  isSelected,
  onClick,
  onDoubleClick,
  thumbnailSize,
}: ImageGridItemProps) {
  return (
    <div
      className={`image-grid-item ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ width: thumbnailSize, flexShrink: 0 }}
    >
      <div className="image-grid-thumbnail">
        <img
          src={image.src}
          alt={image.alt}
          loading="lazy"
        />
      </div>
      <div className="image-grid-info">
        <span className="image-grid-name" title={image.alt}>
          {image.alt}
        </span>
        <span className="image-grid-meta">
          1920×1080
        </span>
      </div>
    </div>
  )
})
