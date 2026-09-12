import { useState } from 'react'
import { motion } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import {
  MonitorPlay,
  Pause,
  Shuffle,
  ArrowRightLeft,
  Music,
  ListMusic,
  Settings2,
} from 'lucide-react'
import { useSlideshowStore, type SlideshowTransition } from '@/stores/slideshowStore'
import { SlideshowAudio } from '../SlideshowAudio'
import { PlaylistEditor } from '../PlaylistEditor'

interface SlideshowBarProps {
  /** 当前库 ID（用于播放列表编辑器） */
  libraryId: number
  /** 是否正在播放 */
  isPlaying: boolean
  /** 切换播放/暂停 */
  onToggle: () => void
}

/** 幻灯片间隔选项 */
const SLIDESHOW_INTERVALS = [3, 5, 10, 30]

/** 过渡动画选项 */
const TRANSITION_OPTIONS: { value: SlideshowTransition; label: string }[] = [
  { value: 'fade', label: '淡入淡出' },
  { value: 'slide', label: '滑动' },
  { value: 'zoom', label: '缩放' },
]

export function SlideshowBar({ libraryId, isPlaying, onToggle }: SlideshowBarProps) {
  const mode = useSlideshowStore(s => s.mode)
  const transition = useSlideshowStore(s => s.transition)
  const intervalSec = useSlideshowStore(s => s.intervalSec)
  const audioTrack = useSlideshowStore(s => s.audioTrack)
  const toggleMode = useSlideshowStore(s => s.toggleMode)
  const setTransition = useSlideshowStore(s => s.setTransition)
  const setInterval = useSlideshowStore(s => s.setInterval)
  const addAudioTrack = useSlideshowStore(s => s.addAudioTrack)

  const [showPlaylistEditor, setShowPlaylistEditor] = useState(false)

  // 添加背景音乐
  const handleAddMusic = async () => {
    try {
      const result = await window.electronAPI.selectAudioFile()
      if (result.success && result.data) {
        addAudioTrack(result.data.path)
      }
    } catch (err) {
      console.error('选择音频文件失败:', err)
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={motionPresets.panel}
        className="glass-l2 fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-3 flex items-center gap-4 rounded-xl border border-border shadow-lg z-40"
      >
        {/* 播放状态指示 */}
        <div className="flex items-center gap-2">
          <MonitorPlay size={16} className="text-accent" />
          <span className="text-sm text-text-primary">幻灯片播放中</span>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-border" />

        {/* 间隔控制 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">间隔:</span>
          <select
            value={intervalSec}
            onChange={e => setInterval(Number(e.target.value))}
            className="h-7 pl-2 pr-6 bg-canvas-tertiary border border-border rounded text-xs text-text-secondary cursor-pointer outline-none hover:border-border-hover appearance-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 4px center',
            }}
          >
            {SLIDESHOW_INTERVALS.map(i => (
              <option key={i} value={i}>{i}秒</option>
            ))}
          </select>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-border" />

        {/* 过渡动画选择 */}
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={14} className="text-text-secondary" />
          <select
            value={transition}
            onChange={e => setTransition(e.target.value as SlideshowTransition)}
            className="h-7 pl-2 pr-6 bg-canvas-tertiary border border-border rounded text-xs text-text-secondary cursor-pointer outline-none hover:border-border-hover appearance-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 4px center',
            }}
          >
            {TRANSITION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-border" />

        {/* 随机播放切换 */}
        <button
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            mode === 'random'
              ? 'text-accent bg-accent/10'
              : 'text-text-secondary hover:text-text-primary hover:bg-overlay-lighter'
          }`}
          onClick={toggleMode}
          title={`播放模式: ${mode === 'sequential' ? '顺序' : '随机'} (Ctrl+R)`}
        >
          <Shuffle size={14} />
        </button>

        {/* 背景音乐 */}
        <button
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            audioTrack
              ? 'text-accent bg-accent/10'
              : 'text-text-secondary hover:text-text-primary hover:bg-overlay-lighter'
          }`}
          onClick={handleAddMusic}
          title="添加背景音乐"
        >
          <Music size={14} />
        </button>

        {/* 播放列表 */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-overlay-lighter transition-colors"
          onClick={() => setShowPlaylistEditor(true)}
          title="播放列表"
        >
          <ListMusic size={14} />
        </button>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-border" />

        {/* 暂停/继续按钮 */}
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-primary bg-overlay-lighter hover:bg-overlay rounded transition-colors"
          onClick={onToggle}
        >
          <Pause size={12} />
          暂停
        </button>
      </motion.div>

      {/* 背景音乐播放器（有音频时显示） */}
      {audioTrack && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={motionPresets.fade}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40"
        >
          <SlideshowAudio />
        </motion.div>
      )}

      {/* 播放列表编辑器 */}
      <PlaylistEditor
        isOpen={showPlaylistEditor}
        onClose={() => setShowPlaylistEditor(false)}
        libraryId={libraryId}
      />
    </>
  )
}
