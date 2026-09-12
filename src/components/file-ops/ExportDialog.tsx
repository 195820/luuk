import { useState, useEffect } from 'react'
import { X, Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import type { ExportOptions, ExportProgress } from '../../types'

interface ExportDialogProps {
  isOpen: boolean
  onClose: () => void
  libraryId: number
  selectedPaths: string[]  // 相对路径数组
}

export function ExportDialog({ isOpen, onClose, libraryId, selectedPaths }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportOptions['format']>('original')
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined)
  const [quality, setQuality] = useState<number>(90)
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 监听导出进度
  useEffect(() => {
    if (!isOpen) return

    const unsubscribe = window.electronAPI?.onExportProgress((prog: ExportProgress) => {
      setProgress(prog)
      if (prog.finished) {
        setIsExporting(false)
        setCompleted(true)
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [isOpen])

  // 重置状态
  useEffect(() => {
    if (isOpen) {
      setFormat('original')
      setMaxWidth(undefined)
      setQuality(90)
      setIsExporting(false)
      setProgress(null)
      setCompleted(false)
      setError(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleExport = async () => {
    if (selectedPaths.length === 0) {
      setError('未选择图片')
      return
    }

    setIsExporting(true)
    setError(null)
    setCompleted(false)

    // 生成任务 ID
    const taskId = `export-${Date.now()}`

    try {
      // 选择输出目录
      const destResult = await window.electronAPI?.selectDestinationFolder(libraryId)
      if (!destResult || typeof destResult === 'object' && 'error' in destResult) {
        setError(destResult?.error || '取消选择')
        setIsExporting(false)
        return
      }

      const outputPath = destResult as string

      if (selectedPaths.length === 1) {
        // 单图导出
        const options: ExportOptions = {
          format,
          maxWidth,
          quality,
          outputPath,
        }
        const result = await window.electronAPI?.exportSingleImage(
          libraryId,
          selectedPaths[0],
          options,
          taskId
        )
        if (!result?.success) {
          setError(result?.error || '导出失败')
        } else {
          setCompleted(true)
        }
        setIsExporting(false)
      } else {
        // 批量导出为 ZIP
        const zipPath = `${outputPath}/export-${Date.now()}.zip`
        const options: ExportOptions = {
          format,
          maxWidth,
          quality,
          outputPath: zipPath,
        }
        const result = await window.electronAPI?.exportBatchImages(
          libraryId,
          selectedPaths,
          options,
          taskId
        )
        if (!result?.success) {
          setError(result?.error || '导出失败')
        }
        setIsExporting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsExporting(false)
    }
  }

  const handleCancel = async () => {
    if (isExporting && progress) {
      await window.electronAPI?.cancelExport(progress.taskId)
    }
    setIsExporting(false)
    setProgress(null)
  }

  const progressPercent = progress ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-l2 rounded-lg shadow-2xl border border-border w-full max-w-md mx-4">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Download size={20} />
            导出图片
          </h2>
          <button
            className="btn-icon-sm"
            onClick={onClose}
            disabled={isExporting}
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4 space-y-4">
          {/* 选择数量 */}
          <div className="text-sm text-text-secondary">
            已选择 <span className="font-semibold text-text-primary">{selectedPaths.length}</span> 张图片
          </div>

          {/* 格式选择 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              导出格式
            </label>
            <select
              className="input-glass w-full"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportOptions['format'])}
              disabled={isExporting}
            >
              <option value="original">原始格式</option>
              <option value="jpg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </div>

          {/* 尺寸调整 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              最大宽度（可选）
            </label>
            <input
              type="number"
              className="input-glass w-full"
              placeholder="保持原始尺寸"
              value={maxWidth ?? ''}
              onChange={(e) => setMaxWidth(e.target.value ? Number(e.target.value) : undefined)}
              disabled={isExporting}
              min={100}
              max={10000}
            />
          </div>

          {/* 质量调节（仅 JPG/WEBP） */}
          {(format === 'jpg' || format === 'webp') && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                质量: {quality}%
              </label>
              <input
                type="range"
                className="w-full"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                disabled={isExporting}
              />
            </div>
          )}

          {/* 进度条 */}
          {isExporting && progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">导出进度</span>
                <span className="text-text-primary font-mono">
                  {progress.done} / {progress.total} ({progressPercent}%)
                </span>
              </div>
              <div className="w-full bg-canvas-tertiary rounded-full h-2 overflow-hidden">
                <div
                  className="bg-accent h-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* 完成状态 */}
          {completed && (
            <div className="flex items-center gap-2 text-green-500">
              <CheckCircle size={18} />
              <span className="text-sm font-medium">导出完成</span>
            </div>
          )}

          {/* 错误状态 */}
          {error && (
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          {isExporting ? (
            <>
              <button
                className="btn-secondary flex items-center gap-2"
                onClick={handleCancel}
              >
                取消
              </button>
              <button
                className="btn-primary flex items-center gap-2"
                disabled
              >
                <Loader2 size={16} className="animate-spin" />
                导出中...
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-secondary"
                onClick={onClose}
              >
                {completed ? '关闭' : '取消'}
              </button>
              {!completed && (
                <button
                  className="btn-primary flex items-center gap-2"
                  onClick={handleExport}
                  disabled={selectedPaths.length === 0}
                >
                  <Download size={16} />
                  导出
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
