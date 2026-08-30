import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Search, X, Loader2 } from 'lucide-react'
import { useSearchStore } from '../stores/searchStore'
import type { SearchCriteria } from '../types'

const FORMAT_OPTIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] as const
const RATING_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 1, label: '★ 及以上' },
  { value: 2, label: '★★ 及以上' },
  { value: 3, label: '★★★ 及以上' },
  { value: 4, label: '★★★★ 及以上' },
  { value: 5, label: '★★★★★' },
] as const
const SIZE_UNITS = [
  { value: 'KB', label: 'KB', factor: 1024 },
  { value: 'MB', label: 'MB', factor: 1024 * 1024 },
] as const

interface SearchPanelProps {
  libraryId: number
}

export function SearchPanel({ libraryId }: SearchPanelProps) {
  const {
    active, searching, criteria, results, total, hasSearched,
    openPanel, closePanel, setCriteria, search,
  } = useSearchStore()

  // 本地文件大小输入状态（数值 + 单位分离）
  const [minSizeVal, setMinSizeVal] = useState('')
  const [maxSizeVal, setMaxSizeVal] = useState('')
  const [sizeUnit, setSizeUnit] = useState<'KB' | 'MB'>('MB')

  // 切换单位时同步字节值
  const factor = sizeUnit === 'MB' ? 1024 * 1024 : 1024
  useEffect(() => {
    if (minSizeVal) setCriteria({ minFileSize: Math.round(Number(minSizeVal) * factor) })
    if (maxSizeVal) setCriteria({ maxFileSize: Math.round(Number(maxSizeVal) * factor) })
  }, [sizeUnit]) // 仅在单位切换时同步，避免覆盖用户输入

  const toggleFormat = (fmt: string) => {
    const current = criteria.formats || []
    const next = current.includes(fmt)
      ? current.filter(f => f !== fmt)
      : [...current, fmt]
    setCriteria({ formats: next.length > 0 ? next : undefined })
  }

  const handleSearch = useCallback(() => {
    search(libraryId)
  }, [search, libraryId])

  const handleClear = () => {
    setMinSizeVal('')
    setMaxSizeVal('')
    // 重置全部条件
    const reset: SearchCriteria = {}
    Object.keys(criteria).forEach(k => {
      (reset as any)[k] = undefined
    })
    useSearchStore.setState({ criteria: reset, results: [], total: 0, hasSearched: false })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch()
    }
  }

  return (
    <div className="w-full" onKeyDown={handleKeyDown}>
      {/* 触发按钮行：搜索图标 + 状态统计 */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => active ? closePanel() : openPanel()}
          className={`btn-text ${active ? 'primary' : ''}`}
          title="搜索（Ctrl+F）"
        >
          <Search size={14} />
          搜索
        </button>
        {hasSearched && (
          <span className="text-xs text-text-secondary">
            共 {total} 张{results.length < total ? `（已加载 ${results.length}）` : ''}
          </span>
        )}
      </div>

      {/* 折叠面板 */}
      <AnimatePresence initial={false}>
        {active && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="glass-l1 border border-border rounded-lg p-4 mb-3 space-y-3">
              {/* 文件名 */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary w-16 shrink-0">文件名</label>
                <input
                  type="text"
                  value={criteria.fileName || ''}
                  onChange={(e) => setCriteria({ fileName: e.target.value || undefined })}
                  placeholder="模糊匹配..."
                  className="flex-1 h-8 px-2 bg-glass-l2 border border-border rounded text-xs text-text-primary outline-none focus:border-accent"
                />
              </div>

              {/* 格式芯片 */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary w-16 shrink-0">格式</label>
                <div className="flex flex-wrap gap-1.5">
                  {FORMAT_OPTIONS.map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => toggleFormat(fmt)}
                      className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                        (criteria.formats || []).includes(fmt)
                          ? 'bg-accent/20 border-accent text-accent'
                          : 'bg-glass-l2 border-border text-text-secondary hover:border-border-hover'
                      }`}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* 尺寸范围 */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary w-16 shrink-0">尺寸</label>
                <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <span>宽</span>
                  <input
                    type="number"
                    value={criteria.minWidth ?? ''}
                    onChange={(e) => setCriteria({ minWidth: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="最小"
                    className="w-20 h-8 px-2 bg-glass-l2 border border-border rounded outline-none focus:border-accent"
                  />
                  <span>–</span>
                  <input
                    type="number"
                    value={criteria.maxWidth ?? ''}
                    onChange={(e) => setCriteria({ maxWidth: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="最大"
                    className="w-20 h-8 px-2 bg-glass-l2 border border-border rounded outline-none focus:border-accent"
                  />
                  <span className="mx-2">×</span>
                  <span>高</span>
                  <input
                    type="number"
                    value={criteria.minHeight ?? ''}
                    onChange={(e) => setCriteria({ minHeight: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="最小"
                    className="w-20 h-8 px-2 bg-glass-l2 border border-border rounded outline-none focus:border-accent"
                  />
                  <span>–</span>
                  <input
                    type="number"
                    value={criteria.maxHeight ?? ''}
                    onChange={(e) => setCriteria({ maxHeight: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="最大"
                    className="w-20 h-8 px-2 bg-glass-l2 border border-border rounded outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* 文件大小 */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary w-16 shrink-0">大小</label>
                <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input
                    type="number"
                    value={minSizeVal}
                    onChange={(e) => {
                      setMinSizeVal(e.target.value)
                      setCriteria({ minFileSize: e.target.value ? Math.round(Number(e.target.value) * factor) : undefined })
                    }}
                    placeholder="最小"
                    className="w-20 h-8 px-2 bg-glass-l2 border border-border rounded outline-none focus:border-accent"
                  />
                  <span>–</span>
                  <input
                    type="number"
                    value={maxSizeVal}
                    onChange={(e) => {
                      setMaxSizeVal(e.target.value)
                      setCriteria({ maxFileSize: e.target.value ? Math.round(Number(e.target.value) * factor) : undefined })
                    }}
                    placeholder="最大"
                    className="w-20 h-8 px-2 bg-glass-l2 border border-border rounded outline-none focus:border-accent"
                  />
                  <select
                    value={sizeUnit}
                    onChange={(e) => setSizeUnit(e.target.value as 'KB' | 'MB')}
                    className="h-8 px-2 bg-glass-l1 border border-border rounded text-xs cursor-pointer outline-none"
                  >
                    {SIZE_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </div>
              </div>

              {/* 拍摄日期 */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary w-16 shrink-0">日期</label>
                <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input
                    type="date"
                    value={criteria.createdFrom || ''}
                    onChange={(e) => setCriteria({ createdFrom: e.target.value || undefined })}
                    className="h-8 px-2 bg-glass-l2 border border-border rounded outline-none focus:border-accent"
                  />
                  <span>–</span>
                  <input
                    type="date"
                    value={criteria.createdTo || ''}
                    onChange={(e) => setCriteria({ createdTo: e.target.value || undefined })}
                    className="h-8 px-2 bg-glass-l2 border border-border rounded outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* 最低评分 */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary w-16 shrink-0">评分</label>
                <select
                  value={criteria.minRating ?? 0}
                  onChange={(e) => setCriteria({ minRating: Number(e.target.value) || undefined })}
                  className="h-8 px-2 bg-glass-l1 border border-border rounded text-xs cursor-pointer outline-none"
                >
                  {RATING_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="btn-text primary"
                >
                  {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  搜索
                </button>
                <button onClick={handleClear} className="btn-text">
                  <X size={14} />
                  清空
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
