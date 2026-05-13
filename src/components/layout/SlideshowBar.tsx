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
      <span>🎬 幻灯片播放中</span>
      <div className="slideshow-controls">
        <span>间隔:</span>
        <select
          value={selectedInterval}
          onChange={(e) => onIntervalChange(Number(e.target.value))}
        >
          {SLIDESHOW_INTERVALS.map(i => (
            <option key={i} value={i}>{i}秒</option>
          ))}
        </select>
        <button onClick={onToggle} className="slideshow-stop-btn">
          ⏸ 暂停
        </button>
      </div>
    </div>
  )
}
