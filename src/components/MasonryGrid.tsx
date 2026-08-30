import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { ImageGridItemComponent } from './ImageGridItem'
import { FileContextMenu } from './file-ops/FileContextMenu'
import { BatchRenameDialog } from './file-ops/BatchRenameDialog'
import type { ImageGridItem } from './ImageGrid'
import { formatFileSize } from '../utils/format'
import { useImageStore } from '@/stores/imageStore'
import { useSelectionStore } from '@/stores/selectionStore'

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
  /** 滚动到底部时触发（用于搜索结果分页加载） */
  onLoadMore?: () => void
  /** 是否还有更多数据可加载 */
  hasMore?: boolean
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
  onLoadMore,
  hasMore,
}: MasonryGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [columnCount, setColumnCount] = useState(4)
  const [columns, setColumns] = useState<MasonryGridItem[][]>([])
  const [columnHeights, setColumnHeights] = useState<number[]>([])
  const [columnTops, setColumnTops] = useState<number[][]>([])
  const scrollRestoreRef = useRef<boolean>(true)

  // 多选 + 右键菜单
  const { selectedPaths, lastSelectedPath, toggleSelection, selectRange } = useSelectionStore()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; imagePath: string } | null>(null)
  const [renameDialog, setRenameDialog] = useState<{ paths: string[] } | null>(null)

  // 过滤掉音频文件（音频在底部独立区域显示）
  const displayImages = useMemo(() => images.filter((img) => {
    const mt = img.mediaType
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
    // 滚动到底部附近时触发加载更多（阈值 200px）
    if (parentRef.current && onLoadMore && hasMore) {
      const { scrollTop, scrollHeight, clientHeight } = parentRef.current
      if (scrollHeight - scrollTop - clientHeight < 200) {
        onLoadMore()
      }
    }
  }, [onScrollChange, onLoadMore, hasMore])

  useEffect(() => {
    const element = parentRef.current
    if (element) {
      element.addEventListener('scroll', handleScroll, { passive: true })
      return () => element.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  // 点击处理（Ctrl/Shift 多选）
  const handleItemClick = useCallback((image: ImageGridItem, e: React.MouseEvent) => {
    if (e.shiftKey && image.imagePath) {
      e.preventDefault()
      if (lastSelectedPath) {
        const allPaths = displayImages.map(img => img.imagePath || '').filter(Boolean)
        selectRange(lastSelectedPath, image.imagePath, allPaths)
      } else {
        toggleSelection(image.imagePath)
      }
      return
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      if (image.imagePath) toggleSelection(image.imagePath)
      return
    }
    onImageClick?.(image)
  }, [onImageClick, toggleSelection, selectRange, lastSelectedPath, displayImages])

  // 右键菜单
  const handleContextMenu = useCallback((image: ImageGridItem, e: React.MouseEvent) => {
    setContextMenu({ x: e.clientX, y: e.clientY, imagePath: image.imagePath || '' })
  }, [])

  // 菜单动作
  const handleMenuAction = useCallback(async (action: string) => {
    if (!contextMenu) return
    const imagePath = contextMenu.imagePath

    switch (action) {
      case 'copyPath':
        await navigator.clipboard.writeText(imagePath)
        break
      case 'setWallpaper':
        await window.electronAPI.setWallpaper(libraryId, imagePath)
        break
      case 'showInExplorer':
        await window.electronAPI.showInExplorer(libraryId, imagePath)
        break
      case 'delete': {
        const pathsToDelete = selectedPaths.size > 0 ? Array.from(selectedPaths) : [imagePath]
        const result = await window.electronAPI.deleteFiles(libraryId, pathsToDelete)
        if (result.failed.length > 0) {
          useImageStore.getState().setError(`${result.failed.length} 个文件删除失败：${result.failed[0].error}`)
        }
        await useImageStore.getState().loadImages()
        useSelectionStore.getState().clearSelection()
        break
      }
      case 'rename': {
        const pathsToRename = selectedPaths.size > 0 ? Array.from(selectedPaths) : [imagePath]
        setRenameDialog({ paths: pathsToRename })
        break
      }
      // move/copy 待后续实现
      default:
        break
    }
    setContextMenu(null)
  }, [contextMenu, libraryId, selectedPaths])

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
                left: `${columnIndex * (thumbnailSize + 8) + 8}px`,
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
                      isSelected={selectedId === image.id || (image.imagePath ? selectedPaths.has(image.imagePath) : false)}
                      onClick={handleItemClick}
                      onDoubleClick={onImageDoubleClick}
                      onToggleFavorite={onToggleFavorite}
                      onContextMenu={handleContextMenu}
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
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x} y={contextMenu.y}
          onAction={handleMenuAction} onClose={() => setContextMenu(null)}
        />
      )}
      {renameDialog && (
        <BatchRenameDialog
          libraryId={libraryId}
          initialPaths={renameDialog.paths}
          onClose={() => setRenameDialog(null)}
        />
      )}
    </div>
  )
}
