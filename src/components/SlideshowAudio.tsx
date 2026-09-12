import { useEffect, useRef, useCallback, useState } from 'react'
import { Music, X, Volume2, VolumeX } from 'lucide-react'
import { useSlideshowStore } from '@/stores/slideshowStore'
import { logger } from '@/utils/logger'

/**
 * 幻灯片背景音乐播放器
 * - 单曲循环
 * - 音量控制（0-100）
 * - 退出幻灯片时自动停止并释放资源
 */
export function SlideshowAudio() {
  const audioTrack = useSlideshowStore(s => s.audioTrack)
  const isPlaying = useSlideshowStore(s => s.isPlaying)
  const removeAudioTrack = useSlideshowStore(s => s.removeAudioTrack)
  const setAudioVolume = useSlideshowStore(s => s.setAudioVolume)

  const audioRef = useRef<HTMLAudioElement>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [previousVolume, setPreviousVolume] = useState(80)

  // 音频加载与播放控制
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioTrack) return

    // 获取 media:// URL
    let cancelled = false

    const loadAudio = async () => {
      try {
        // 通过 IPC 获取 media:// 协议 URL
        const result = await window.electronAPI.getMediaUrl(audioTrack.path)
        if (cancelled || !result.success || !result.data) {
          logger.error('SlideshowAudio', '获取音频 URL 失败', result.error)
          return
        }

        const mediaUrl = result.data
        if (audio.src !== mediaUrl) {
          audio.src = mediaUrl
          audio.load()
        }

        // 单曲循环
        audio.loop = true
        audio.volume = audioTrack.volume / 100

        // 幻灯片播放时自动播放音乐
        if (isPlaying) {
          audio.play().catch(err => {
            if (err.name !== 'AbortError') {
              logger.warn('SlideshowAudio', '自动播放失败（可能需要用户交互）', err.message)
            }
          })
        }
      } catch (err) {
        logger.error('SlideshowAudio', '加载音频失败', err)
      }
    }

    loadAudio()

    return () => {
      cancelled = true
      // 组件卸载或音频轨道变化时释放资源
      audio.pause()
      audio.src = ''
      audio.load()
    }
  }, [audioTrack?.path, isPlaying])

  // 音量同步
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioTrack) return
    audio.volume = isMuted ? 0 : audioTrack.volume / 100
  }, [audioTrack?.volume, isMuted])

  // 播放状态同步
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioTrack) return

    if (isPlaying) {
      audio.play().catch(err => {
        if (err.name !== 'AbortError') {
          logger.warn('SlideshowAudio', '播放失败', err.message)
        }
      })
    } else {
      audio.pause()
    }
  }, [isPlaying, audioTrack])

  // 幻灯片停止时移除音频轨道
  useEffect(() => {
    if (!isPlaying && audioTrack) {
      removeAudioTrack()
    }
  }, [isPlaying, audioTrack, removeAudioTrack])

  // 切换静音
  const toggleMute = useCallback(() => {
    if (isMuted) {
      // 恢复之前的音量
      setAudioVolume(previousVolume)
      setIsMuted(false)
    } else {
      // 保存当前音量并静音
      setPreviousVolume(audioTrack?.volume ?? 80)
      setAudioVolume(0)
      setIsMuted(true)
    }
  }, [isMuted, audioTrack?.volume, setAudioVolume])

  // 音量滑块变化
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value)
    setAudioVolume(volume)
    // 用户手动调整音量时取消静音状态
    if (volume > 0 && isMuted) {
      setIsMuted(false)
    }
  }, [setAudioVolume, isMuted])

  // 关闭音乐
  const handleClose = useCallback(() => {
    removeAudioTrack()
  }, [removeAudioTrack])

  // 无音频轨道时不渲染
  if (!audioTrack) return null

  const volume = audioTrack.volume
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : Volume2

  // 从路径提取文件名
  const fileName = audioTrack.path.split(/[\\/]/).pop() || '未知音频'

  return (
    <div className="glass-l2 flex items-center gap-3 px-3 py-2 rounded-lg">
      <audio ref={audioRef} />

      {/* 音乐图标 */}
      <Music size={16} className="text-accent flex-shrink-0" />

      {/* 文件名 */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate" title={fileName}>
          {fileName}
        </div>
      </div>

      {/* 音量控制 */}
      <div className="flex items-center gap-2">
        <button
          className="w-6 h-6 flex items-center justify-center rounded-sm text-text-secondary hover:text-text-primary hover:bg-overlay-lighter transition-colors"
          onClick={toggleMute}
          title={isMuted ? '取消静音' : '静音'}
        >
          <VolumeIcon size={14} />
        </button>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={isMuted ? 0 : volume}
          onChange={handleVolumeChange}
          className="audio-volume-slider w-20"
          title={`音量: ${volume}%`}
        />
      </div>

      {/* 关闭按钮 */}
      <button
        className="w-6 h-6 flex items-center justify-center rounded-sm text-text-secondary hover:text-text-primary hover:bg-overlay-lighter transition-colors"
        onClick={handleClose}
        title="移除背景音乐"
      >
        <X size={14} />
      </button>
    </div>
  )
}
