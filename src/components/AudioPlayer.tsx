import { useEffect, useRef, useCallback } from 'react'
import { useAudioStore } from '../stores/audioStore'
import styles from './AudioPlayer.module.css'

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

    const audioSrc = currentAudio.src.startsWith('file://')
      ? currentAudio.src
      : `file://${currentAudio.src.replace(/\\/g, '/')}`

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
    <div className={styles.container}>
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      {/* 封面：CSS 波形 */}
      <div className={styles.cover}>
        <div className={styles.waveform}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className={styles.waveBar}
              style={{
                height: `${30 + Math.sin(i * 0.8) * 40 + Math.random() * 20}%`,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* 文件名 */}
      <div className={styles.info}>
        <div className={styles.name}>{currentAudio.name}</div>
      </div>

      {/* 进度条 */}
      <div className={styles.progressWrapper}>
        <span className={styles.time}>{formatTime(currentTime)}</span>
        <div className={styles.progress} ref={progressRef} onClick={handleProgressClick}>
          <div
            className={styles.progressFill}
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>
        <span className={styles.time}>{formatTime(duration)}</span>
      </div>

      {/* 控制按钮 */}
      <div className={styles.controls}>
        <button className={styles.btn} onClick={togglePlay} title={isPlaying ? '暂停' : '播放'}>
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="1" width="4" height="14" rx="1" />
              <rect x="10" y="1" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <polygon points="3,1 14,8 3,15" />
            </svg>
          )}
        </button>
      </div>

      {/* 音量 */}
      <div className={styles.volume}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
          <path d="M6 2L2 6H0v4h2l4 4V2z" />
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className={styles.volumeSlider}
        />
      </div>

      {/* 关闭 */}
      <button className={styles.closeBtn} onClick={stop} title="关闭播放器">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.22 4.22a1 1 0 011.42 0L8 6.59l2.36-2.37a1 1 0 111.42 1.42L9.41 8l2.37 2.36a1 1 0 01-1.42 1.42L8 9.41l-2.36 2.37a1 1 0 01-1.42-1.42L6.59 8 4.22 5.64a1 1 0 010-1.42z" />
        </svg>
      </button>
    </div>
  )
}
