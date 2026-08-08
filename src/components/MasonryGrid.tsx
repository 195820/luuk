import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { ImageGridItemComponent } from './ImageGridItem'
import type { ImageGridItem } from './ImageGrid'
import { formatFileSize } from '../utils/format'

export interface MasonryGridItem extends ImageGridItem {
  aspectRatio?: number
}

interface MasonryGridProps {
  images: MasonryGridItem[]
  selectedId?: number
  onImageClick?: (image: ImageGridItem) => void
  onImageDoubleClick?: (image: ImageGridItem) => void
  onToggleFavorite?: (image: ImageGridItem) => void
  thumbnailSize?: number
  scrollPosition?: number
  onScrollChange?: (position: number) => void
  libraryId: number
  isFavoriteLibrary?: boolean
  columnCount?: number
}

export function MasonryGrid({
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
  columnCount: fixedColumnCount,
}: MasonryGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [columnCount, setColumnCount] = useState(4)
  const [columns, setColumns] = useState<MasonryGridItem[][]>([])
  const [columnHeights, setColumnHeights] = useState<number[]>([])
  const [columnTops, setColumnTops] = useState<number[][]>([])
  const scrollRestoreRef = useRef<boolean>(true)

  // 过滤掉音频文件（音频在底部独立区域显示）
  const displayImages = useMemo(() => images.filter((img) => {
    const mt = img.mediaType || (img as any).media_type
    return mt !== 'audio'
  }), [images])

  // 计算列数
  useEffect(() => {
    if (fixedColumnCount) {
      setColumnCount(fixedColumnCount)
      return
    }

    const minColumnWidth = thumbnailSize + 10
    const calculatedColumns = Math.max(1, Math.floor(containerWidth / minColumnWidth))
    setColumnCount(calculatedColumns)
  }, [containerWidth, thumbnailSize, fixedColumnCount])

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

  // 将图片分配到各列（瀑布流算法）
  useEffect(() => {
    if (columnCount === 0) {
      setColumns([])
      setColumnHeights([])
      setColumnTops([])
      return
    }

    const newColumns: MasonryGridItem[][] = Array.from({ length: columnCount }, () => [])
    const heights: number[] = Array(columnCount).fill(0)
    const tops: number[][] = Array.from({ length: columnCount }, () => [])

    displayImages.forEach((image) => {
      let minHeight = Math.min(...heights)
      let minIndex = heights.indexOf(minHeight)

      const aspectRatio = image.aspectRatio || (image.height && image.width ? image.height / image.width : 1)
      const itemWidth = thumbnailSize
      const itemHeight = itemWidth * aspectRatio + 8

      tops[minIndex].push(heights[minIndex])

      newColumns[minIndex].push(image)
      heights[minIndex] += itemHeight + 8
    })

    setColumns(newColumns)
    setColumnHeights(heights)
    setColumnTops(tops)
  }, [displayImages, columnCount, thumbnailSize])

  // 计算总高度（所有列中最高的一列）
  const totalHeight = columnHeights.length > 0 ? Math.max(...columnHeights) : 0

  // 库变化时重置滚动位置
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0
      scrollRestoreRef.current = true
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

  return (
    <div
      ref={parentRef}
      className="w-full h-full overflow-auto bg-canvas"
    >
      <div
        className="relative w-full"
        style={{
          height: `${totalHeight}px`,
          padding: '1rem',
        }}
      >
        {columns.map((column, columnIndex) => {
          const columnTop = columnTops[columnIndex] || []

          return (
            <div
              key={`column-${columnIndex}`}
              className="absolute top-0 flex flex-col gap-2 box-border"
              style={{
                left: `${columnIndex * (thumbnailSize + 7) + 3}px`,
                width: `${thumbnailSize}px`,
              }}
            >
              {column.map((image, itemIndex) => {
                const top = columnTop[itemIndex] || 0
                const aspectRatio = image.aspectRatio || (image.height && image.width ? image.height / image.width : 1)
                const itemHeight = thumbnailSize * aspectRatio + 8

                return (
                  <div
                    key={`${image.id}-${columnIndex}-${itemIndex}`}
                    className="absolute left-0 w-full"
                    style={{
                      height: `${itemHeight}px`,
                      transform: `translateY(${top}px)`,
                    }}
                  >
                    <ImageGridItemComponent
                      image={image}
                      isSelected={selectedId === image.id}
                      onClick={onImageClick}
                      onDoubleClick={onImageDoubleClick}
                      onToggleFavorite={onToggleFavorite}
                      thumbnailSize={thumbnailSize}
                      formatFileSize={formatFileSize}
                      libraryId={libraryId}
                      isFavoriteLibrary={isFavoriteLibrary}
                      isMasonry={true}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
