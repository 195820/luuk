import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Check, Pencil } from 'lucide-react'
import { useImageStore } from '@/stores/imageStore'
import type { BatchRenameResult } from '@/types'

interface BatchRenameDialogProps {
  libraryId: number
  /** 外部传入的文件路径列表（如右键单文件触发） */
  initialPaths?: string[]
  onClose: () => void
}

/** 默认重命名模式 */
const DEFAULT_PATTERN = '{name}_{counter}'

/** 解析路径：提取目录、文件名（不含扩展名）、扩展名 */
function parsePath(filePath: string) {
  const lastSlash = filePath.lastIndexOf('/')
  const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash) : ''
  const fullName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath
  const dotIndex = fullName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? fullName.substring(0, dotIndex) : fullName
  const ext = dotIndex > 0 ? fullName.substring(dotIndex) : ''
  return { dir, baseName, ext }
}

/** 根据模式和索引生成新文件名 */
function generateNewName(baseName: string, pattern: string, counter: number): string {
  return pattern
    .replace(/\{name\}/g, baseName)
    .replace(/\{counter\}/g, String(counter).padStart(3, '0'))
    .replace(/\{date\}/g, new Date().toISOString().slice(0, 10))
}

export function BatchRenameDialog({ libraryId, initialPaths, onClose }: BatchRenameDialogProps) {
  const selectedPaths = useImageStore(s => s.selectedPaths)
  const [pattern, setPattern] = useState(DEFAULT_PATTERN)
  const [startCounter, setStartCounter] = useState(1)
  const [renames, setRenames] = useState<Array<{ oldPath: string; newPath: string }>>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<BatchRenameResult | null>(null)
  const patternInputRef = useRef<HTMLInputElement>(null)

  // 获取待重命名的文件列表
  const paths = (initialPaths && initialPaths.length > 0)
    ? initialPaths
    : Array.from(selectedPaths)

  // 生成重命名预览
  useEffect(() => {
    const generated = paths.map((oldPath, index) => {
      const { dir, baseName, ext } = parsePath(oldPath)
      const newName = generateNewName(baseName, pattern, startCounter + index)
      const newPath = dir ? `${dir}/${newName}${ext}` : `${newName}${ext}`
      return { oldPath, newPath }
    })
    setRenames(generated)
  }, [pattern, startCounter, paths])

  // 点击遮罩关闭
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  // 执行重命名
  const handleConfirm = useCallback(async () => {
    if (renames.length === 0 || isExecuting) return
    setIsExecuting(true)
    try {
      const res = await window.electronAPI.batchRename(libraryId, renames)
      setResult(res)
      // 刷新数据
      await useImageStore.getState().loadImages()
      useImageStore.getState().clearSelection()
      // 延迟关闭，让用户看到结果
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      console.error('[BatchRenameDialog] 重命名失败:', err)
    } finally {
      setIsExecuting(false)
    }
  }, [libraryId, renames, isExecuting, onClose])

  // Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // 自动聚焦输入框
  useEffect(() => {
    patternInputRef.current?.focus()
  }, [])

  const failedCount = result ? result.failed.length : 0
  const succeededCount = result ? result.succeeded.length : 0

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-[560px] max-h-[80vh] flex flex-col bg-canvas border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Pencil size={16} className="text-text-secondary" />
            <h2 className="text-base font-semibold text-text-primary m-0">批量重命名</h2>
          </div>
          <button onClick={onClose} className="btn-icon-sm" title="关闭">
            <X size={14} />
          </button>
        </div>

        {/* 配置区 */}
        <div className="px-5 py-4 space-y-3 border-b border-border">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-text-secondary font-medium">重命名模式</label>
            <input
              ref={patternInputRef}
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="例: {name}_{counter}"
              className="h-9 px-3 rounded-md border border-border bg-canvas-tertiary text-sm text-text-primary font-mono outline-none transition-colors duration-150 focus:border-accent focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-3 text-xs text-text-muted">
              <span><code className="text-accent">{'{name}'}</code> 原始文件名</span>
              <span><code className="text-accent">{'{counter}'}</code> 序号</span>
              <span><code className="text-accent">{'{date}'}</code> 日期</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-secondary font-medium whitespace-nowrap">起始序号</label>
            <input
              type="number"
              min={1}
              value={startCounter}
              onChange={(e) => setStartCounter(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 h-8 px-2 rounded-md border border-border bg-canvas-tertiary text-sm text-text-primary text-center outline-none transition-colors duration-150 focus:border-accent"
            />
            <span className="text-xs text-text-muted">共 {paths.length} 个文件</span>
          </div>
        </div>

        {/* 预览列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-[120px] max-h-[300px]">
          {renames.length === 0 ? (
            <div className="text-center text-text-muted py-8 text-sm">没有选中文件</div>
          ) : (
            <div className="space-y-1">
              {renames.map((item, index) => {
                const oldName = item.oldPath.substring(item.oldPath.lastIndexOf('/') + 1)
                const newName = item.newPath.substring(item.newPath.lastIndexOf('/') + 1)
                const isChanged = oldName !== newName
                return (
                  <div
                    key={index}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${
                      isChanged ? 'bg-canvas-tertiary' : 'opacity-50'
                    }`}
                  >
                    <span className="flex-1 text-text-secondary font-mono truncate" title={oldName}>
                      {oldName}
                    </span>
                    <span className="text-text-muted">→</span>
                    <span
                      className={`flex-1 font-mono truncate ${
                        isChanged ? 'text-success' : 'text-text-muted'
                      }`}
                      title={newName}
                    >
                      {newName}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部操作区 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <div className="text-xs text-text-muted">
            {result ? (
              <span className={failedCount > 0 ? 'text-error' : 'text-success'}>
                {failedCount > 0
                  ? `成功 ${succeededCount} 个，失败 ${failedCount} 个`
                  : `全部成功（${succeededCount} 个）`}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-md text-sm text-text-secondary border border-border bg-canvas-tertiary transition-colors duration-150 hover:bg-canvas-raised hover:text-text-primary"
            >
              {result ? '关闭' : '取消'}
            </button>
            {!result && (
              <button
                onClick={handleConfirm}
                disabled={renames.length === 0 || isExecuting || !renames.some(r => r.oldPath.substring(r.oldPath.lastIndexOf('/') + 1) !== r.newPath.substring(r.newPath.lastIndexOf('/') + 1))}
                className="px-4 py-1.5 rounded-md text-sm text-text-primary bg-accent text-white transition-colors duration-150 hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Check size={14} />
                {isExecuting ? '执行中...' : '确认重命名'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
