export type MediaFilterType = 'all' | 'image' | 'video'

interface MediaFilterProps {
  value: MediaFilterType
  onChange: (filter: MediaFilterType) => void
}

export function MediaFilter({ value, onChange }: MediaFilterProps) {
  const filters: { key: MediaFilterType; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'image', label: '图片' },
    { key: 'video', label: '视频' },
  ]

  return (
    <div className="flex items-center gap-2">
      {filters.map((f) => (
        <button
          key={f.key}
          className={`px-3 py-1.5 border border-transparent rounded-full bg-transparent text-xs text-text-secondary cursor-pointer transition-colors duration-150 hover:bg-overlay-light hover:text-text-primary ${
            value === f.key ? 'bg-overlay-selected text-text-primary' : ''
          }`}
          onClick={() => onChange(f.key)}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
