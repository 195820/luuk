import { useState, useCallback } from 'react'
import { useImageStore } from '../stores/imageStore'
import './FolderTree.css'

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
      <div className="folder-tree-empty">
        <p>暂无收藏的文件夹</p>
      </div>
    )
  }

  return (
    <div className="folder-tree">
      {/* 收藏库中的标签页切换 */}
      {isFavoriteLibrary && (
        <div className="favorite-view-tabs">
          <button
            className={`tab-btn ${favoriteViewMode === 'folder' ? 'active' : ''}`}
            onClick={() => setFavoriteViewMode('folder')}
            title="文件夹收藏"
          >
            <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            文件夹收藏
          </button>
          <button
            className={`tab-btn ${favoriteViewMode === 'single' ? 'active' : ''}`}
            onClick={handleSingleFavoriteClick}
            title="单图收藏"
          >
            <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            单图收藏
          </button>
        </div>
      )}

      {/* 收藏库 - 文件夹收藏模式 - 不显示"全部图片"栏 */}
      {isFavoriteLibrary && favoriteViewMode === 'folder' ? (
        folders.map(folder => (
          <FolderTreeNode
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
        <div className="single-favorite-hint">
          <p>单图收藏将在右侧网格视图中显示</p>
        </div>
      ) : (
        /* 普通库模式 - 显示文件夹树 */
        <>
          <div
            className={`folder-tree-item root ${selectedFolder === null ? 'selected' : ''}`}
            onClick={() => onFolderSelect?.(null)}
          >
            <svg className="folder-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="folder-name">全部图片</span>
            <span className="folder-count">
              {folders.reduce((sum, f) => sum + f.imageCount, 0)}
            </span>
          </div>
          {folders.map(folder => (
            <FolderTreeNode
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

interface FolderTreeNodeProps {
  node: FolderTreeNode
  selectedFolder?: string | null
  onFolderSelect?: (folderPath: string | null) => void
  libraryId?: number
  isFavoriteLibrary?: boolean
  onToggleFavoriteFolder?: (folderPath: string) => void
  folderFavorited?: boolean
}

function FolderTreeNode({
  node,
  selectedFolder,
  onFolderSelect,
  libraryId,
  isFavoriteLibrary,
  onToggleFavoriteFolder,
  folderFavorited,
}: FolderTreeNodeProps) {
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
    <div className="folder-tree-node">
      <div
        className={`folder-tree-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        {hasChildren ? (
          <span
            className={`folder-toggle ${isExpanded ? 'expanded' : ''}`}
            onClick={handleToggle}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="toggle-arrow">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        ) : (
          <span className="folder-toggle-placeholder" />
        )}
        <svg className="folder-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span className="folder-name" title={node.name}>
          {node.name}
        </span>
        <span className="folder-count">{node.imageCount}</span>
        {/* 在收藏库中显示取消收藏按钮 */}
        {isFavoriteLibrary && onToggleFavoriteFolder && (
          <button
            className="folder-favorite-btn folder-remove-btn"
            onClick={handleFavoriteClick}
            title="取消收藏文件夹"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="remove-icon">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        )}
        {/* 在普通库中显示收藏/取消收藏按钮 */}
        {!isFavoriteLibrary && libraryId && onToggleFavoriteFolder && (
          <button
            className={`folder-favorite-btn ${folderFavorited ? 'favorited' : ''}`}
            onClick={handleFavoriteClick}
            title={folderFavorited ? '取消收藏文件夹' : '收藏文件夹'}
          >
            <svg viewBox="0 0 24 24" fill={folderFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" className="favorite-star">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          </button>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div className="folder-tree-children">
          {node.children!.map(child => (
            <FolderTreeNode
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
        </div>
      )}
    </div>
  )
}
