import { useEffect, useState } from 'react'
import { Database, RefreshCw, Trash2, AlertCircle } from 'lucide-react'
import type { Library } from '../../types'

interface LibraryPanelProps {
  libraries: Library[]
  onClose: () => void
  onAddLibrary: () => void
  onRemoveLibrary: (lib: Library) => void
  onScanLibrary: (libId: number) => void
}

export function LibraryPanel({
  libraries,
  onClose,
  onAddLibrary,
  onRemoveLibrary,
  onScanLibrary,
}: LibraryPanelProps) {
  // 库状态映射（从 IPC 事件更新）
  const [statusMap, setStatusMap] = useState<Record<number, 'online' | 'offline'>>(() => {
    const map: Record<number, 'online' | 'offline'> = {}
    for (const lib of libraries) {
      map[lib.id] = lib.status || 'online'
    }
    return map
  })

  // 订阅库状态变更事件
  useEffect(() => {
    if (!window.electronAPI?.onLibraryStatusChanged) return

    const unsubscribe = window.electronAPI.onLibraryStatusChanged(({ id, status }) => {
      setStatusMap(prev => ({ ...prev, [id]: status }))
    })

    return unsubscribe
  }, [])

  // 同步 libraries 变更到 statusMap
  useEffect(() => {
    setStatusMap(prev => {
      const next = { ...prev }
      for (const lib of libraries) {
        if (!(lib.id in next)) {
          next[lib.id] = lib.status || 'online'
        }
      }
      return next
    })
  }, [libraries])

  const getLibraryStatus = (libId: number): 'online' | 'offline' => {
    return statusMap[libId] || 'offline'
  }

  return (
    <div className="library-panel">
      <div className="library-panel-header">
        <h3 className="flex items-center gap-2">
          <Database size={16} />
          库管理
        </h3>
        <button onClick={onClose} className="btn-icon-sm">×</button>
      </div>
      <div className="library-panel-content">
        <button onClick={onAddLibrary} className="btn-text primary w-full">
          + 添加库
        </button>
        {libraries.length === 0 ? (
          <p className="empty-hint">暂无库，点击"添加库"选择图片文件夹</p>
        ) : (
          <ul className="library-list">
            {libraries.map(lib => {
              const isOnline = getLibraryStatus(lib.id) === 'online'
              return (
                <li key={lib.id} className={`library-item ${!isOnline ? 'opacity-60' : ''}`}>
                  <div className="library-item-info">
                    <strong className="flex items-center gap-2">
                      {lib.name}
                      {!isOnline && <AlertCircle size={12} className="text-warning" aria-label="库不可达" />}
                    </strong>
                    <span className="library-path">{lib.rootPath}</span>
                    <span className="library-status">
                      状态：
                      <span className={isOnline ? 'text-success' : 'text-error'}>
                        {isOnline ? '● 在线' : '● 离线'}
                      </span>
                      {' | '}{lib.imageCount} 张
                    </span>
                  </div>
                  <div className="library-item-actions">
                    <button
                      onClick={() => onScanLibrary(lib.id)}
                      disabled={!isOnline}
                      className="btn-icon-sm hover:text-success disabled:opacity-40 disabled:cursor-not-allowed"
                      title={isOnline ? '扫描' : '库不可达，无法扫描'}
                    >
                      <RefreshCw size={12} />
                    </button>
                    <button
                      onClick={() => onRemoveLibrary(lib)}
                      className="btn-icon-sm hover:text-error"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
