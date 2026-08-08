/**
 * 音频查看器组件
 * 使用 wavesurfer.js 显示波形可视化，支持交互式定位和播放控制
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Play, Pause, Volume2 } from 'lucide-react'

interface AudioViewerProps {
  src: string
  filename: string
}

export function AudioViewer({ src, filename }: AudioViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isReady, setIsReady] = useState(false)

  // 初始化 wavesurfer
  useEffect(() => {
    if (!containerRef.current || !src) return

    // 销毁旧实例
    wavesurferRef.current?.destroy()

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(255, 255, 255, 0.3)',
      progressColor: 'rgba(255, 255, 255, 0.8)',
      cursorColor: 'rgba(255, 255, 255, 0.9)',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      height: 120,
      normalize: true,
      backend: 'WebAudio',
      interact: true,
    })

    ws.load(src)

    ws.on('ready', () => {
      setIsReady(true)
      setDuration(ws.getDuration())
      ws.setVolume(volume)
    })

    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('timeupdate', (time: number) => setCurrentTime(time))
    ws.on('finish', () => setIsPlaying(false))

    wavesurferRef.current = ws

    return () => {
      ws.destroy()
      wavesurferRef.current = null
    }
  }, [src])

  // 同步音量
  useEffect(() => {
    wavesurferRef.current?.setVolume(volume)
  }, [volume])

  const togglePlay = useCallback(() => {
    wavesurferRef.current?.playPause()
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (duration > 0) {
      wavesurferRef.current?.seekTo(time / duration)
    }
  }, [duration])

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="audio-viewer flex flex-col items-center justify-center w-full h-full gap-6 p-8 box-border">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <MusicIcon />
        <span className="text-lg text-text-secondary max-w-[500px] truncate">{filename}</span>
      </div>

      {/* 波形区域 */}
      <div className="w-full max-w-[800px] min-h-[120px] rounded-md bg-canvas-raised overflow-hidden" ref={containerRef} />

      {/* 进度条 */}
      <div className="flex items-center gap-3 w-full max-w-[800px]">
        <span className="text-sm text-text-muted tabular-nums text-center w-10">{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
          className="audio-viewer-seek"
          disabled={!isReady}
        />
        <span className="text-sm text-text-muted tabular-nums text-center w-10">{formatTime(duration)}</span>
      </div>

      {/* 控制栏 */}
      <div className="flex items-center gap-6">
        <button
          onClick={togglePlay}
          className="audio-viewer-btn w-11 h-11 flex items-center justify-center rounded-full bg-overlay-lighter text-text-primary cursor-pointer transition-colors hover:bg-overlay-selected disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={!isReady}
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-text-muted" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="audio-viewer-volume-slider"
          />
        </div>
      </div>
    </div>
  )
}

function MusicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32" className="opacity-60 text-accent">
      <path d="M9 18V5l12-2v13"/>
      <circle cx="6" cy="18" r="3"/>
      <circle cx="18" cy="16" r="3"/>
    </svg>
  )
}
