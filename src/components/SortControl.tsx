import { ArrowUp, ArrowDown } from 'lucide-react'
import { useViewStore } from '../stores/viewStore'
import type { GroupBy } from '../utils/group'

export type SortBy = 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height' | 'rating'
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
  { value: 'rating', label: '评分' },
]

export const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: 'none', label: '不分组' },
  { value: 'day', label: '按日' },
  { value: 'month', label: '按月' },
  { value: 'format', label: '按格式' },
  { value: 'aspect', label: '按纵横比' },
]

interface SortControlProps {
  sortBy: SortBy
  sortOrder: SortOrder
  onSortByChange: (sortBy: SortBy) => void
  onSortOrderChange: (order: SortOrder) => void
}

export function SortControl({ sortBy, sortOrder, onSortByChange, onSortOrderChange }: SortControlProps) {
  const groupBy = useViewStore(state => state.groupBy)
  const setGroupBy = useViewStore(state => state.setGroupBy)

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
        className="h-8 pl-2 pr-6 bg-glass-l1 border border-border rounded-md text-xs text-text-secondary cursor-pointer outline-none hover:border-border-hover"
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
        className="btn-icon-sm"
        title={sortOrder === 'ASC' ? '升序' : '降序'}
      >
        {sortOrder === 'ASC' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>

      <span className="text-xs text-text-secondary ml-2">分组:</span>
      <select
        value={groupBy}
        onChange={(e) => setGroupBy(e.target.value as GroupBy)}
        className="h-8 pl-2 pr-6 bg-glass-l1 border border-border rounded-md text-xs text-text-secondary cursor-pointer outline-none hover:border-border-hover"
        title="选择分组方式"
      >
        {GROUP_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
