/**
 * 缓存管理面板
 * 显示内存/磁盘占用，可调整上限，可一键清空
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Trash2, X } from 'lucide-react'

interface CachePanelProps {
  onClose: () => void
}

interface CacheStats {
  memory: { count: number; sizeMB: number; maxSizeMB: number; utilization: number }
  disk: { thumbsDbSizeMB: number }
}

const LIMIT_MIN = 100
const LIMIT_MAX = 1000
const LIMIT_STEP = 100

export function CachePanel({ onClose }: CachePanelProps) {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [maxMB, setMaxMB] = useState(200)
  const [sliderValue, setSliderValue] = useState(200)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const sliderChangedRef = useRef(false)

  // 加载统计与配置
  const refresh = useCallback(async () => {
    setLoading(true)
    const [statsResult, config] = await Promise.all([
      window.electronAPI.getCacheStats(),
      window.electronAPI.getCacheConfig(),
    ])
    setStats(statsResult)
    setMaxMB(config.maxMemoryMB)
    setSliderValue(config.maxMemoryMB)
    sliderChangedRef.current = false
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // 滑块失焦时保存
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSliderValue(Number(e.target.value))
    sliderChangedRef.current = true
  }

  const handleSliderCommit = async () => {
    if (!sliderChangedRef.current) return
    await window.electronAPI.setCacheLimit(sliderValue)
    setMaxMB(sliderValue)
    sliderChangedRef.current = false
    // 刷新统计（setMaxSize 可能修剪了缓存）
    const newStats = await window.electronAPI.getCacheStats()
    setStats(newStats)
  }

  const handleClear = async () => {
    setClearing(true)
    await window.electronAPI.clearCache()
    const newStats = await window.electronAPI.getCacheStats()
    setStats(newStats)
    setClearing(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[420px] rounded-xl border border-border/40 bg-glass-l2 shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h3 className="text-body font-semibold tracking-tight">缓存管理</h3>
          <button onClick={onClose} className="btn-icon-sm" title="关闭"><X size={14} /></button>
        </div>

        <div className="p-4 space-y-5">
          {loading && !stats ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : stats && (
            <>
              {/* 内存占用 */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-text-secondary">内存缓存</span>
                  <span className="tabular-nums text-text-primary">
                    {stats.memory.sizeMB.toFixed(1)} / {stats.memory.maxSizeMB.toFixed(0)} MB
                    <span className="text-text-muted ml-1.5">({stats.memory.count} 项)</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-border/30 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, stats.memory.utilization)}%`,
                      background: stats.memory.utilization > 80
                        ? 'linear-gradient(90deg, #ef4444, #f97316)'
                        : 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                    }}
                  />
                </div>
                <div className="text-[10px] text-text-muted mt-1 tabular-nums">
                  使用率 {stats.memory.utilization.toFixed(1)}%
                </div>
              </div>

              {/* 磁盘占用 */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text-secondary">磁盘缓存（缩略图数据库）</span>
                  <span className="tabular-nums text-text-primary">
                    {stats.disk.thumbsDbSizeMB.toFixed(1)} MB
                  </span>
                </div>
              </div>

              {/* 上限滑块 */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-text-secondary">内存上限</span>
                  <span className="tabular-nums text-text-primary">{maxMB} MB</span>
                </div>
                <input
                  type="range"
                  min={LIMIT_MIN}
                  max={LIMIT_MAX}
                  step={LIMIT_STEP}
                  value={sliderValue}
                  onChange={handleSliderChange}
                  onBlur={handleSliderCommit}
                  onMouseUp={handleSliderCommit}
                  className="w-full h-1.5 rounded-full appearance-none bg-border/30 accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-text-muted mt-0.5 tabular-nums">
                  <span>{LIMIT_MIN} MB</span>
                  <span>{LIMIT_MAX} MB</span>
                </div>
              </div>

              {/* 清空按钮 */}
              <button
                onClick={handleClear}
                disabled={clearing || stats.memory.count === 0}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-border/40 bg-glass-l3 text-sm hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {clearing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                清空内存缓存
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
