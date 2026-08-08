import { useAudioStore } from '../stores/audioStore'
import { Music } from 'lucide-react'

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
    <div
      className="glass-l1 p-3 flex items-center gap-3 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-glass flex-shrink-0 w-40"
      onDoubleClick={handleDoubleClick}
    >
      <div className="w-10 h-10 rounded-lg bg-overlay-lighter flex items-center justify-center text-text-muted flex-shrink-0">
        <Music size={20} />
      </div>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="text-caption text-text-primary truncate">{name}</div>
        <div className="text-micro text-text-muted">{formatDuration(duration)}</div>
      </div>
    </div>
  )
}
