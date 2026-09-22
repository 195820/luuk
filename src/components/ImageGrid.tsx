import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatFileSize } from '../utils/format'
import { ImageGridItemComponent } from './ImageGridItem'
import { FileContextMenu } from './file-ops/FileContextMenu'
import { BatchRenameDialog } from './file-ops/BatchRenameDialog'
import { ExportDialog } from './file-ops/ExportDialog'
import { TagDialog } from './TagDialog'
import { useImageStore } from '@/stores/imageStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useViewStore } from '@/stores/viewStore'
import { useSimilarStore } from '@/stores/similarStore'
import { useTagStore } from '@/stores/tagStore'
import { usePluginStore } from '@/stores/pluginStore'
import { applyFolderCoverSet } from '@/stores/folderCoverStore'
import { groupImages } from '../utils/group'

// 网格布局几何常量 —— 必须与下方行内联样式（flex gap / padding）保持一致，
// 否则虚拟滚动 estimateSize / columns 与真实渲染错位，会造成卡片间距过大与底部大块空白。
const GRID_GAP = 16 // 卡片间距（横向 flex gap，亦用作行下间距）
const GRID_ROW_PAD_X = 8 // 行内左右 padding（padding:'0 8px'）
const GRID_PARENT_PAD = 16 // 滚动容器 padding（p-4）

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
  /** 滚动到底部时触发（用于搜索结果分页加载） */
  onLoadMore?: () => void
  /** 是否还有更多数据可加载 */
  hasMore?: boolean
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
  onLoadMore,
  hasMore,
}: ImageGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const scrollRestoreRef = useRef<boolean>(true)

  // 多选状态与右键菜单
  const { selectedPaths, lastSelectedPath, toggleSelection, selectRange } = useSelectionStore()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; imagePath: string; image?: ImageGridItem } | null>(null)
  const [renameDialog, setRenameDialog] = useState<{ paths: string[] } | null>(null)
  const [exportDialog, setExportDialog] = useState<{ paths: string[] } | null>(null)

  // 分组状态
  const groupBy = useViewStore(state => state.groupBy)

  // 插件动态菜单（宿主注入 pluginId）
  const pluginMenuItems = usePluginStore(state => state.menuItems)
  const loadPluginState = usePluginStore(state => state.load)

  // 首次挂载时拉取插件菜单（仅当插件系统启用时才有数据）
  useEffect(() => {
    if (!usePluginStore.getState().loaded) void loadPluginState()
  }, [loadPluginState])

  // 过滤掉音频文件（音频在底部独立区域显示）
  const displayImages = useMemo(() => images.filter((img) => {
    const mt = img.mediaType
    return mt !== 'audio'
  }), [images])

  // 分组数据
  const groupedData = useMemo(() => {
    if (groupBy === 'none') return null
    return groupImages(displayImages, groupBy)
  }, [displayImages, groupBy])

  // 每行可容纳卡片数：行内可用宽 = 容器宽 - 父容器 padding(p-4) - 行左右 padding - 末张后的空余(gap)。
  // 旧公式用 thumbnailSize+60 作每项占位，远大于真实 "card + 16px gap"，导致列数偏少、网格稀疏。
  const columns = Math.max(
    1,
    Math.floor((containerWidth - GRID_PARENT_PAD * 2 - GRID_ROW_PAD_X * 2 + GRID_GAP) / (thumbnailSize + GRID_GAP)),
  )
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
    estimateSize: () => thumbnailSize + GRID_GAP,
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

  // P2-1: 方向感知缩略图批量预热——可视行区间变化时，向滚动方向前瞻若干行
  // 调用批量 getThumbnails（返回值丢弃），让主进程提前把 DB 读/sharp 生成填入 LRU，
  // 后续卡片挂载的单个 getThumbnail 直接命中，降低进入视口的等待。
  const vItems = virtualizer.getVirtualItems()
  const rangeStart = vItems.length ? vItems[0].index : 0
  const rangeEnd = vItems.length ? vItems[vItems.length - 1].index : -1
  const prevWarmRowRef = useRef(0)
  const lastWarmKeyRef = useRef('')
  useEffect(() => {
    if (rangeEnd < rangeStart || columns === 0 || isFavoriteLibrary || !libraryId) return
    const dir = rangeStart >= prevWarmRowRef.current ? 1 : -1
    prevWarmRowRef.current = rangeStart
    const ahead = 4 // 前瞻 4 行
    const loRow = dir >= 0 ? rangeStart : Math.max(0, rangeStart - ahead)
    const hiRow = dir >= 0 ? Math.min(rowCount - 1, rangeEnd + ahead) : rangeEnd
    const lo = loRow * columns
    const hi = Math.min(displayImages.length, (hiRow + 1) * columns)
    const key = `${lo}:${hi}`
    if (key === lastWarmKeyRef.current) return
    lastWarmKeyRef.current = key
    const ids: number[] = []
    for (let i = lo; i < hi; i++) {
      const id = displayImages[i]?.id
      if (typeof id === 'number' && id > 0) ids.push(id)
    }
    if (ids.length) {
      window.electronAPI?.getThumbnails?.(libraryId, ids, 'medium')?.catch(() => {})
    }
  }, [rangeStart, rangeEnd, columns, displayImages, libraryId, isFavoriteLibrary, rowCount])

  // Ctrl/Shift 多选点击处理
  const handleItemClick = useCallback((image: ImageGridItem, e: React.MouseEvent) => {
    if (e.shiftKey && image.imagePath) {
      e.preventDefault()
      if (lastSelectedPath) {
        const allPaths = displayImages.map(img => img.imagePath || '').filter(Boolean)
        selectRange(lastSelectedPath, image.imagePath, allPaths)
      } else {
        // 首次 Shift+click 无锚点：选中当前项并设为锚点
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

  // 右键菜单处理
  const handleContextMenu = useCallback((image: ImageGridItem, e: React.MouseEvent) => {
    setContextMenu({ x: e.clientX, y: e.clientY, imagePath: image.imagePath || '', image })
  }, [])

  // 菜单动作处理
  const handleMenuAction = useCallback(async (action: string) => {
    if (!contextMenu) return
    const imagePath = contextMenu.imagePath

    // 插件贡献操作：plugin:<pluginId>:<op>
    if (action.startsWith('plugin:')) {
      const [, pluginId, op] = action.split(':')
      const relPaths = selectedPaths.size > 0 ? Array.from(selectedPaths) : [imagePath]

      // 后台批处理阈值：多选量超过此值改走持久化作业队列（P0-1）
      const BATCH_THRESHOLD = 20
      if (relPaths.length > BATCH_THRESHOLD) {
        // 相对路径 → imageId 映射，构造 jobsEnqueue 的 items（handler 侧再解析绝对路径）
        const pathToId = new Map<string, number>()
        for (const img of images) {
          if (img.imagePath && img.id != null) pathToId.set(img.imagePath, Number(img.id))
        }
        const items = relPaths.map((p) => ({ libraryId, imageId: pathToId.get(p) ?? null }))
        try {
          const res = await window.electronAPI.jobsEnqueue(`ai.${op}`, { op, pluginId }, { items })
          if (!res.success) {
            useImageStore.getState().setError(`后台作业入队失败: ${res.error}`)
          } else {
            // [S1] 用户感知：轻量提示 + JobProgressBar 依进度事件自动展示
            useImageStore.getState().setNotice(`已加入后台队列（${items.length} 项），可在底部进度面板查看`)
            useSelectionStore.getState().clearSelection()
          }
        } catch (err) {
          useImageStore.getState().setError(`后台作业入队异常: ${(err as Error).message}`)
        }
        setContextMenu(null)
        return
      }

      try {
        const abs = await Promise.all(
          relPaths.map((p) => window.electronAPI.getImagePathByRelativePath(libraryId, p)),
        )
        const paths = abs.filter((x): x is string => Boolean(x))
        const res = await window.electronAPI.pluginsExecute(pluginId, op, { paths, libraryId })
        if (!res.success) {
          useImageStore.getState().setError(`插件执行失败: ${res.error}`)
        } else {
          await useImageStore.getState().loadImages()
        }
      } catch (err) {
        useImageStore.getState().setError(`插件执行异常: ${(err as Error).message}`)
      }
      setContextMenu(null)
      return
    }

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
      case 'findSimilar': {
        if (contextMenu.image && contextMenu.image.imagePath) {
          useSimilarStore.getState().findSimilar(libraryId, contextMenu.image.imagePath, contextMenu.image)
        }
        break
      }
      case 'tag': {
        const pathsToTag = selectedPaths.size > 0 ? Array.from(selectedPaths) : [imagePath]
        useTagStore.getState().openDialog(pathsToTag)
        break
      }
      case 'compare': {
        const paths = selectedPaths.size === 2 ? Array.from(selectedPaths) : []
        if (paths.length === 2) {
          // 解析两张图的 media:// URL 和文件名
          const imgs = paths.map(p => displayImages.find(img => img.imagePath === p)).filter(Boolean) as ImageGridItem[]
          if (imgs.length === 2 && imgs.every(img => img.mediaType === 'image')) {
            const urls = await Promise.all(imgs.map(img => window.electronAPI.getMediaUrl(img.imagePath!)))
            const labels = imgs.map(img => (img.imagePath || '').split('/').pop() || '')
            window.dispatchEvent(new CustomEvent('compare-open', { detail: { images: urls, labels } }))
          }
        }
        break
      }
      case 'export': {
        const pathsToExport = selectedPaths.size > 0 ? Array.from(selectedPaths) : [imagePath]
        setExportDialog({ paths: pathsToExport })
        break
      }
      case 'setFolderCover': {
        // 提取图片所在文件夹路径（正斜杠格式）
        const folderPath = imagePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '') || '.'
        // 修复 DEF-COVER-01：使用统一封装，写入后端 + 同步 folderCoverStore，侧边栏自动刷新
        await applyFolderCoverSet(libraryId, folderPath, imagePath)
        break
      }
    }
    setContextMenu(null)
  }, [contextMenu, libraryId, selectedPaths, displayImages])

  return (
    <div
      ref={parentRef}
      className="w-full h-full overflow-auto p-4 bg-canvas"
    >
      {groupBy === 'none' || !groupedData ? (
        // 无分组：使用虚拟滚动
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
      ) : (
        // 有分组：直接渲染（非虚拟化）
        <div className="space-y-6">
          {groupedData.map((group) => (
            <div key={group.key}>
              <div className="sticky top-0 z-10 bg-glass-l1 backdrop-blur-md px-4 py-2 mb-3 rounded-lg border border-border">
                <h3 className="text-sm font-medium text-text-primary">
                  {group.label} <span className="text-text-muted">({group.items.length})</span>
                </h3>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: '16px',
                }}
              >
                {group.items.map((image) => (
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
            </div>
          ))}
        </div>
      )}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={handleMenuAction}
          onClose={() => setContextMenu(null)}
          pluginMenuItems={pluginMenuItems}
          context={selectedPaths.size > 1 ? 'grid-multi' : 'grid-single'}
          compareEnabled={(() => {
            if (selectedPaths.size !== 2) return false
            const paths = Array.from(selectedPaths)
            return paths.every(p => {
              const img = displayImages.find(img => img.imagePath === p)
              return img?.mediaType === 'image'
            })
          })()}
        />
      )}
      {renameDialog && (
        <BatchRenameDialog
          libraryId={libraryId}
          initialPaths={renameDialog.paths}
          onClose={() => setRenameDialog(null)}
        />
      )}
      {exportDialog && (
        <ExportDialog
          isOpen={true}
          onClose={() => setExportDialog(null)}
          libraryId={libraryId}
          selectedPaths={exportDialog.paths}
        />
      )}
      <TagDialogMount libraryId={libraryId} />
    </div>
  )
}

/** 标签对话框挂载点（读取全局 store 状态） */
function TagDialogMount({ libraryId }: { libraryId: number }) {
  const dialogOpen = useTagStore(s => s.dialogOpen)
  const closeDialog = useTagStore(s => s.closeDialog)
  if (!dialogOpen) return null
  return <TagDialog libraryId={libraryId} onClose={closeDialog} />
}
