import { useEffect, useRef } from 'react'
import { Pencil, FolderInput, Copy, Image as WallpaperIcon, Trash2, FolderSearch, ClipboardCopy, ScanSearch } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileContextMenuProps {
  x: number
  y: number
  onAction: (action: string) => void
  onClose: () => void
}

export function FileContextMenu({ x, y, onAction, onClose }: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  const items = [
    { id: 'rename', label: '重命名', icon: Pencil, shortcut: 'F2' },
    { id: 'move', label: '移动到...', icon: FolderInput },
    { id: 'copy', label: '复制到...', icon: Copy },
    { id: 'showInExplorer', label: '在资源管理器中显示', icon: FolderSearch },
    { id: 'copyPath', label: '复制路径', icon: ClipboardCopy },
    { id: 'setWallpaper', label: '设为壁纸', icon: WallpaperIcon },
    { id: 'findSimilar', label: '查找相似图片', icon: ScanSearch },
    { type: 'separator' as const },
    { id: 'delete', label: '移入回收站', icon: Trash2, shortcut: 'Delete', variant: 'destructive' },
  ]

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[200px] rounded-lg border border-border/40 bg-popover shadow-lg py-1"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 280) }}
    >
      {items.map((item, i) => {
        if ('type' in item && item.type === 'separator') return <div key={i} className="my-1 h-px bg-border/40" />
        const Icon = (item as any).icon
        return (
          <button
            key={(item as any).id}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-1.5 text-sm hover:bg-accent/10',
              (item as any).variant === 'destructive' && 'text-destructive hover:bg-destructive/10'
            )}
            onClick={() => { onAction((item as any).id); onClose() }}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1 text-left">{(item as any).label}</span>
            {(item as any).shortcut && <span className="text-xs text-muted-foreground">{(item as any).shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}
