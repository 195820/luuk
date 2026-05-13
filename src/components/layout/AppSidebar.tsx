import { FolderTree } from '../FolderTree'
import type { FolderTreeNode } from '../../types'

interface AppSidebarProps {
  folderSidebarOpen: boolean
  isFavoriteLibrary: boolean
  folderTree: FolderTreeNode[]
  favoriteFolderTree: FolderTreeNode[]
  selectedFolder: string | null
  currentLibraryId: number | null
  onToggleSidebar: () => void
  onFolderSelect: (folderPath: string | null) => void
  onToggleFavoriteFolder: (libraryId: number, folderPath: string) => void
  onSwitchToSingleView: () => void
}

export function AppSidebar({
  folderSidebarOpen,
  isFavoriteLibrary,
  folderTree,
  favoriteFolderTree,
  selectedFolder,
  currentLibraryId,
  onToggleSidebar,
  onFolderSelect,
  onToggleFavoriteFolder,
  onSwitchToSingleView,
}: AppSidebarProps) {
  if (!folderSidebarOpen || !currentLibraryId) {
    return null
  }

  return (
    <aside className="folder-sidebar">
      <div className="folder-sidebar-header">
        <span>📂 {isFavoriteLibrary ? '收藏的文件夹' : '文件夹'}</span>
        <button onClick={onToggleSidebar} className="close-sidebar-btn">×</button>
      </div>
      <div className="folder-sidebar-content">
        {isFavoriteLibrary ? (
          <FolderTree
            folders={favoriteFolderTree}
            selectedFolder={selectedFolder}
            onFolderSelect={onFolderSelect}
            libraryId={-1}
            isFavoriteLibrary={true}
            onToggleFavoriteFolder={(folderPath) => {
              // 在收藏库中，需要找到原始的 library_id
              const folder = favoriteFolderTree.find(f => f.path === folderPath)
              if (folder && folder.library_id) {
                onToggleFavoriteFolder(folder.library_id, folderPath)
              }
            }}
            onSwitchToSingleView={onSwitchToSingleView}
          />
        ) : (
          <FolderTree
            folders={folderTree}
            selectedFolder={selectedFolder}
            onFolderSelect={onFolderSelect}
            libraryId={currentLibraryId}
            isFavoriteLibrary={false}
            onToggleFavoriteFolder={(folderPath) => {
              if (currentLibraryId) {
                onToggleFavoriteFolder(currentLibraryId, folderPath)
              }
            }}
          />
        )}
      </div>
    </aside>
  )
}
