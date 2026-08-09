import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import { BarChart3 } from 'lucide-react'

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
    const unsubscribe = (window as any).electronAPI?.onScanProgress?.((newProgress: ScanProgressData) => {
      setProgress(newProgress)

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

  if (!progress || (!progress.isScanning && progress.status !== 'scanning')) {
    return null
  }

  const percentage = progress.totalCount > 0
    ? Math.round((progress.processedCount / progress.totalCount) * 100)
    : 0

  const currentFileName = progress.currentFile.split(/[/\\]/).pop() || progress.currentFile

  return (
    <div className="fixed inset-0 bg-overlay-darkest backdrop-blur-sm flex items-center justify-center z-[9999]">
      <motion.div
        className="bg-dialog rounded-2xl p-6 min-w-[400px] max-w-[600px] shadow-lg border border-glass-border backdrop-blur-md"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={motionPresets.fade}
      >
        <div className="mb-5">
          <h3 className="m-0 text-lg font-semibold text-text-primary tracking-wide flex items-center gap-2">
            <BarChart3 size={20} className="text-accent" />
            正在扫描图片库...
          </h3>
        </div>

        <div className="text-text-secondary">
          <div className="flex justify-between mb-2 text-sm tabular-nums">
            <span>进度：{progress.processedCount} / {progress.totalCount}</span>
            <span>{percentage}%</span>
          </div>

          <div className="w-full h-1.5 bg-canvas-tertiary rounded-full overflow-hidden mb-3 border border-border">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="text-xs text-text-muted whitespace-nowrap overflow-hidden text-ellipsis font-mono">
            正在处理：{currentFileName}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
