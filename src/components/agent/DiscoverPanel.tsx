/**
 * T17 — DiscoverPanel（采集 Agent 提案列表，人在回路主界面）
 * 提案可达上千条 → @tanstack/react-virtual 虚拟滚动守性能红线；score 降序分页消费 ProposalStore.list。
 * accept/skip/reject 三动作经 agentStore.resolveProposal（主进程联动 FeedbackAggregator + accept 落地入库）。
 * 无原图字节进渲染层：payload 仅 CandidateItem 文本元数据（D9）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X, RefreshCw, Check, SkipForward, Ban, Sparkles, Loader2 } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import type { CandidateItem, Proposal, ProposalState } from '../../types'

interface DiscoverPanelProps {
  onClose: () => void
}

const ROW_HEIGHT = 104
const FILTERS: Array<{ key: ProposalState | 'all'; label: string }> = [
  { key: 'pending', label: '待确认' },
  { key: 'accepted', label: '已确认' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'all', label: '全部' },
]

function candidateOf(p: Proposal): CandidateItem {
  return (p.payload ?? {}) as CandidateItem
}

export function DiscoverPanel({ onClose }: DiscoverPanelProps) {
  const proposals = useAgentStore(s => s.proposals)
  const total = useAgentStore(s => s.proposalsTotal)
  const page = useAgentStore(s => s.proposalsPage)
  const filterState = useAgentStore(s => s.filterState)
  const loading = useAgentStore(s => s.loadingProposals)
  const loadProposals = useAgentStore(s => s.loadProposals)
  const resolveProposal = useAgentStore(s => s.resolveProposal)

  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const parentRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({
    count: proposals.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  useEffect(() => {
    void loadProposals(1, filterState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flash = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text })
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  const act = useCallback(async (id: number, action: 'accept' | 'skip' | 'reject') => {
    setBusyId(id)
    const res = await resolveProposal(id, action)
    setBusyId(null)
    flash(res.ok, res.message)
  }, [resolveProposal, flash])

  const pageSize = 50
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-l2 flex flex-col w-[760px] h-[80vh]">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles size={20} />
            发现 · 待确认提案
            <span className="text-xs font-normal text-text-muted">共 {total} 条</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadProposals(page, filterState)}
              className="btn-icon-sm hover:bg-overlay-lighter rounded-md p-1.5 transition-colors"
              title="刷新"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="btn-icon-sm hover:bg-overlay-lighter rounded-md p-1.5 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 过滤标签 */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border shrink-0">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => void loadProposals(1, f.key)}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                filterState === f.key ? 'bg-accent text-white' : 'hover:bg-overlay-lighter text-text-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* 虚拟列表 */}
        <div ref={parentRef} className="flex-1 overflow-auto">
          {proposals.length === 0 && !loading ? (
            <div className="h-full flex items-center justify-center text-sm text-text-muted">
              暂无{filterState === 'pending' ? '待确认' : ''}提案
            </div>
          ) : (
            <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
              {virt.getVirtualItems().map(vi => {
                const p = proposals[vi.index]
                const c = candidateOf(p)
                const isPending = p.state === 'pending'
                return (
                  <div
                    key={p.id}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: vi.size, transform: `translateY(${vi.start}px)` }}
                    className="px-4 py-2 border-b border-border/50"
                  >
                    <div className="flex items-center gap-3 h-full">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{c.pageTitle || c.sourceUrl}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-overlay-lighter text-text-secondary shrink-0">
                            {(p.score * 100).toFixed(0)}%
                          </span>
                          <span className="text-xs text-text-muted shrink-0">{p.decisionSrc === 'jev' ? 'Jev' : '本地'}</span>
                        </div>
                        <div className="text-xs text-text-muted truncate mt-0.5">{c.sourceUrl}</div>
                        {c.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {c.tags.slice(0, 6).map((t, i) => (
                              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-overlay-light/60 text-text-secondary">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {isPending && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {busyId === p.id ? (
                            <Loader2 size={18} className="animate-spin text-text-muted" />
                          ) : (
                            <>
                              <button onClick={() => void act(p.id, 'reject')} title="拒绝" className="p-1.5 rounded-md hover:bg-red-500/15 text-red-400 transition-colors"><Ban size={16} /></button>
                              <button onClick={() => void act(p.id, 'skip')} title="跳过" className="p-1.5 rounded-md hover:bg-overlay-lighter text-text-secondary transition-colors"><SkipForward size={16} /></button>
                              <button onClick={() => void act(p.id, 'accept')} title="确认入库" className="p-1.5 rounded-md hover:bg-green-500/15 text-green-400 transition-colors"><Check size={16} /></button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 分页 + toast */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border shrink-0 text-sm">
          <span className="text-text-muted">{toast ? <span className={toast.ok ? 'text-green-400' : 'text-red-400'}>{toast.text}</span> : '\u00A0'}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => void loadProposals(page - 1, filterState)} className="px-2 py-1 rounded disabled:opacity-40 hover:bg-overlay-lighter">上一页</button>
            <span className="text-text-secondary">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => void loadProposals(page + 1, filterState)} className="px-2 py-1 rounded disabled:opacity-40 hover:bg-overlay-lighter">下一页</button>
          </div>
        </div>
      </div>
    </div>
  )
}
