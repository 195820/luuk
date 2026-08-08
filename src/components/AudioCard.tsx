import { useAudioStore } from '../stores/audioStore'
import styles from './AudioCard.module.css'

interface AudioCardProps {
  libraryId: number
  imageId: number
  name: string
  duration: number
  src: string
}

export function AudioCard({ libraryId, imageId, name, duration, src }: AudioCardProps) {
  const play = useAudioStore((s) => s.play)

  const formatDuration = (s: number) => {
    if (!s || !isFinite(s)) return '--:--'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const handleDoubleClick = async () => {
    let resolvedSrc = src
    if (!resolvedSrc) {
      try {
        // 先获取文件路径，再通过 media:// 协议生成安全 URL
        const fullPath = await window.electronAPI!.getMediaPath(libraryId, imageId)
        resolvedSrc = await window.electronAPI!.getMediaUrl(fullPath)
      } catch {
        return
      }
    }
    play(libraryId, imageId, resolvedSrc, name)
  }

  return (
    <div className={styles.card} onDoubleClick={handleDoubleClick}>
      <div className={styles.waveform}>
        {Array.from({ length: 20 }).map((_, i) => {
          const h = 20 + Math.abs(Math.sin(i * 0.5)) * 60 + Math.random() * 15
          return (
            <div
              key={i}
              className={styles.waveBar}
              style={{ height: `${h}%` }}
            />
          )
        })}
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{name}</div>
        <div className={styles.duration}>{formatDuration(duration)}</div>
      </div>
    </div>
  )
}
