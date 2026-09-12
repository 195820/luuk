import { useState, useEffect } from 'react'
import { BarChart3 } from 'lucide-react'
import type { HistogramData } from '../types'

interface HistogramChartProps {
  libraryId: number
  imagePath: string
}

export function HistogramChart({ libraryId, imagePath }: HistogramChartProps) {
  const [histogram, setHistogram] = useState<HistogramData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState<'linear' | 'log'>('log')
  const [channel, setChannel] = useState<'rgb' | 'luminance'>('rgb')

  useEffect(() => {
    if (!libraryId || !imagePath) return

    setLoading(true)
    setError(null)

    window.electronAPI?.getImageHistogram(libraryId, imagePath)
      .then((res) => {
        if (res.success && res.data) {
          setHistogram(res.data)
        } else {
          setError(res.error || '直方图加载失败')
        }
      })
      .catch((err) => {
        setError((err as Error).message)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [libraryId, imagePath])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-text-dim text-xs">
        加载直方图...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32 text-error text-xs">
        {error}
      </div>
    )
  }

  if (!histogram) {
    return null
  }

  // 渲染单个通道的直方图
  const renderChannel = (data: number[], color: string) => {
    const max = Math.max(...data)
    const normalizedData = data.map(v => scale === 'log' ? Math.log(v + 1) : v)
    const maxNormalized = Math.max(...normalizedData)

    return (
      <svg viewBox="0 0 256 64" className="w-full h-16">
        {data.map((value, i) => {
          const height = scale === 'log'
            ? (Math.log(value + 1) / maxNormalized) * 64
            : (value / max) * 64
          return (
            <rect
              key={i}
              x={i}
              y={64 - height}
              width={1}
              height={height}
              fill={color}
              opacity={0.7}
            />
          )
        })}
      </svg>
    )
  }

  return (
    <div className="space-y-3">
      {/* 控制栏 */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-text-muted" />
          <span className="font-medium">直方图</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as any)}
            className="text-xs bg-overlay-lighter border border-border rounded px-2 py-1"
          >
            <option value="rgb">RGB</option>
            <option value="luminance">亮度</option>
          </select>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value as any)}
            className="text-xs bg-overlay-lighter border border-border rounded px-2 py-1"
          >
            <option value="log">对数</option>
            <option value="linear">线性</option>
          </select>
        </div>
      </div>

      {/* 直方图渲染 */}
      {channel === 'rgb' ? (
        <div className="relative h-16">
          <div className="absolute inset-0">{renderChannel(histogram.r, '#FF453A')}</div>
          <div className="absolute inset-0">{renderChannel(histogram.g, '#30D158')}</div>
          <div className="absolute inset-0">{renderChannel(histogram.b, '#64D2FF')}</div>
        </div>
      ) : (
        renderChannel(histogram.luminance, '#FFFFFF')
      )}

      {/* 统计信息 */}
      <div className="text-xs text-text-dim space-y-1">
        <div>总像素: {histogram.totalPixels.toLocaleString()}</div>
      </div>
    </div>
  )
}
