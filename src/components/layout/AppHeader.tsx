import { SortControl } from '../SortControl'
import type { Library } from '../../types'

interface AppHeaderProps {
  libraries: Library[]
  currentLibraryId: number | null
  favoriteCount: number
  totalImages: number
  viewMode: 'grid' | 'viewer'
  thumbnailSize: number
  imageSortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height'
  imageSortOrder: 'ASC' | 'DESC'
  gridLayoutMode: 'grid' | 'masonry'
  isFavoriteLibrary: boolean
  onToggleSidebar: () => void
  onLibraryChange: (value: string) => void
  onToggleLibraryPanel: () => void
  onThumbnailSizeChange: (size: number) => void
  onSortByChange: (sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height') => void
  onSortOrderChange: (order: 'ASC' | 'DESC') => void
  onGridLayoutChange: () => void
  onViewModeChange: () => void
}

export function AppHeader({
  libraries,
  currentLibraryId,
  favoriteCount,
  totalImages,
  viewMode,
  thumbnailSize,
  imageSortBy,
  imageSortOrder,
  gridLayoutMode,
  isFavoriteLibrary,
  onToggleSidebar,
  onLibraryChange,
  onToggleLibraryPanel,
  onThumbnailSizeChange,
  onSortByChange,
  onSortOrderChange,
  onGridLayoutChange,
  onViewModeChange,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <h1>📷 图片查看器</h1>
      <div className="header-actions">
        <button onClick={onToggleSidebar} className="folder-toggle-btn" title="切换文件夹面板 (F6)">
          📁
        </button>
        <div className="library-selector">
          <select
            value={currentLibraryId ?? ''}
            onChange={(e) => onLibraryChange(e.target.value)}
          >
            <option value="favorites">❤️ 收藏夹 ({favoriteCount})</option>
            <option value="" disabled>──────────</option>
            {libraries.map(lib => (
              <option key={lib.id} value={lib.id}>
                {lib.name} ({lib.status === 'online' ? '🟢 在线' : '🔴 离线'}) - {lib.image_count} 张
              </option>
            ))}
          </select>
          <button onClick={onToggleLibraryPanel} className="library-btn">
            📁 管理
          </button>
        </div>

        <span className="image-count">
          {isFavoriteLibrary
            ? `${favoriteCount} 张收藏图片`
            : currentLibraryId
              ? `${totalImages} 张图片`
              : '请先选择或添加库'
          }
        </span>

        {!isFavoriteLibrary && viewMode === 'grid' && currentLibraryId && (
          <div className="thumbnail-size-control">
            <label htmlFor="thumbnail-size">缩略图:</label>
            <input
              id="thumbnail-size"
              type="range"
              min="80"
              max="400"
              step="20"
              value={thumbnailSize}
              onChange={(e) => onThumbnailSizeChange(Number(e.target.value))}
            />
            <span>{thumbnailSize}px</span>
          </div>
        )}

        {viewMode === 'grid' && currentLibraryId && (
          <SortControl
            sortBy={imageSortBy}
            sortOrder={imageSortOrder}
            onSortByChange={onSortByChange}
            onSortOrderChange={onSortOrderChange}
          />
        )}

        {viewMode === 'grid' && currentLibraryId && (
          <button
            onClick={onGridLayoutChange}
            className="header-action-btn"
            title={gridLayoutMode === 'grid' ? '切换到瀑布流视图' : '切换到网格视图'}
          >
            {gridLayoutMode === 'grid' ? '▦ 网格' : '≣ 瀑布流'}
          </button>
        )}

        <button
          onClick={onViewModeChange}
          className="header-action-btn header-view-btn"
          disabled={isFavoriteLibrary ? favoriteCount === 0 : !currentLibraryId || totalImages === 0}
          title={viewMode === 'grid' ? '进入查看器 (F5)' : '返回网格视图 (F5)'}
        >
          {viewMode === 'grid' ? '▶ 查看' : '▦ 网格'}
        </button>
      </div>
    </header>
  )
}
