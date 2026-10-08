/**
 * T23 — AiLabelPanel（AI 标签提案 + 质量分作业面板）
 * 挂载于 AgentSettings 的 AI 区之后：列出本库 pending 的 quality 提案（缩略图 + 标签 chips + 采纳/忽略），
 * 顶部两个动作按钮触发 ai.label / ai.quality 作业，进度走 onJobProgress（jobs:* 通道，需先显式订阅）。
 * 关闭态（ai.enabled=false，复用 getAiStatus 探针）整块隐藏；零引擎零门禁查询（list 通道为纯 DB）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Gauge, Loader2, Check, X } from 'lucide-react'
import { useImageStore } from '../../stores/imageStore'
import type { AiStatus, JobProgress, TagSuggestionItem } from '../../types'

/** 作业运行态（jobId → 进度快照） */
interface JobRun {
  jobId: string
  done: number
  total: number
  failed: number
}

export function AiLabelPanel() {
  const libraries = useImageStore(s => s.libraries)
  const currentLibraryId = useImageStore(s => s.currentLibraryId)

  // 目标库：当前真实库（负 ID 特殊视图除外），否则首个在线库
  const libraryId = currentLibraryId && currentLibraryId > 0
    ? currentLibraryId
    : libraries.find(l => l.status === 'online')?.id ?? null

  const [ai, setAi] = useState<AiStatus | null>(null)
  const [items, setItems] = useState<TagSuggestionItem[]>([])
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [labelJob, setLabelJob] = useState<JobRun | null>(null)
  const [qualityJob, setQualityJob] = useState<JobRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 当前触发中的作业 jobId（进度事件到来后据此归属；终态即清空）
  const labelJobIdRef = useRef<string | null>(null)
  const qualityJobIdRef = useRef<string | null>(null)

  useEffect(() => {
    void window.electronAPI.getAiStatus().then(r => { if (r.success && r.data) setAi(r.data) })
  }, [])

  const refresh = useCallback(() => {
    if (!libraryId) { setItems([]); return }
    void window.electronAPI.listTagSuggestions(libraryId).then(r => {
      if (r.success && r.data) {
        setItems(r.data)
        // 缩略图按需拉取（small），命中缓存的 imageId 跳过
        setThumbs(prev => {
          const next = { ...prev }
          for (const it of r.data!) {
            if (next[it.imageId] === undefined) {
              void window.electronAPI.getThumbnail(libraryId, it.imageId, 'small')
                .then(url => setThumbs(p => ({ ...p, [it.imageId]: url || '' })))
                .catch(() => setThumbs(p => ({ ...p, [it.imageId]: '' })))
            }
          }
          return next
        })
      }
    })
  }, [libraryId])

  useEffect(() => { refresh() }, [refresh])

  // 订阅作业进度（jobs:subscribeProgress 建立主进程转发通道；本面板只关心自己触发的 jobId）
  // 标签作业正常完成 → 刷新提案列表（新 pending 提案已落库）
  useEffect(() => {
    let unsub: (() => void) | null = null
    let alive = true
    void window.electronAPI.jobsSubscribeProgress().then(() => {
      if (!alive) return
      unsub = window.electronAPI.onJobProgress((p: JobProgress) => {
        const terminal = p.state === 'done' || p.state === 'cancelled' || p.state === 'failed'
        if (labelJobIdRef.current === p.jobId) {
          if (terminal) {
            labelJobIdRef.current = null
            setLabelJob(null)
            if (p.state === 'done') refresh()
          } else {
            setLabelJob({ jobId: p.jobId, done: p.done, total: p.total, failed: p.failed })
          }
        } else if (qualityJobIdRef.current === p.jobId && terminal) {
          qualityJobIdRef.current = null
          setQualityJob(null)
        } else if (qualityJobIdRef.current === p.jobId) {
          setQualityJob({ jobId: p.jobId, done: p.done, total: p.total, failed: p.failed })
        }
      })
    })
    return () => { alive = false; unsub?.() }
  }, [refresh])

  const trigger = async (kind: 'label' | 'quality') => {
    if (!libraryId) { setError('无可用库'); return }
    setError(null)
    const r = kind === 'label'
      ? await window.electronAPI.triggerAiTagging(libraryId)
      : await window.electronAPI.triggerAiQuality(libraryId)
    if (!r.success || !r.data) {
      setError(r.error ?? '触发作业失败')
      return
    }
    const run: JobRun = { jobId: r.data.jobId, done: 0, total: 0, failed: 0 }
    if (kind === 'label') { labelJobIdRef.current = r.data.jobId; setLabelJob(run) }
    else { qualityJobIdRef.current = r.data.jobId; setQualityJob(run) }
  }

  const adopt = async (proposalId: number) => {
    const r = await window.electronAPI.adoptTagSuggestion(proposalId)
    if (!r.success) { setError(r.error ?? '采纳失败'); return }
    void refresh()
  }

  const dismiss = async (proposalId: number) => {
    const r = await window.electronAPI.dismissTagSuggestion(proposalId)
    if (!r.success) { setError(r.error ?? '忽略失败'); return }
    void refresh()
  }

  // 关闭态整块隐藏（零 UI 零查询，对齐 C1 关闭态零会话口径）
  if (!ai?.enabled) return null

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <label className="text-sm font-medium block flex items-center gap-1.5"><Sparkles size={14} />AI 标签建议</label>
          <span className="text-xs text-text-muted">
            CLIP 零样本对已索引图片打标（人在回路：采纳后才写入标签，来源标记 ai）
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            disabled={!libraryId || !!labelJob}
            onClick={() => void trigger('label')}
            className="px-3 py-1 rounded-md bg-accent text-white text-sm disabled:opacity-40 flex items-center gap-1"
          >
            {labelJob && <Loader2 size={14} className="animate-spin" />}
            生成标签建议{labelJob ? ` ${labelJob.done}/${labelJob.total || '…'}` : ''}
          </button>
          <button
            disabled={!libraryId || !!qualityJob}
            onClick={() => void trigger('quality')}
            className="px-3 py-1 rounded-md hover:bg-overlay-lighter text-text-secondary text-sm flex items-center gap-1 disabled:opacity-40"
          >
            {qualityJob ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />}
            计算质量分{qualityJob ? ` ${qualityJob.done}/${qualityJob.total || '…'}` : ''}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {items.length === 0 ? (
        <div className="text-xs text-text-muted">暂无待确认的标签建议{libraryId ? '' : '（无可用库）'}</div>
      ) : (
        <div className="space-y-2 max-h-[280px] overflow-y-auto">
          {items.map(it => (
            <div key={it.proposalId} className="flex items-center gap-3 p-2 rounded-md bg-glass-l1 border border-border">
              <div className="w-12 h-12 rounded-md overflow-hidden bg-overlay-lighter shrink-0">
                {thumbs[it.imageId]
                  ? <img src={thumbs[it.imageId]} alt={it.imageRelativePath} className="w-full h-full object-cover" />
                  : <div className="w-full h-full" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-muted truncate">{it.imageRelativePath}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {it.suggestions.map(s => (
                    <span key={s.tagName} className="px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/40 text-xs text-text-primary">
                      {s.tagName} <span className="text-text-secondary">{Math.round(s.confidence * 100)}%</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => void adopt(it.proposalId)} title="采纳全部建议标签"
                  className="p-1.5 rounded-md hover:bg-overlay-lighter text-green-400"><Check size={14} /></button>
                <button onClick={() => void dismiss(it.proposalId)} title="忽略该提案"
                  className="p-1.5 rounded-md hover:bg-overlay-lighter text-text-muted"><X size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
