import { useState, useCallback } from 'react'
import './FolderTree.css'

export interface FolderTreeNode {
  path: string
  name: string
  imageCount: number
  children?: FolderTreeNode[]
  depth: number
}

interface FolderTreeProps {
  folders: FolderTreeNode[]
  selectedFolder?: string | null
  onFolderSelect?: (folderPath: string | null) => void
}

export function FolderTree({ folders, selectedFolder, onFolderSelect }: FolderTreeProps) {
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
        />
      ))}
    </div>
  )
}

interface FolderTreeNodeProps {
  node: FolderTreeNode
  selectedFolder?: string | null
  onFolderSelect?: (folderPath: string | null) => void
}

function FolderTreeNode({ node, selectedFolder, onFolderSelect }: FolderTreeNodeProps) {
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
      </div>
      {hasChildren && isExpanded && (
        <div className="folder-tree-children">
          {node.children!.map(child => (
            <FolderTreeNode
              key={child.path}
              node={child}
              selectedFolder={selectedFolder}
              onFolderSelect={onFolderSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
