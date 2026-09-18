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
    <div className="fixed bottom-12 right-4 z-[9999] pointer-events-none">
      <motion.div
        className="glass-l2 border border-border rounded-lg px-4 py-3 min-w-[300px] max-w-[420px] shadow-glass-lg pointer-events-auto"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={motionPresets.fade}
      >
        <div className="mb-2">
          <h3 className="m-0 text-body font-semibold text-text-primary tracking-wide flex items-center gap-2">
            <BarChart3 size={14} className="text-accent animate-pulse" />
            正在后台扫描图片库…
          </h3>
        </div>

        <div className="text-text-secondary">
          <div className="flex justify-between mb-1.5 text-xs tabular-nums">
            <span>{progress.processedCount} / {progress.totalCount}</span>
            <span>{percentage}%</span>
          </div>

          <div className="w-full h-1 bg-canvas-tertiary rounded-full overflow-hidden mb-2 border border-border">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="text-xs text-text-muted whitespace-nowrap overflow-hidden text-ellipsis font-mono max-w-[380px]">
            {currentFileName}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
