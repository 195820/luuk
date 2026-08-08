import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import { ChevronRight, ChevronDown, Folder, FolderHeart, Trash2, Heart } from 'lucide-react'
import { useImageStore } from '../stores/imageStore'

export interface FolderTreeNode {
  path: string
  name: string
  imageCount: number
  children?: FolderTreeNode[]
  depth: number
  library_id?: number
  library_name?: string
}

interface FolderTreeProps {
  folders: FolderTreeNode[]
  selectedFolder?: string | null
  onFolderSelect?: (folderPath: string | null) => void
  libraryId?: number
  isFavoriteLibrary?: boolean
  onToggleFavoriteFolder?: (folderPath: string) => void
  onSwitchToSingleView?: () => void
}

export function FolderTree({
  folders,
  selectedFolder,
  onFolderSelect,
  libraryId,
  isFavoriteLibrary,
  onToggleFavoriteFolder,
  onSwitchToSingleView,
}: FolderTreeProps) {
  const checkIsFavoriteFolder = useImageStore(state => state.isFavoriteFolder)
  const favoriteViewMode = useImageStore(state => state.favoriteViewMode)
  const setFavoriteViewMode = useImageStore(state => state.setFavoriteViewMode)
  const setSelectedFavoriteFolder = useImageStore(state => state.setSelectedFavoriteFolder)

  // 点击单图收藏按钮时，清除选中的文件夹并切换到单图视图
  const handleSingleFavoriteClick = useCallback(() => {
    setFavoriteViewMode('single')
    setSelectedFavoriteFolder(null)
    onSwitchToSingleView?.()
  }, [setFavoriteViewMode, setSelectedFavoriteFolder, onSwitchToSingleView])

  if (folders.length === 0 && isFavoriteLibrary && favoriteViewMode === 'folder') {
    return (
      <div className="flex flex-col items-center justify-center py-6 px-4 text-text-muted">
        <p className="text-caption text-text-secondary m-0">暂无收藏的文件夹</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col p-2">
      {/* 收藏库中的标签页切换 */}
      {isFavoriteLibrary && (
        <div className="flex gap-1 p-1.5 mb-2 border-b border-border">
          <button
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-0.5 border rounded-sm text-text-muted text-micro cursor-pointer transition-all duration-150 hover:bg-overlay-light hover:text-text-secondary ${favoriteViewMode === 'folder' ? 'bg-overlay-selected text-text-primary border-border' : 'border-transparent'}`}
            onClick={() => setFavoriteViewMode('folder')}
            title="文件夹收藏"
          >
            <Folder size={14} />
            文件夹收藏
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-0.5 border rounded-sm text-text-muted text-micro cursor-pointer transition-all duration-150 hover:bg-overlay-light hover:text-text-secondary ${favoriteViewMode === 'single' ? 'bg-overlay-selected text-text-primary border-border' : 'border-transparent'}`}
            onClick={handleSingleFavoriteClick}
            title="单图收藏"
          >
            <Heart size={14} />
            单图收藏
          </button>
        </div>
      )}

      {/* 收藏库 - 文件夹收藏模式 - 不显示"全部图片"栏 */}
      {isFavoriteLibrary && favoriteViewMode === 'folder' ? (
        folders.map(folder => (
          <FolderTreeItem
            key={folder.path}
            node={folder}
            selectedFolder={selectedFolder}
            onFolderSelect={onFolderSelect}
            libraryId={libraryId}
            isFavoriteLibrary={isFavoriteLibrary}
            onToggleFavoriteFolder={onToggleFavoriteFolder}
            folderFavorited={libraryId ? checkIsFavoriteFolder(libraryId, folder.path) : false}
          />
        ))
      ) : /* 收藏库 - 单图收藏模式 */
      isFavoriteLibrary && favoriteViewMode === 'single' ? (
        <div className="py-4 text-center text-text-muted text-caption">
          <p className="m-0">单图收藏将在右侧网格视图中显示</p>
        </div>
      ) : (
        /* 普通库模式 - 显示文件夹树 */
        <>
          <div
            className={`flex items-center gap-2 px-3 py-1.5 mx-2 mb-2 rounded-sm cursor-pointer user-select-none transition-all duration-150 border border-border font-medium bg-canvas-tertiary text-text-primary hover:bg-canvas-elevated hover:border-border-hover ${selectedFolder === null ? 'bg-overlay-selected border-border-hover' : ''}`}
            onClick={() => onFolderSelect?.(null)}
          >
            <Folder size={16} className="w-4 h-4 flex-shrink-0 opacity-80 text-text-muted" />
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body text-text-primary">全部图片</span>
            <span className="text-micro text-text-muted px-2 py-0.5 bg-canvas-tertiary rounded-full flex-shrink-0 border border-border tabular-nums transition-all duration-150">
              {folders.reduce((sum, f) => sum + f.imageCount, 0)}
            </span>
          </div>
          {folders.map(folder => (
            <FolderTreeItem
              key={folder.path}
              node={folder}
              selectedFolder={selectedFolder}
              onFolderSelect={onFolderSelect}
              libraryId={libraryId}
              isFavoriteLibrary={isFavoriteLibrary}
              onToggleFavoriteFolder={onToggleFavoriteFolder}
              folderFavorited={libraryId ? checkIsFavoriteFolder(libraryId, folder.path) : false}
            />
          ))}
        </>
      )}
    </div>
  )
}

interface FolderTreeItemProps {
  node: FolderTreeNode
  selectedFolder?: string | null
  onFolderSelect?: (folderPath: string | null) => void
  libraryId?: number
  isFavoriteLibrary?: boolean
  onToggleFavoriteFolder?: (folderPath: string) => void
  folderFavorited?: boolean
}

function FolderTreeItem({
  node,
  selectedFolder,
  onFolderSelect,
  libraryId,
  isFavoriteLibrary,
  onToggleFavoriteFolder,
  folderFavorited,
}: FolderTreeItemProps) {
  const checkIsFavoriteFolder = useImageStore(state => state.isFavoriteFolder)
  const [isExpanded, setIsExpanded] = useState(true)

  const hasChildren = node.children && node.children.length > 0
  const isSelected = selectedFolder === node.path

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onFolderSelect?.(node.path)
  }, [node.path, onFolderSelect])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasChildren) {
      setIsExpanded(!isExpanded)
    }
  }, [hasChildren, isExpanded])

  const handleFavoriteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (libraryId && onToggleFavoriteFolder) {
      onToggleFavoriteFolder(node.path)
    }
  }, [libraryId, node.path, onToggleFavoriteFolder])

  return (
    <div className="flex flex-col">
      <div
        className={`flex items-center gap-2 px-3 py-1.5 mx-2 my-0.5 rounded-sm cursor-pointer user-select-none transition-all duration-150 border border-transparent hover:bg-overlay-light hover:border-border ${isSelected ? 'bg-overlay-selected border-border-hover' : ''}`}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        {hasChildren ? (
          <span
            className={`flex items-center justify-center w-4 h-4 text-text-muted cursor-pointer transition-all duration-150 hover:text-text-secondary ${isExpanded ? 'rotate-90' : 'rotate-0'}`}
            onClick={handleToggle}
          >
            <ChevronRight size={12} />
          </span>
        ) : (
          <span className="w-4 h-4" />
        )}
        <Folder size={16} className="w-4 h-4 flex-shrink-0 opacity-80 text-text-muted transition-opacity duration-150" />
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body text-text-secondary transition-colors duration-150" title={node.name}>
          {node.name}
        </span>
        <span className="text-micro text-text-muted px-2 py-0.5 bg-canvas-tertiary rounded-full flex-shrink-0 border border-border tabular-nums transition-all duration-150">
          {node.imageCount}
        </span>
        {/* 在收藏库中显示取消收藏按钮 */}
        {isFavoriteLibrary && onToggleFavoriteFolder && (
          <button
            className="flex items-center justify-center w-5 h-5 p-0 border-none bg-transparent text-text-muted cursor-pointer rounded-sm flex-shrink-0 transition-all duration-150 hover:bg-overlay-lighter hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            onClick={handleFavoriteClick}
            title="取消收藏文件夹"
          >
            <Trash2 size={12} />
          </button>
        )}
        {/* 在普通库中显示收藏/取消收藏按钮 */}
        {!isFavoriteLibrary && libraryId && onToggleFavoriteFolder && (
          <button
            className={`flex items-center justify-center w-5 h-5 p-0 border-none bg-transparent cursor-pointer rounded-sm flex-shrink-0 transition-all duration-150 hover:bg-overlay-lighter hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${folderFavorited ? 'text-favorite' : 'text-text-muted'}`}
            onClick={handleFavoriteClick}
            title={folderFavorited ? '取消收藏文件夹' : '收藏文件夹'}
          >
            <Heart size={12} fill={folderFavorited ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={motionPresets.panel}
          >
            {node.children!.map(child => (
              <FolderTreeItem
                key={child.path}
                node={child}
                selectedFolder={selectedFolder}
                onFolderSelect={onFolderSelect}
                libraryId={libraryId}
                isFavoriteLibrary={isFavoriteLibrary}
                onToggleFavoriteFolder={onToggleFavoriteFolder}
                folderFavorited={libraryId ? checkIsFavoriteFolder(libraryId, child.path) : false}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
