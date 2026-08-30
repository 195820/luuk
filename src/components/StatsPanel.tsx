import { useState, useEffect, useCallback } from 'react'
import { X, Loader2 } from 'lucide-react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatFileSize } from '@/utils/format'
import type { LibraryStats } from '@/types'

/** 图表配色（与液态玻璃暗色系协调） */
const CHART_COLORS = [
  '#3b82f6', '#22c55e', '#f97316', '#ef4444',
  '#8b5cf6', '#eab308', '#ec4899', '#06b6d4',
]

const TIMELINE_MONTH_LIMIT = 60

interface StatsPanelProps {
  libraryId: number
  libraryName: string
  onClose: () => void
}

export function StatsPanel({ libraryId, libraryName, onClose }: StatsPanelProps) {
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const result = await window.electronAPI.getLibraryStats(libraryId)
      if (result.success && result.data) {
        setStats(result.data)
      } else {
        setError(result.error || '加载失败')
      }
      setLoading(false)
    }
    load()
  }, [libraryId])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  // 格式分布（占比 <2% 合并为「其他」）
  const formatData = stats ? (() => {
    const total = stats.formats.reduce((s, f) => s + f.count, 0)
    if (total === 0) return []
    const main = stats.formats.filter(f => f.count / total >= 0.02)
    const other = stats.formats.filter(f => f.count / total < 0.02)
    const result = main.map(f => ({ name: f.format.toUpperCase(), value: f.count }))
    if (other.length > 0) {
      result.push({ name: '其他', value: other.reduce((s, f) => s + f.count, 0) })
    }
    return result
  })() : []

  // 时间线数据（截断最近 60 个月）
  const timelineData = stats
    ? stats.timeline.slice(-TIMELINE_MONTH_LIMIT).map(t => ({ month: t.month, count: t.count }))
    : []

  // 媒体类型概览
  const mediaOverview = stats?.mediaTypes.reduce((acc, m) => {
    acc[m.mediaType] = m.count
    return acc
  }, {} as Record<string, number>) ?? {}

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-[640px] max-h-[85vh] rounded-xl border border-border/40 bg-glass-l2 shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <h2 className="text-sm font-medium text-text-primary">
            库统计 — {libraryName}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent/10">
            <X className="h-4 w-4 text-text-secondary" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <span className="ml-2 text-sm text-text-secondary">加载中...</span>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive text-center py-8">{error}</p>
          )}
          {stats && !loading && (
            <div className="space-y-5">
              {/* 概览卡片 */}
              <div className="grid grid-cols-5 gap-3">
                <StatCard label="总数量" value={stats.total.toLocaleString()} />
                <StatCard label="总大小" value={formatFileSize(stats.totalSize)} />
                <StatCard label="图片" value={(mediaOverview.image ?? 0).toLocaleString()} />
                <StatCard label="视频" value={(mediaOverview.video ?? 0).toLocaleString()} />
                <StatCard label="音频" value={(mediaOverview.audio ?? 0).toLocaleString()} />
              </div>

              {/* 格式分布 */}
              {formatData.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-text-secondary mb-2">格式分布</h3>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={formatData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {formatData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: 'rgba(0,0,0,0.8)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* 图例 */}
                  <div className="flex flex-wrap gap-3 mt-2 justify-center">
                    {formatData.map((d, i) => (
                      <span key={d.name} className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        {d.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 月度时间线 */}
              {timelineData.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-text-secondary mb-2">
                    月度时间线
                    {stats.timeline.length > TIMELINE_MONTH_LIMIT && (
                      <span className="ml-2 text-text-dim">（显示最近 {TIMELINE_MONTH_LIMIT} 个月）</span>
                    )}
                  </h3>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={timelineData}>
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 10, fill: '#888' }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                        <Tooltip
                          contentStyle={{
                            background: 'rgba(0,0,0,0.8)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        />
                        <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {stats.total === 0 && (
                <p className="text-sm text-text-secondary text-center py-8">
                  库为空，无统计数据
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-glass-l3 border border-border/20 px-3 py-2 text-center">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="text-sm font-medium text-text-primary mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}
