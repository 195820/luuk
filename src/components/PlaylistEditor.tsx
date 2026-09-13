import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import {
  ListMusic,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  GripVertical,
} from 'lucide-react'
import { useSlideshowStore, type SavedPlaylist } from '@/stores/slideshowStore'
import { logger } from '@/utils/logger'

interface PlaylistEditorProps {
  isOpen: boolean
  onClose: () => void
  /** 当前库 ID（用于筛选可选图片） */
  libraryId: number
}

/**
 * 播放列表编辑器
 * - 创建/删除/重命名播放列表
 * - 拖拽排序播放列表项
 */
export function PlaylistEditor({ isOpen, onClose }: PlaylistEditorProps) {
  const savedPlaylists = useSlideshowStore(s => s.savedPlaylists)
  const activePlaylistId = useSlideshowStore(s => s.activePlaylistId)
  const savePlaylist = useSlideshowStore(s => s.savePlaylist)
  const loadPlaylist = useSlideshowStore(s => s.loadPlaylist)
  const deletePlaylist = useSlideshowStore(s => s.deletePlaylist)
  const renamePlaylist = useSlideshowStore(s => s.renamePlaylist)
  const reorderPlaylistItems = useSlideshowStore(s => s.reorderPlaylistItems)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // 当前选中的播放列表
  const currentPlaylist = savedPlaylists.find(p => p.id === activePlaylistId) || null

  // 开始重命名
  const startRename = useCallback((playlist: SavedPlaylist) => {
    setEditingId(playlist.id)
    setEditName(playlist.name)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  // 确认重命名
  const confirmRename = useCallback(() => {
    if (editingId && editName.trim()) {
      renamePlaylist(editingId, editName.trim())
    }
    setEditingId(null)
    setEditName('')
  }, [editingId, editName, renamePlaylist])

  // 取消重命名
  const cancelRename = useCallback(() => {
    setEditingId(null)
    setEditName('')
  }, [])

  // 创建新播放列表
  const handleCreate = useCallback(() => {
    if (!newName.trim()) return
    savePlaylist(newName.trim())
    setNewName('')
    setIsCreating(false)
  }, [newName, savePlaylist])

  // 删除播放列表
  const handleDelete = useCallback((id: string) => {
    deletePlaylist(id)
    if (activePlaylistId === id) {
      // 删除的是当前激活的播放列表，清空选择
      logger.info('PlaylistEditor', '已删除当前激活的播放列表')
    }
  }, [deletePlaylist, activePlaylistId])

  // 加载播放列表
  const handleLoad = useCallback((id: string) => {
    loadPlaylist(id)
  }, [loadPlaylist])

  // 拖拽开始
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  // 拖拽经过
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  // 拖拽结束
  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault()
    if (dragIndex === null || !currentPlaylist) return
    if (dragIndex !== toIndex) {
      reorderPlaylistItems(currentPlaylist.id, dragIndex, toIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, currentPlaylist, reorderPlaylistItems])

  // 拖拽取消
  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={motionPresets.panel}
        className="glass-l2 w-[480px] max-h-[80vh] flex flex-col rounded-xl border border-border shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ListMusic size={18} className="text-accent" />
            <h2 className="text-base font-medium text-text-primary">播放列表</h2>
          </div>
          <button
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-overlay-lighter transition-colors"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 保存的播放列表 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-secondary">已保存的列表</span>
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors"
                onClick={() => setIsCreating(true)}
              >
                <Plus size={12} />
                新建
              </button>
            </div>

            {/* 新建输入框 */}
            <AnimatePresence>
              {isCreating && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={motionPresets.fade}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="输入列表名称"
                    className="flex-1 h-8 px-3 bg-canvas-tertiary border border-border rounded-md text-sm text-text-primary outline-none focus:border-accent"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreate()
                      if (e.key === 'Escape') setIsCreating(false)
                    }}
                    autoFocus
                  />
                  <button
                    className="w-8 h-8 flex items-center justify-center rounded-md text-accent hover:bg-accent/10 transition-colors"
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-overlay-lighter transition-colors"
                    onClick={() => { setIsCreating(false); setNewName('') }}
                  >
                    <X size={14} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 列表项 */}
            {savedPlaylists.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-muted">
                暂无保存的播放列表
              </div>
            ) : (
              <div className="space-y-1">
                {savedPlaylists.map(playlist => (
                  <div
                    key={playlist.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                      activePlaylistId === playlist.id
                        ? 'bg-accent/10 border border-accent/30'
                        : 'hover:bg-overlay-lighter border border-transparent'
                    }`}
                  >
                    {/* 列表名称 */}
                    {editingId === playlist.id ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="flex-1 h-7 px-2 bg-canvas-tertiary border border-accent rounded text-sm text-text-primary outline-none"
                        onKeyDown={e => {
                          if (e.key === 'Enter') confirmRename()
                          if (e.key === 'Escape') cancelRename()
                        }}
                        onBlur={confirmRename}
                      />
                    ) : (
                      <span
                        className="flex-1 text-sm text-text-primary cursor-pointer"
                        onClick={() => handleLoad(playlist.id)}
                      >
                        {playlist.name}
                        <span className="ml-2 text-xs text-text-muted">
                          ({playlist.items.length} 项)
                        </span>
                      </span>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1">
                      {editingId === playlist.id ? (
                        <>
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded text-accent hover:bg-accent/10 transition-colors"
                            onClick={confirmRename}
                          >
                            <Check size={12} />
                          </button>
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-overlay-lighter transition-colors"
                            onClick={cancelRename}
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors"
                            onClick={() => startRename(playlist)}
                            title="重命名"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            onClick={() => handleDelete(playlist.id)}
                            title="删除"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 当前播放列表项（可拖拽排序） */}
          {currentPlaylist && currentPlaylist.items.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-border">
              <span className="text-sm font-medium text-text-secondary">
                当前列表: {currentPlaylist.name}
              </span>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {currentPlaylist.items.map((item, index) => (
                  <div
                    key={`${item.libraryId}-${item.imagePath}-${index}`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={e => handleDragOver(e, index)}
                    onDrop={e => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-move transition-colors ${
                      dragOverIndex === index
                        ? 'bg-accent/20 border border-accent/50'
                        : dragIndex === index
                        ? 'opacity-50 bg-overlay-lighter border border-border'
                        : 'bg-canvas-tertiary hover:bg-overlay-lighter border border-transparent'
                    }`}
                  >
                    <GripVertical size={14} className="text-text-muted flex-shrink-0" />
                    <span className="flex-1 text-sm text-text-primary truncate">
                      {item.imagePath.split('/').pop()}
                    </span>
                    <span className="text-xs text-text-muted">#{index + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border">
          <span className="text-xs text-text-muted">
            共 {savedPlaylists.length} 个播放列表
          </span>
          <button
            className="px-4 py-2 text-sm text-text-primary bg-overlay-lighter hover:bg-overlay rounded-md transition-colors"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </motion.div>
    </div>
  )
}
