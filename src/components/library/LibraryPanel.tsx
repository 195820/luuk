import { Database, RefreshCw, Trash2 } from 'lucide-react'
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
            {libraries.map(lib => (
              <li key={lib.id} className="library-item">
                <div className="library-item-info">
                  <strong>{lib.name}</strong>
                  <span className="library-path">{lib.rootPath}</span>
                  <span className="library-status">
                    状态：
                    <span className={lib.status === 'online' ? 'text-success' : 'text-error'}>
                      {lib.status === 'online' ? '● 在线' : '● 离线'}
                    </span>
                    {' | '}{lib.imageCount} 张
                  </span>
                </div>
                <div className="library-item-actions">
                  <button onClick={() => onScanLibrary(lib.id)} className="btn-icon-sm hover:text-success" title="扫描">
                    <RefreshCw size={12} />
                  </button>
                  <button onClick={() => onRemoveLibrary(lib)} className="btn-icon-sm hover:text-error" title="删除">
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
