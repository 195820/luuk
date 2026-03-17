import './SortControl.css'

export type SortBy = 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height'
export type SortOrder = 'ASC' | 'DESC'

export interface SortOption {
  value: SortBy
  label: string
}

export const SORT_OPTIONS: SortOption[] = [
  { value: 'relative_path', label: '文件名' },
  { value: 'created_time', label: '创建时间' },
  { value: 'modified_time', label: '修改时间' },
  { value: 'file_size', label: '文件大小' },
  { value: 'width', label: '宽度' },
  { value: 'height', label: '高度' },
]

interface SortControlProps {
  sortBy: SortBy
  sortOrder: SortOrder
  onSortByChange: (sortBy: SortBy) => void
  onSortOrderChange: (order: SortOrder) => void
}

export function SortControl({ sortBy, sortOrder, onSortByChange, onSortOrderChange }: SortControlProps) {
  const handleSortByChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onSortByChange(e.target.value as SortBy)
  }

  const handleSortOrderChange = () => {
    onSortOrderChange(sortOrder === 'ASC' ? 'DESC' : 'ASC')
  }

  return (
    <div className="sort-control">
      <span className="sort-label">排序:</span>
      <select
        value={sortBy}
        onChange={handleSortByChange}
        className="sort-select"
        title="选择排序字段"
      >
        {SORT_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        onClick={handleSortOrderChange}
        className="sort-order-btn"
        title={sortOrder === 'ASC' ? '升序' : '降序'}
      >
        {sortOrder === 'ASC' ? '↑' : '↓'}
      </button>
    </div>
  )
}
