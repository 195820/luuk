import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Search, X, Loader2, Bookmark, BookmarkCheck, Clock, Trash2 } from 'lucide-react'
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
    history, presets,
    openPanel, closePanel, setCriteria, search,
    loadHistoryAndPresets, addToHistory, clearHistory,
    saveAsPreset, removePreset, loadPreset,
  } = useSearchStore()

  // 本地文件大小输入状态（数值 + 单位分离）
  const [minSizeVal, setMinSizeVal] = useState('')
  const [maxSizeVal, setMaxSizeVal] = useState('')
  const [sizeUnit, setSizeUnit] = useState<'KB' | 'MB'>('MB')

  // 搜索历史下拉 & 预设 UI 状态
  const [showHistory, setShowHistory] = useState(false)
  const [showPresetInput, setShowPresetInput] = useState(false)
  const [presetName, setPresetName] = useState('')

  // R-1：面板以 portal 浮层渲染在 header 之外，不受 h-12 固定高度裁剪
  const anchorRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState({ top: 52, left: 12, width: 640 })

  const updatePanelPos = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // 以 header 底边为基准，避免锚点行在 header 内垂直居中时浮层与 header 重叠
    const headerBottom = el.closest('header')?.getBoundingClientRect().bottom ?? rect.bottom
    const width = Math.min(640, window.innerWidth - 24)
    // 右对齐触发按钮，越界时收回视口内
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
    setPanelPos({ top: Math.max(rect.bottom, headerBottom) + 6, left, width })
  }, [])

  useEffect(() => {
    if (!active) return
    updatePanelPos()
    window.addEventListener('resize', updatePanelPos)
    return () => window.removeEventListener('resize', updatePanelPos)
  }, [active, updatePanelPos])

  // 切换单位时同步字节值
  const factor = sizeUnit === 'MB' ? 1024 * 1024 : 1024
  useEffect(() => {
    if (minSizeVal) setCriteria({ minFileSize: Math.round(Number(minSizeVal) * factor) })
    if (maxSizeVal) setCriteria({ maxFileSize: Math.round(Number(maxSizeVal) * factor) })
  }, [sizeUnit]) // 仅在单位切换时同步，避免覆盖用户输入

  // 加载搜索历史和预设
  useEffect(() => {
    loadHistoryAndPresets()
  }, [loadHistoryAndPresets])

  const toggleFormat = (fmt: string) => {
    const current = criteria.formats || []
    const next = current.includes(fmt)
      ? current.filter(f => f !== fmt)
      : [...current, fmt]
    setCriteria({ formats: next.length > 0 ? next : undefined })
  }

  const handleSearch = useCallback(() => {
    // 保存搜索历史
    if (criteria.fileName?.trim()) {
      addToHistory(criteria.fileName.trim())
    }
    search(libraryId)
  }, [search, libraryId, criteria.fileName, addToHistory])

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

  const openFromButton = () => {
    openPanel()
    // 展开前按当前触发按钮位置计算浮层锚点
    requestAnimationFrame(updatePanelPos)
  }

  return (
    <div className="w-full" onKeyDown={handleKeyDown}>
      {/* 触发按钮行：搜索图标 + 状态统计 */}
      <div ref={anchorRef} className="flex items-center gap-2 mb-2">
        <button
          onClick={() => active ? closePanel() : openFromButton()}
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

      {/* 折叠面板：portal 到 body 的 fixed 浮层（R-1 修复，不受 header 裁剪） */}
      {createPortal(
        <AnimatePresence initial={false}>
          {active && (
          <motion.div
            key="search-panel"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="fixed z-50"
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
          >
            <div className="glass-l2 border border-border rounded-lg p-4 space-y-3 shadow-2xl">
              {/* 文件名 + 搜索历史 */}
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-text-secondary w-16 shrink-0">文件名</label>
                  <input
                    type="text"
                    value={criteria.fileName || ''}
                    onChange={(e) => setCriteria({ fileName: e.target.value || undefined })}
                    onFocus={() => setShowHistory(true)}
                    onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                    placeholder="模糊匹配..."
                    className="flex-1 h-8 px-2 bg-glass-l2 border border-border rounded text-xs text-text-primary outline-none focus:border-accent"
                  />
                </div>
                {/* 搜索历史下拉 */}
                {showHistory && (history ?? []).length > 0 && (
                  <div className="ml-19 pl-19 flex items-center gap-1 flex-wrap">
                    <Clock size={11} className="text-text-muted shrink-0" />
                    {(history ?? []).slice(0, 8).map((term, i) => (
                      <button
                        key={i}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setCriteria({ fileName: term })
                          setShowHistory(false)
                        }}
                        className="px-1.5 py-0.5 rounded text-[11px] bg-glass-l2 border border-border text-text-secondary hover:text-text-primary hover:border-accent transition-colors"
                      >
                        {term}
                      </button>
                    ))}
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault()
                        clearHistory()
                      }}
                      className="px-1 py-0.5 text-[11px] text-text-muted hover:text-error transition-colors"
                      title="清空历史"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                )}
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
                <div className="flex-1" />
                {/* 保存为预设 */}
                {showPresetInput ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="预设名称..."
                      className="h-7 w-24 px-2 bg-glass-l2 border border-border rounded text-xs outline-none focus:border-accent"
                      autoFocus
                    />
                    <button
                      onClick={async () => {
                        if (presetName.trim()) {
                          await saveAsPreset(presetName.trim())
                          setPresetName('')
                          setShowPresetInput(false)
                        }
                      }}
                      className="btn-text primary text-[11px]"
                    >
                      <BookmarkCheck size={12} />
                      保存
                    </button>
                    <button
                      onClick={() => { setShowPresetInput(false); setPresetName('') }}
                      className="btn-text text-[11px]"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowPresetInput(true)}
                    className="btn-text text-[11px]"
                    title="保存当前条件为预设"
                  >
                    <Bookmark size={12} />
                    保存预设
                  </button>
                )}
              </div>

              {/* 已保存的预设 */}
              {(presets ?? []).length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-text-muted">预设:</span>
                  {(presets ?? []).map(p => (
                    <div key={p.id} className="group flex items-center gap-0.5">
                      <button
                        onClick={() => loadPreset(p)}
                        className="px-1.5 py-0.5 rounded text-[11px] bg-glass-l2 border border-border text-text-secondary hover:text-accent hover:border-accent transition-colors"
                        title={p.name}
                      >
                        {p.name}
                      </button>
                      <button
                        onClick={() => removePreset(p.id)}
                        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-error transition-opacity"
                        title="删除预设"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
