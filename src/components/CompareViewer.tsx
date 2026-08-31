/**
 * 对比模式组件
 * 双图并排 / 滑块两种视图，共享变换同步
 * 不复用 YARL：自研受控变换面板，单一 {scale,tx,ty} 驱动双 <img>
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import {
  Columns2,
  SlidersHorizontal,
  RotateCw,
  X,
  ArrowLeftRight,
  Loader2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  INITIAL_TRANSFORM,
  zoomAt,
  panBy,
  type TransformState,
} from '@/utils/compare-transform'

interface CompareViewerProps {
  /** 两张对比图片（media:// URL） */
  images: [string, string]
  /** 文件名标签 */
  labels: [string, string]
  onClose: () => void
}

type ViewMode = 'side-by-side' | 'slider'

interface ImageLoadState {
  loaded: boolean
  naturalWidth: number
  naturalHeight: number
}

export function CompareViewer({ images, labels, onClose }: CompareViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side')
  const [transform, setTransform] = useState<TransformState>(INITIAL_TRANSFORM)
  const [swapped, setSwapped] = useState(false)
  const [sliderPos, setSliderPos] = useState(50)
  const [loadStates, setLoadStates] = useState<[ImageLoadState, ImageLoadState]>([
    { loaded: false, naturalWidth: 0, naturalHeight: 0 },
    { loaded: false, naturalWidth: 0, naturalHeight: 0 },
  ])

  // 拖拽状态
  const isPanningRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const isSliderDraggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const leftIdx = swapped ? 1 : 0
  const rightIdx = swapped ? 0 : 1
  const leftSrc = images[leftIdx]
  const rightSrc = images[rightIdx]
  const leftLabel = labels[leftIdx]
  const rightLabel = labels[rightIdx]

  // 获取已加载图片的尺寸（取左图为参考，用于平移钳制）
  const refWidth = loadStates[leftIdx]?.naturalWidth || 1920
  const refHeight = loadStates[leftIdx]?.naturalHeight || 1080

  const handleImageLoad = useCallback((index: 0 | 1, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setLoadStates(prev => {
      const next: [ImageLoadState, ImageLoadState] = [...prev]
      next[index] = { loaded: true, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }
      return next
    })
  }, [])

  // Esc 关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // 滚轮缩放（以光标为锚点）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top
    setTransform(prev => zoomAt(cursorX, cursorY, e.deltaY, prev))
  }, [])

  // 原生非被动 wheel 监听：React 合成事件的 preventDefault 在被动监听下无效（仅产生 console 警告）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent) => e.preventDefault()
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // 拖拽平移
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    isPanningRef.current = true
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return
    const dx = e.clientX - lastPosRef.current.x
    const dy = e.clientY - lastPosRef.current.y
    lastPosRef.current = { x: e.clientX, y: e.clientY }

    const container = containerRef.current
    if (!container) return
    const { width: cw, height: ch } = container.getBoundingClientRect()
    // 获取单面板尺寸（并排模式宽度减半）
    const panelW = viewMode === 'side-by-side' ? cw / 2 : cw
    setTransform(prev => panBy(dx, dy, prev, panelW, ch, refWidth, refHeight))
  }, [viewMode, refWidth, refHeight])

  const handlePointerUp = useCallback(() => {
    isPanningRef.current = false
  }, [])

  // 双击重置
  const handleDoubleClick = useCallback(() => {
    setTransform(INITIAL_TRANSFORM)
  }, [])

  // 滑块拖拽
  const handleSliderPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    isSliderDraggingRef.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handleSliderPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isSliderDraggingRef.current) return
    const rect = (e.currentTarget as HTMLElement).closest('.compare-slider-container')?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const pct = Math.min(100, Math.max(0, (x / rect.width) * 100))
    setSliderPos(pct)
  }, [])

  const handleSliderPointerUp = useCallback(() => {
    isSliderDraggingRef.current = false
  }, [])

  const zoomPercent = Math.round(transform.scale * 100)

  const allLoaded = loadStates[0].loaded && loadStates[1].loaded

  // 构建图片样式（共享变换）
  const imgStyle: React.CSSProperties = {
    transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
    transformOrigin: 'center center',
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain' as const,
    userSelect: 'none' as const,
    pointerEvents: 'none',
    transition: isPanningRef.current ? 'none' : 'transform 0.1s ease-out',
  }

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col bg-black/95"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionPresets.fade}
    >
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 glass-l2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('side-by-side')}
            className={`btn-icon-sm ${viewMode === 'side-by-side' ? 'bg-accent/20' : ''}`}
            title="并排模式"
          >
            <Columns2 size={16} />
          </button>
          <button
            onClick={() => setViewMode('slider')}
            className={`btn-icon-sm ${viewMode === 'slider' ? 'bg-accent/20' : ''}`}
            title="滑块模式"
          >
            <SlidersHorizontal size={16} />
          </button>
          <div className="w-px h-4 bg-border/40 mx-1" />
          <span className="text-xs text-muted-foreground tabular-nums min-w-[3rem]">
            {zoomPercent}%
          </span>
          <button
            onClick={() => setTransform(prev => {
              const center = containerRef.current?.getBoundingClientRect()
              const cx = center ? center.width / (viewMode === 'side-by-side' ? 4 : 2) : 400
              const cy = center ? center.height / 2 : 300
              return zoomAt(cx, cy, -100, prev)
            })}
            className="btn-icon-sm"
            title="缩小"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setTransform(prev => {
              const center = containerRef.current?.getBoundingClientRect()
              const cx = center ? center.width / (viewMode === 'side-by-side' ? 4 : 2) : 400
              const cy = center ? center.height / 2 : 300
              return zoomAt(cx, cy, 100, prev)
            })}
            className="btn-icon-sm"
            title="放大"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => setTransform(INITIAL_TRANSFORM)}
            className="btn-icon-sm"
            title="重置视图"
          >
            <RotateCw size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            onClick={() => setSwapped(s => !s)}
            className="btn-icon-sm"
            title="交换左右"
          >
            <ArrowLeftRight size={14} />
          </button>
          <button onClick={onClose} className="btn-icon-sm" title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 对比区域 */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden select-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: isPanningRef.current ? 'grabbing' : 'grab' }}
      >
        {!allLoaded && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {viewMode === 'side-by-side' ? (
          <div className="flex w-full h-full">
            <ComparePanel src={leftSrc} alt={leftLabel} style={imgStyle} onLoad={(e) => handleImageLoad(0, e)} label={leftLabel} />
            <div className="w-px bg-border/40" />
            <ComparePanel src={rightSrc} alt={rightLabel} style={imgStyle} onLoad={(e) => handleImageLoad(1, e)} label={rightLabel} />
          </div>
        ) : (
          <div className="compare-slider-container relative w-full h-full"
            onPointerMove={handleSliderPointerMove}
            onPointerUp={handleSliderPointerUp}
          >
            {/* 底层：左图 */}
            <ComparePanel src={leftSrc} alt={leftLabel} style={imgStyle} onLoad={(e) => handleImageLoad(0, e)} label={leftLabel} />
            {/* 上层：右图，用 clip-path 裁切 */}
            <div
              className="absolute inset-0"
              style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
            >
              <ComparePanel src={rightSrc} alt={rightLabel} style={imgStyle} onLoad={(e) => handleImageLoad(1, e)} label={rightLabel} />
            </div>
            {/* 分割条 */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-white/80 cursor-ew-resize z-20 hover:bg-white"
              style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
              onPointerDown={handleSliderPointerDown}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/90 shadow flex items-center justify-center">
                <ArrowLeftRight size={12} className="text-black" />
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** 单侧图片面板 */
function ComparePanel({
  src,
  alt,
  style,
  onLoad,
  label,
}: {
  src: string
  alt: string
  style: React.CSSProperties
  onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void
  label: string
}) {
  return (
    <div className="flex-1 relative flex items-center justify-center overflow-hidden h-full">
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={onLoad}
        style={style}
      />
      {/* 文件名标签 */}
      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 text-xs text-white/80 max-w-[50%] truncate">
        {label}
      </div>
    </div>
  )
}
