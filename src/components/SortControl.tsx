import { ArrowUp, ArrowDown } from 'lucide-react'

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
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-secondary">排序:</span>
      <select
        value={sortBy}
        onChange={handleSortByChange}
        className="bg-canvas-tertiary border border-border rounded-md px-2 py-1 text-xs text-text-secondary cursor-pointer outline-none hover:border-border-hover"
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
        className="w-7 h-7 flex items-center justify-center border border-border rounded-md bg-transparent text-text-secondary cursor-pointer transition-colors duration-150 hover:bg-overlay-light hover:text-text-primary"
        title={sortOrder === 'ASC' ? '升序' : '降序'}
      >
        {sortOrder === 'ASC' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>
    </div>
  )
}
