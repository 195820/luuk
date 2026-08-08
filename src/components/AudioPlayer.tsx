import { useEffect, useRef, useCallback } from 'react'
import { useAudioStore } from '../stores/audioStore'
import { Play, Pause, Volume2, X } from 'lucide-react'

export function AudioPlayer() {
  const {
    currentAudio,
    isPlaying,
    currentTime,
    duration,
    volume,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    setTime,
    setDuration,
  } = useAudioStore()

  const audioRef = useRef<HTMLAudioElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  // Sync audio element with store
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentAudio) return

    // src 已经是 media:// 协议 URL，直接使用
    const audioSrc = currentAudio.src

    if (audio.src !== audioSrc) {
      audio.src = audioSrc
      audio.load()
    }

    audio.volume = volume
    if (isPlaying) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [currentAudio])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    isPlaying ? audio.play().catch(() => {}) : audio.pause()
  }, [isPlaying])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current
    if (audio) setTime(audio.currentTime)
  }, [setTime])

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current
    if (audio) setDuration(audio.duration)
  }, [setDuration])

  const handleEnded = useCallback(() => {
    pause()
  }, [pause])

  const togglePlay = useCallback(() => {
    isPlaying ? pause() : resume()
  }, [isPlaying, pause, resume])

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = progressRef.current
    if (!el || !duration) return
    const rect = el.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    seek(Math.max(0, Math.min(duration, ratio * duration)))
    if (audioRef.current) audioRef.current.currentTime = ratio * duration
  }, [duration, seek])

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  if (!currentAudio) return null

  return (
    <div className="glass-l2 fixed bottom-12 left-1/2 -translate-x-1/2 w-96 px-4 py-3 flex flex-col gap-2 z-50">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      <div className="flex items-center gap-3">
        {/* 封面：CSS 波形 */}
        <div className="w-9 h-9 rounded-md bg-overlay-lighter flex items-center justify-center overflow-hidden flex-shrink-0">
          <div className="flex items-center gap-[2px] h-[70%] w-[70%]">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="w-0.5 rounded-sm bg-text-secondary"
                style={{
                  height: `${30 + Math.sin(i * 0.8) * 40 + Math.random() * 20}%`,
                }}
              />
            ))}
          </div>
        </div>

        {/* 文件名 */}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary truncate">{currentAudio.name}</div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted tabular-nums w-9 flex-shrink-0">{formatTime(currentTime)}</span>
        <div
          className="flex-1 h-1.5 bg-overlay-lighter rounded-full cursor-pointer relative hover:h-2 transition-all"
          ref={progressRef}
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-accent rounded-full transition-[width] duration-100"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>
        <span className="text-xs text-text-muted tabular-nums w-9 flex-shrink-0">{formatTime(duration)}</span>
      </div>

      {/* 控制按钮 + 音量 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            className="w-8 h-8 flex items-center justify-center rounded-full bg-transparent text-text-primary cursor-pointer hover:bg-overlay-lighter transition-colors"
            onClick={togglePlay}
            title={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Volume2 size={14} className="text-text-secondary" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="audio-volume-slider"
          />
        </div>

        <button
          className="w-7 h-7 flex items-center justify-center rounded-sm bg-transparent text-text-primary cursor-pointer hover:bg-overlay-lighter transition-colors"
          onClick={stop}
          title="关闭播放器"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
