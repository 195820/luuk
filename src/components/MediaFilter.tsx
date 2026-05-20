import styles from './MediaFilter.module.css'

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
    <div className={styles.container}>
      {filters.map((f) => (
        <button
          key={f.key}
          className={`${styles.btn} ${value === f.key ? styles.active : ''}`}
          onClick={() => onChange(f.key)}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
