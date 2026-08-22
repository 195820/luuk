import { useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { formatFileSize } from '@/utils/format'
import type { DeletedFileRecord } from '@/types'

/** 回收站查询上限 */
const RECYCLE_BIN_LIMIT = 500

/** 回收站视图：只读展示已删除文件记录（不支持恢复） */
export function RecycleBinView() {
  const [files, setFiles] = useState<DeletedFileRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      try {
        const data = await window.electronAPI.getDeletedFiles(RECYCLE_BIN_LIMIT)
        if (!cancelled) setFiles(data)
      } catch (err) {
        console.error('[RecycleBinView] 加载回收站数据失败:', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border/40">
        <Trash2 size={18} className="text-text-secondary" />
        <h2 className="text-lg font-semibold text-text-primary m-0">回收站</h2>
        <span className="text-sm text-text-muted">（{files.length} 项，不支持恢复）</span>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-text-muted text-sm">加载中...</div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <Trash2 size={48} className="opacity-30 mb-3" />
            <span className="text-sm">回收站为空</span>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map(file => (
              <div
                key={file.id}
                className="p-3 rounded-lg border border-border/40 bg-canvas-tertiary transition-colors duration-150 hover:border-border"
              >
                <div className="font-mono text-sm text-text-primary truncate" title={file.original_path}>
                  {file.original_path}
                </div>
                <div className="text-xs text-text-muted mt-1.5 flex items-center gap-2">
                  <span>{new Date(file.deleted_at).toLocaleString()}</span>
                  <span className="text-border">·</span>
                  <span>{formatFileSize(file.file_size)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
