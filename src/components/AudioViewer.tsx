/**
 * 音频查看器组件
 * 使用 wavesurfer.js 显示波形可视化，支持交互式定位和播放控制
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import './AudioViewer.css'

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
    <div className="audio-viewer">
      <div className="audio-viewer-header">
        <svg className="audio-viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
        <span className="audio-viewer-filename">{filename}</span>
      </div>

      {/* 波形区域 */}
      <div className="audio-viewer-waveform" ref={containerRef} />

      {/* 进度条 */}
      <div className="audio-viewer-progress">
        <span className="audio-viewer-time">{formatTime(currentTime)}</span>
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
        <span className="audio-viewer-time">{formatTime(duration)}</span>
      </div>

      {/* 控制栏 */}
      <div className="audio-viewer-controls">
        <button onClick={togglePlay} className="audio-viewer-btn" disabled={!isReady} title={isPlaying ? '暂停' : '播放'}>
          {isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="1" width="4" height="14" rx="1"/>
              <rect x="10" y="1" width="4" height="14" rx="1"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <polygon points="3,1 14,8 3,15"/>
            </svg>
          )}
        </button>

        <div className="audio-viewer-volume">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
            <path d="M6 2L2 6H0v4h2l4 4V2z"/>
          </svg>
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
