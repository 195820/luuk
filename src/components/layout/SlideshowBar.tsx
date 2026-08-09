import { MonitorPlay, Pause } from 'lucide-react'

interface SlideshowBarProps {
  selectedInterval: number
  onIntervalChange: (interval: number) => void
  onToggle: () => void
}

const SLIDESHOW_INTERVALS = [3, 5, 10, 30]

export function SlideshowBar({
  selectedInterval,
  onIntervalChange,
  onToggle,
}: SlideshowBarProps) {
  return (
    <div className="slideshow-bar">
      <span className="flex items-center gap-2">
        <MonitorPlay size={16} />
        幻灯片播放中
      </span>
      <div className="slideshow-controls">
        <span>间隔:</span>
        <select
          value={selectedInterval}
          onChange={(e) => onIntervalChange(Number(e.target.value))}
          className="h-8 pl-2 pr-4 bg-glass-l1 border border-border rounded-md text-sm text-text-secondary cursor-pointer outline-none hover:border-border-hover"
        >
          {SLIDESHOW_INTERVALS.map(i => (
            <option key={i} value={i}>{i}秒</option>
          ))}
        </select>
        <button onClick={onToggle} className="btn-pill">
          <Pause size={14} />
          暂停
        </button>
      </div>
    </div>
  )
}
