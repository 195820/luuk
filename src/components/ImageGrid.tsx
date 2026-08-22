import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatFileSize } from '../utils/format'
import { ImageGridItemComponent } from './ImageGridItem'
import { FileContextMenu } from './file-ops/FileContextMenu'
import { BatchRenameDialog } from './file-ops/BatchRenameDialog'
import { useImageStore } from '@/stores/imageStore'

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
  mediaType?: 'image' | 'video' | 'audio'
  duration?: number | null
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

  // 多选状态与右键菜单
  const { selectedPaths, toggleSelection } = useImageStore()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; imagePath: string } | null>(null)
  const [renameDialog, setRenameDialog] = useState<{ paths: string[] } | null>(null)

  // 过滤掉音频文件（音频在底部独立区域显示）
  const displayImages = images.filter((img) => {
    const mt = img.mediaType
    return mt !== 'audio'
  })
  const columns = Math.max(1, Math.floor(containerWidth / (thumbnailSize + 32)))
  const rowCount = Math.ceil(displayImages.length / columns)

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

  // Ctrl/Shift 多选点击处理
  const handleItemClick = useCallback((image: ImageGridItem, e: React.MouseEvent) => {
    if (e.ctrlKey || e.shiftKey) {
      e.preventDefault()
      if (image.imagePath) toggleSelection(image.imagePath)
      return
    }
    onImageClick?.(image)
  }, [onImageClick, toggleSelection])

  // 右键菜单处理
  const handleContextMenu = useCallback((image: ImageGridItem, e: React.MouseEvent) => {
    setContextMenu({ x: e.clientX, y: e.clientY, imagePath: image.imagePath || '' })
  }, [])

  // 菜单动作处理
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
        await window.electronAPI.deleteFiles(libraryId, pathsToDelete)
        await useImageStore.getState().loadImages()
        useImageStore.getState().clearSelection()
        break
      }
      case 'rename': {
        const pathsToRename = selectedPaths.size > 0 ? Array.from(selectedPaths) : [imagePath]
        setRenameDialog({ paths: pathsToRename })
        break
      }
    }
    setContextMenu(null)
  }, [contextMenu, libraryId, selectedPaths])

  return (
    <div
      ref={parentRef}
      className="w-full h-full overflow-auto p-4 bg-canvas"
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
          const endIndex = Math.min(startIndex + columns, displayImages.length)
          const rowImages = displayImages.slice(startIndex, endIndex)

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
                <ImageGridItemComponent
                  key={image.id}
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
                />
              ))}
            </div>
          )
        })}
      </div>
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={handleMenuAction}
          onClose={() => setContextMenu(null)}
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
