import { useState, useEffect, useCallback } from 'react'
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
  const [hoveredBin, setHoveredBin] = useState<{ bin: number; value: number; x: number } | null>(null)

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

  // 鼠标移动时计算当前 bin
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGElement>) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = e.clientX - rect.left
    const bin = Math.floor((x / rect.width) * 256)
    if (bin >= 0 && bin < 256) {
      // 取当前显示通道的值
      const data = channel === 'luminance' ? histogram?.luminance : histogram?.r
      const value = data ? (data[bin] as number) : 0
      setHoveredBin({ bin, value, x: e.clientX })
    }
  }, [channel, histogram])

  const handleMouseLeave = useCallback(() => {
    setHoveredBin(null)
  }, [])

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
  const renderChannel = (data: Uint32Array | number[], color: string, opacity = 0.7) => {
    const max = Math.max(...Array.from(data))
    const normalizedData = Array.from(data).map(v => scale === 'log' ? Math.log(v + 1) : v)
    const maxNormalized = Math.max(...normalizedData)

    return (
      <svg
        viewBox="0 0 256 64"
        className="w-full h-16"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {Array.from(data).map((value, i) => {
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
              opacity={opacity}
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
          {histogram.downsampled && (
            <span className="text-amber-400 text-[10px]" title="图片超过 200 万像素，已降采样计算">
              已降采样
            </span>
          )}
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
      <div className="relative">
        {channel === 'rgb' ? (
          <div className="relative h-16">
            <div className="absolute inset-0">{renderChannel(histogram.r, '#FF453A', 0.5)}</div>
            <div className="absolute inset-0">{renderChannel(histogram.g, '#30D158', 0.5)}</div>
            <div className="absolute inset-0">{renderChannel(histogram.b, '#64D2FF', 0.5)}</div>
          </div>
        ) : (
          renderChannel(histogram.luminance, '#FFFFFF')
        )}

        {/* 悬停提示 */}
        {hoveredBin && (
          <div
            className="fixed z-50 px-2 py-1 text-[11px] font-mono bg-overlay-dark text-text-primary rounded shadow-lg pointer-events-none"
            style={{
              left: hoveredBin.x + 12,
              top: (document.querySelector('.relative.h-16')?.getBoundingClientRect().top || 0) - 24,
            }}
          >
            bin {hoveredBin.bin}: {hoveredBin.value.toLocaleString()}
          </div>
        )}
      </div>

      {/* 统计信息 */}
      <div className="text-xs text-text-dim space-y-1">
        <div>总像素: {histogram.totalPixels.toLocaleString()}</div>
      </div>
    </div>
  )
}
