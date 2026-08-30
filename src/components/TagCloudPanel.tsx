import { useEffect, useCallback } from 'react'
import { X, Tag } from 'lucide-react'
import { useTagStore } from '@/stores/tagStore'
import { useSearchStore } from '@/stores/searchStore'

interface TagCloudPanelProps {
  libraryId: number
  onClose: () => void
}

export function TagCloudPanel({ libraryId, onClose }: TagCloudPanelProps) {
  const tags = useTagStore(s => s.tags)
  const loadTags = useTagStore(s => s.loadTags)
  const searchByTags = useSearchStore(s => s.searchByTags)
  const currentTagIds = useSearchStore(s => s.criteria.tagIds)

  useEffect(() => {
    loadTags(libraryId)
  }, [libraryId, loadTags])

  const handleTagClick = useCallback((tagId: number) => {
    const current = currentTagIds || []
    const next = current.includes(tagId)
      ? current.filter(id => id !== tagId)
      : [...current, tagId]

    if (next.length === 0) {
      onClose()
    } else {
      searchByTags(libraryId, next)
    }
  }, [libraryId, currentTagIds, searchByTags, onClose])

  const maxCount = tags.length > 0 ? Math.max(...tags.map(t => t.count)) : 1

  return (
    <div className="rounded-lg border border-border/30 bg-glass-l2 p-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-medium text-text-primary">标签云</h3>
          {currentTagIds && currentTagIds.length > 0 && (
            <span className="text-xs text-text-secondary">
              已选 {currentTagIds.length} 个
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent/10">
          <X className="h-4 w-4 text-text-secondary" />
        </button>
      </div>

      {/* 标签云 */}
      {tags.length === 0 ? (
        <p className="text-sm text-text-secondary text-center py-4">
          暂无标签，右键图片添加
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => {
            // 字号随计数变化：最小 0.75rem，最大 1.25rem
            const ratio = maxCount > 0 ? tag.count / maxCount : 0
            const fontSize = 0.75 + ratio * 0.5
            const opacity = 0.5 + ratio * 0.5
            const isSelected = currentTagIds?.includes(tag.id)

            return (
              <button
                key={tag.id}
                onClick={() => handleTagClick(tag.id)}
                className={`px-2 py-0.5 rounded-full transition-all ${
                  isSelected
                    ? 'ring-2 ring-accent'
                    : 'hover:bg-accent/10'
                }`}
                style={{
                  fontSize: `${fontSize}rem`,
                  opacity,
                  backgroundColor: isSelected ? `${tag.color}33` : `${tag.color}22`,
                  color: tag.color,
                }}
              >
                {tag.name}
                <span className="ml-1 text-xs opacity-60">{tag.count}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
