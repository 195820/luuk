import { useEffect, useState } from 'react'
import './ScanProgress.css'

export interface ScanProgressData {
  isScanning: boolean
  currentFile: string
  processedCount: number
  totalCount: number
  status: string
}

export function ScanProgress() {
  const [progress, setProgress] = useState<ScanProgressData | null>(null)

  useEffect(() => {
    // 监听扫描进度事件
    const unsubscribe = (window as any).electronAPI?.onScanProgress?.((newProgress: ScanProgressData) => {
      setProgress(newProgress)
      
      // 如果是完成状态，3 秒后自动隐藏
      if (newProgress.status === 'complete' || !newProgress.isScanning) {
        setTimeout(() => {
          setProgress(null)
        }, 1000)
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  // 如果没有进度数据或不是扫描状态，不显示
  if (!progress || (!progress.isScanning && progress.status !== 'scanning')) {
    return null
  }

  const percentage = progress.totalCount > 0 
    ? Math.round((progress.processedCount / progress.totalCount) * 100) 
    : 0

  const currentFileName = progress.currentFile.split(/[/\\]/).pop() || progress.currentFile

  return (
    <div className="scan-progress-overlay">
      <div className="scan-progress-dialog">
        <div className="scan-progress-header">
          <h3>📊 正在扫描图片库...</h3>
        </div>
        
        <div className="scan-progress-body">
          <div className="progress-info">
            <span>进度：{progress.processedCount} / {progress.totalCount}</span>
            <span>{percentage}%</span>
          </div>
          
          <div className="progress-bar-container">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${percentage}%` }}
            />
          </div>
          
          <div className="current-file">
            正在处理：{currentFileName}
          </div>
        </div>
      </div>
    </div>
  )
}
