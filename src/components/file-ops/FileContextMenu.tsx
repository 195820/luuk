import { useEffect, useRef } from 'react'
import { Pencil, FolderInput, Copy, Image as WallpaperIcon, Trash2, FolderSearch, ClipboardCopy, ScanSearch, Tag, Columns2, Download, FolderHeart, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MenuItemDefinition } from '../../types/plugin'
import { usePluginStore } from '../../stores/pluginStore'

interface FileContextMenuProps {
  x: number
  y: number
  onAction: (action: string) => void
  onClose: () => void
  /** 对比项是否可用（恰好选中 2 张图片时） */
  compareEnabled?: boolean
  /** 插件贡献的动态菜单项（已由宿主注入 pluginId） */
  pluginMenuItems?: MenuItemDefinition[]
  /** 当前上下文：用于按 item.context 过滤插件菜单项 */
  context?: 'grid-multi' | 'grid-single' | 'folder' | 'viewer'
}

export function FileContextMenu({ x, y, onAction, onClose, compareEnabled, pluginMenuItems, context }: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  // [P2-17] op 可用性选择器（区分隐藏与置灰需下载模型）
  const getOpAvailability = usePluginStore((s) => s.getOpAvailability)

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

  const allItems = [
    { id: 'rename', label: '重命名', icon: Pencil, shortcut: 'F2' },
    { id: 'move', label: '移动到...', icon: FolderInput },
    { id: 'copy', label: '复制到...', icon: Copy },
    { id: 'export', label: '导出为...', icon: Download },
    { id: 'showInExplorer', label: '在资源管理器中显示', icon: FolderSearch },
    { id: 'copyPath', label: '复制路径', icon: ClipboardCopy },
    { id: 'setWallpaper', label: '设为壁纸', icon: WallpaperIcon },
    { id: 'setFolderCover', label: '设为文件夹封面', icon: FolderHeart },
    { id: 'findSimilar', label: '查找相似图片', icon: ScanSearch },
    { id: 'tag', label: '标签...', icon: Tag },
    { id: 'compare', label: '对比', icon: Columns2, shortcut: '' },
    { type: 'separator' as const },
    { id: 'delete', label: '移入回收站', icon: Trash2, shortcut: 'Delete', variant: 'destructive' },
  ]

  // 过滤对比项：仅在 compareEnabled 时显示
  const items = allItems.filter(item => {
    if ('id' in item && item.id === 'compare') return compareEnabled
    return true
  })

  // 插件贡献项：按当前上下文过滤（缺省视为多选网格）+ [P2-17] 可用性过滤（不满足三条件则隐藏）
  const ctx = context ?? 'grid-multi'
  const pluginItems = (pluginMenuItems ?? [])
    .filter((m) => m.context.includes(ctx))
    .map((m) => ({ m, avail: getOpAvailability(m.pluginId ?? '', m.op) }))
    .filter((x) => x.avail.visible)

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
      {pluginItems.length > 0 && (
        <>
          <div className="my-1 h-px bg-border/40" />
          {pluginItems.map(({ m, avail }) => (
            <button
              key={`${m.pluginId}:${m.op}`}
              disabled={avail.needsModel}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-1.5 text-sm',
                avail.needsModel ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent/10',
              )}
              onClick={() => { if (avail.needsModel) return; onAction(`plugin:${m.pluginId}:${m.op}`); onClose() }}
            >
              <Wand2 className="h-4 w-4 text-accent" />
              <span className="flex-1 text-left">{m.label}</span>
              {avail.needsModel && <span className="text-xs text-muted-foreground">需下载模型</span>}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
