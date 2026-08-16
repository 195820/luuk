import { useState, useEffect } from 'react'
import { Clock, Trash2 } from 'lucide-react'
import { useImageStore } from '../stores'
import type { HistoryItem } from '../types'

/**
 * 历史条目缩略图：使用条目所属库加载缩略图（跨库）
 */
function HistoryThumb({ item }: { item: HistoryItem }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    setSrc('')
    if (item.id) {
      window.electronAPI
        .getThumbnail(item.library_id, item.id, 'small')
        .then((url) => { if (!cancelled) setSrc(url) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [item.library_id, item.id])

  if (!src) {
    return (
      <div className="w-10 h-10 flex-shrink-0 rounded-md bg-canvas-tertiary border border-border flex items-center justify-center text-text-muted">
        <Clock size={14} />
      </div>
    )
  }
  return (
    <img src={src} alt="" className="w-10 h-10 flex-shrink-0 rounded-md border border-border object-cover" />
  )
}

interface RecentHistoryProps {
  history: HistoryItem[]
  onOpen: (item: HistoryItem) => void
  onClear: () => void
}

export function RecentHistory({ history, onOpen, onClear }: RecentHistoryProps) {
  const libraries = useImageStore((s) => s.libraries)

  return (
    <div className="border-t border-border mt-2 pt-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
          <Clock size={12} />
          最近浏览
        </span>
        {history.length > 0 && (
          <button onClick={onClear} className="btn-icon-sm" title="清空浏览历史">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <p className="text-xs text-text-muted px-1 py-2">暂无浏览记录</p>
      ) : (
        <ul className="list-none m-0 p-0">
          {history.map((item) => {
            const key = `${item.library_id}/${item.image_path}`
            const name = item.image_path.split('/').pop() || item.image_path
            const libraryName = item.library_name || libraries.find(l => l.id === item.library_id)?.name || '未知库'
            return (
              <li key={key}>
                <button
                  onClick={() => onOpen(item)}
                  className="w-full flex items-center gap-2 p-1 rounded-md text-left border border-transparent hover:bg-canvas-raised hover:border-border transition-colors duration-150"
                  title={item.image_path}
                >
                  <HistoryThumb item={item} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-text-primary truncate">{name}</span>
                    <span className="block text-[10px] text-text-muted truncate">{libraryName}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}