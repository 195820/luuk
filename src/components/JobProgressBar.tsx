import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import { Pause, Play, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { JobProgress } from '../types/plugin'

/** 作业类型 → 中文标签 */
const KIND_LABEL: Record<string, string> = {
  'ai.autotone.auto': '自动调色',
  'ai.matting.extract': 'AI 抠图',
  'ai.upscale.x4': 'AI 超分',
  'ai.clip-index': '内容索引',
  'crawler.download': '爬虫下载',
}

function label(kind: string): string {
  return KIND_LABEL[kind] ?? kind
}

/**
 * 作业进度浮层（复用 ScanProgress 底部浮层模式）。
 * 监听 electronAPI.onJobProgress 推送，展示 done/total + 进度 + ETA + 暂停/取消。
 */
export function JobProgressBar() {
  const [jobs, setJobs] = useState<Map<string, JobProgress & { kind: string }>>(new Map())

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onJobProgress) return

    // 订阅主进程进度推送（同时确保后端开始广播）
    void api.jobsSubscribeProgress?.()

    const unsub = api.onJobProgress((p: JobProgress) => {
      setJobs((prev) => {
        const next = new Map(prev)
        if (p.state === 'done' || p.state === 'cancelled' || p.state === 'failed') {
          // 终态短暂保留后自动移除
          next.set(p.jobId, { ...p, kind: p.kind ?? '' })
          setTimeout(() => {
            setJobs((cur) => {
              const n = new Map(cur)
              n.delete(p.jobId)
              return n
            })
          }, 3000)
        } else {
          next.set(p.jobId, { ...p, kind: p.kind ?? '' })
        }
        return next
      })
    })

    return () => unsub?.()
  }, [])

  const list = Array.from(jobs.values())
  if (list.length === 0) return null

  const control = (jobId: string, action: 'pause' | 'resume' | 'cancel') => {
    const api = window.electronAPI
    if (action === 'pause') void api.jobsPause(jobId)
    else if (action === 'resume') void api.jobsResume(jobId)
    else void api.jobsCancel(jobId)
  }

  return (
    <div className="fixed bottom-12 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {list.map((job) => {
          const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0
          const eta = job.eta ? `剩余约 ${Math.ceil(job.eta)}s` : null
          const done = job.state === 'done'
          const failed = job.state === 'failed'
          const paused = job.state === 'paused'
          return (
            <motion.div
              key={job.jobId}
              className="glass-l2 border border-border rounded-lg px-4 py-3 min-w-[320px] max-w-[440px] shadow-glass-lg pointer-events-auto"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={motionPresets.fade}
            >
              <div className="flex items-center gap-2 mb-2">
                {done ? (
                  <CheckCircle2 size={14} className="text-green-500" />
                ) : failed ? (
                  <AlertTriangle size={14} className="text-destructive" />
                ) : (
                  <Loader2 size={14} className="text-accent animate-spin" />
                )}
                <h3 className="m-0 text-body font-semibold text-text-primary tracking-wide">
                  {label(job.kind)}
                </h3>
                <span className="ml-auto text-xs text-text-muted tabular-nums">{pct}%</span>
              </div>

              <div className="w-full h-1 bg-canvas-tertiary rounded-full overflow-hidden mb-2 border border-border">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    failed ? 'bg-destructive' : done ? 'bg-green-500' : 'bg-accent'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span className="tabular-nums">
                  {job.done}/{job.total}
                  {job.failed > 0 && <span className="text-destructive"> · 失败 {job.failed}</span>}
                  {eta && <span className="text-text-muted"> · {eta}</span>}
                </span>
                <div className="flex items-center gap-1">
                  {!done && !failed && !paused && (
                    <button
                      className="btn-icon-sm rounded p-1 hover:bg-overlay-lighter"
                      title="暂停"
                      onClick={() => control(job.jobId, 'pause')}
                    >
                      <Pause size={13} />
                    </button>
                  )}
                    {!done && !failed && paused && (
                    <button
                      className="btn-icon-sm rounded p-1 hover:bg-overlay-lighter"
                      title="继续"
                      onClick={() => control(job.jobId, 'resume')}
                    >
                      <Play size={13} />
                    </button>
                  )}
                  {!done && (
                    <button
                      className="btn-icon-sm rounded p-1 hover:bg-overlay-lighter"
                      title="取消"
                      onClick={() => control(job.jobId, 'cancel')}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
