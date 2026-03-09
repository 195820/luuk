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
}

export function FolderTree({
  folders,
  selectedFolder,
  onFolderSelect,
  libraryId,
  isFavoriteLibrary,
  onToggleFavoriteFolder,
}: FolderTreeProps) {
  const checkIsFavoriteFolder = useImageStore(state => state.isFavoriteFolder)

  const handleSelectRoot = useCallback(() => {
    onFolderSelect?.(null)
  }, [onFolderSelect])

  if (folders.length === 0) {
    return (
      <div className="folder-tree-empty">
        <p>暂无文件夹</p>
      </div>
    )
  }

  return (
    <div className="folder-tree">
      <div
        className={`folder-tree-item root ${selectedFolder === null ? 'selected' : ''}`}
        onClick={handleSelectRoot}
      >
        <span className="folder-icon">📁</span>
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
            {isExpanded ? '▼' : '▶'}
          </span>
        ) : (
          <span className="folder-toggle-placeholder" />
        )}
        <span className="folder-icon">📁</span>
        <span className="folder-name" title={node.name}>
          {node.name}
        </span>
        <span className="folder-count">{node.imageCount}</span>
        {/* 在收藏库中显示取消收藏按钮 */}
        {isFavoriteLibrary && onToggleFavoriteFolder && (
          <button
            className="folder-favorite-btn"
            onClick={handleFavoriteClick}
            title="取消收藏文件夹"
          >
            🗑
          </button>
        )}
        {/* 在普通库中显示收藏/取消收藏按钮 */}
        {!isFavoriteLibrary && libraryId && onToggleFavoriteFolder && (
          <button
            className={`folder-favorite-btn ${folderFavorited ? 'favorited' : ''}`}
            onClick={handleFavoriteClick}
            title={folderFavorited ? '取消收藏文件夹' : '收藏文件夹'}
          >
            {folderFavorited ? '⭐' : '☆'}
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
