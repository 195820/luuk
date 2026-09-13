import { ArrowUp, ArrowDown } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

  const handleSortOrderChange = () => {
    onSortOrderChange(sortOrder === 'ASC' ? 'DESC' : 'ASC')
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-xs text-text-secondary shrink-0">排序:</span>
      <Select value={sortBy} items={SORT_OPTIONS} onValueChange={(v) => onSortByChange(v as SortBy)}>
        <SelectTrigger size="sm" className="border border-border bg-glass-l1 text-xs text-text-secondary hover:border-border-hover transition-colors duration-150">
          <SelectValue placeholder="排序" />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map(option => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        onClick={handleSortOrderChange}
        className="btn-icon-sm"
        title={sortOrder === 'ASC' ? '升序' : '降序'}
      >
        {sortOrder === 'ASC' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>

      <span className="text-xs text-text-secondary ml-1 shrink-0">分组:</span>
      <Select value={groupBy} items={GROUP_OPTIONS} onValueChange={(v) => setGroupBy(v as GroupBy)}>
        <SelectTrigger size="sm" className="border border-border bg-glass-l1 text-xs text-text-secondary hover:border-border-hover transition-colors duration-150">
          <SelectValue placeholder="分组" />
        </SelectTrigger>
        <SelectContent>
          {GROUP_OPTIONS.map(option => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}