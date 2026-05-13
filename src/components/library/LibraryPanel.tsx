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
        <h3>📁 库管理</h3>
        <button onClick={onClose} className="close-btn">×</button>
      </div>
      <div className="library-panel-content">
        <button onClick={onAddLibrary} className="add-library-btn">
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
                  <span className="library-path">{lib.root_path}</span>
                  <span className="library-status">
                    状态：{lib.status === 'online' ? '🟢 在线' : '🔴 离线'} | {lib.image_count} 张
                  </span>
                </div>
                <div className="library-item-actions">
                  <button onClick={() => onScanLibrary(lib.id)} className="scan-btn">
                    🔄 扫描
                  </button>
                  <button onClick={() => onRemoveLibrary(lib)} className="remove-btn">
                    🗑 删除
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
