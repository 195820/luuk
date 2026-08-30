import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Pencil, Trash2, Check } from 'lucide-react'
import { useTagStore } from '@/stores/tagStore'
import type { Tag } from '@/types'

/** 预设颜色 */
const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#888888',
]

interface TagDialogProps {
  libraryId: number
  onClose: () => void
}

export function TagDialog({ libraryId, onClose }: TagDialogProps) {
  const targetPaths = useTagStore(s => s.targetPaths)
  const tags = useTagStore(s => s.tags)
  const loadTags = useTagStore(s => s.loadTags)
  const [activeTab, setActiveTab] = useState<'assign' | 'manage'>('assign')

  useEffect(() => {
    loadTags(libraryId)
  }, [libraryId, loadTags])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-[480px] max-h-[80vh] rounded-xl border border-border/40 bg-glass-l2 shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <h2 className="text-sm font-medium text-text-primary">
            标签 — {targetPaths.length} 个文件
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent/10">
            <X className="h-4 w-4 text-text-secondary" />
          </button>
        </div>

        {/* 标签页切换 */}
        <div className="flex border-b border-border/30">
          <button
            className={`flex-1 px-4 py-2 text-sm ${activeTab === 'assign' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'}`}
            onClick={() => setActiveTab('assign')}
          >
            分配标签
          </button>
          <button
            className={`flex-1 px-4 py-2 text-sm ${activeTab === 'manage' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'}`}
            onClick={() => setActiveTab('manage')}
          >
            管理标签
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'assign'
            ? <AssignTab libraryId={libraryId} tags={tags} onClose={onClose} />
            : <ManageTab libraryId={libraryId} tags={tags} />
          }
        </div>
      </div>
    </div>
  )
}

// ==================== 分配标签页 ====================

function AssignTab({ libraryId, tags, onClose }: {
  libraryId: number
  tags: Array<Tag & { count: number }>
  onClose: () => void
}) {
  const targetPaths = useTagStore(s => s.targetPaths)
  const loadTags = useTagStore(s => s.loadTags)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0])
  const [isSaving, setIsSaving] = useState(false)
  const [initialTagsLoaded, setInitialTagsLoaded] = useState(false)

  // 首次加载：如果目标只有一张图片，预勾选其已有标签
  useEffect(() => {
    if (initialTagsLoaded || targetPaths.length !== 1) {
      setInitialTagsLoaded(true)
      return
    }
    const loadInitial = async () => {
      const result = await window.electronAPI.getImageTags(libraryId, targetPaths[0])
      if (result.success && result.data) {
        setCheckedIds(new Set(result.data.map(t => t.id)))
      }
      setInitialTagsLoaded(true)
    }
    loadInitial()
  }, [libraryId, targetPaths, initialTagsLoaded])

  const toggleCheck = useCallback((id: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleCreateTag = useCallback(async () => {
    const name = newTagName.trim()
    if (!name) return
    const result = await window.electronAPI.createTag(name, newTagColor)
    if (result.success && result.data) {
      setCheckedIds(prev => new Set([...prev, result.data!.id]))
      setNewTagName('')
      await loadTags(libraryId)
    }
  }, [newTagName, newTagColor, libraryId, loadTags])

  const handleSave = useCallback(async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      // 所有勾选的标签都打标（INSERT OR IGNORE 保证幂等）
      const toAdd = [...checkedIds]
      // 未勾选的已有标签需要去标
      const toRemove = tags
        .filter(t => !checkedIds.has(t.id))
        .map(t => t.id)

      // 打标
      if (toAdd.length > 0) {
        await window.electronAPI.tagImages(toAdd, libraryId, targetPaths)
      }
      // 去标
      if (toRemove.length > 0) {
        await window.electronAPI.untagImages(toRemove, libraryId, targetPaths)
      }

      await loadTags(libraryId)
      onClose()
    } catch (err) {
      console.error('[TagDialog] 保存失败:', err)
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, checkedIds, tags, libraryId, targetPaths, loadTags, onClose])

  return (
    <div className="space-y-4">
      {/* 标签列表 */}
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {tags.length === 0 && (
          <p className="text-sm text-text-secondary py-4 text-center">
            暂无标签，在下方创建新标签
          </p>
        )}
        {tags.map(tag => (
          <label
            key={tag.id}
            className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-accent/5 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={checkedIds.has(tag.id)}
              onChange={() => toggleCheck(tag.id)}
              className="rounded border-border/40"
            />
            <span
              className="h-3 w-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: tag.color }}
            />
            <span className="text-sm text-text-primary flex-1">{tag.name}</span>
            <span className="text-xs text-text-secondary">{tag.count}</span>
          </label>
        ))}
      </div>

      {/* 新建标签 */}
      <div className="border-t border-border/30 pt-3 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="新建标签..."
            value={newTagName}
            onChange={e => setNewTagName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateTag()}
            className="flex-1 px-3 py-1.5 text-sm rounded border border-border/40 bg-glass-l3 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={handleCreateTag}
            disabled={!newTagName.trim()}
            className="px-3 py-1.5 text-sm rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {/* 颜色选择 */}
        <div className="flex gap-1.5">
          {PRESET_COLORS.map(color => (
            <button
              key={color}
              className={`h-5 w-5 rounded-full border-2 ${newTagColor === color ? 'border-white' : 'border-transparent'}`}
              style={{ backgroundColor: color }}
              onClick={() => setNewTagColor(color)}
            />
          ))}
        </div>
      </div>

      {/* 保存按钮 */}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full py-2 text-sm rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40 flex items-center justify-center gap-2"
      >
        <Check className="h-4 w-4" />
        保存
      </button>
    </div>
  )
}

// ==================== 管理标签页 ====================

function ManageTab({ libraryId, tags }: {
  libraryId: number
  tags: Array<Tag & { count: number }>
}) {
  const loadTags = useTagStore(s => s.loadTags)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  const startEdit = useCallback((tag: Tag) => {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return
    await window.electronAPI.renameTag(editingId, editName.trim(), editColor)
    setEditingId(null)
    await loadTags(libraryId)
  }, [editingId, editName, editColor, libraryId, loadTags])

  const handleDelete = useCallback(async (id: number, name: string) => {
    const confirmed = window.confirm(`确定删除标签「${name}」？关联的图片将失去此标签。`)
    if (!confirmed) return
    await window.electronAPI.deleteTag(id)
    await loadTags(libraryId)
  }, [libraryId, loadTags])

  return (
    <div className="space-y-1">
      {tags.length === 0 && (
        <p className="text-sm text-text-secondary py-4 text-center">暂无标签</p>
      )}
      {tags.map(tag => (
        <div
          key={tag.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/5"
        >
          {editingId === tag.id ? (
            <>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
                className="flex-1 px-2 py-0.5 text-sm rounded border border-border/40 bg-glass-l3 text-text-primary focus:outline-none focus:border-accent/50"
                autoFocus
              />
              <div className="flex gap-1">
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    className={`h-4 w-4 rounded-full border ${editColor === color ? 'border-white' : 'border-transparent'}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setEditColor(color)}
                  />
                ))}
              </div>
              <button onClick={handleSaveEdit} className="p-1 rounded hover:bg-accent/10">
                <Check className="h-3.5 w-3.5 text-accent" />
              </button>
              <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-accent/10">
                <X className="h-3.5 w-3.5 text-text-secondary" />
              </button>
            </>
          ) : (
            <>
              <span
                className="h-3 w-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <span className="text-sm text-text-primary flex-1">{tag.name}</span>
              <span className="text-xs text-text-secondary">{tag.count}</span>
              <button onClick={() => startEdit(tag)} className="p-1 rounded hover:bg-accent/10">
                <Pencil className="h-3.5 w-3.5 text-text-secondary" />
              </button>
              <button onClick={() => handleDelete(tag.id, tag.name)} className="p-1 rounded hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5 text-text-secondary hover:text-destructive" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
