import { useEffect } from 'react'
import { Cpu, Download, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { usePluginStore } from '../../stores/pluginStore'
import type { ModelInfo } from '../../types/plugin'

/** 格式化字节 */
function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function stateBadge(m: ModelInfo) {
  switch (m.state) {
    case 'downloaded':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-500">
          <CheckCircle2 size={13} /> 已下载
        </span>
      )
    case 'downloading':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-accent">
          <Loader2 size={13} className="animate-spin" /> {m.progress ?? 0}%
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle size={13} /> 失败
        </span>
      )
    default:
      return <span className="text-xs text-text-muted">未下载</span>
  }
}

/**
 * AI 与模型 Tab：模型清单 + 下载按钮 + 实时进度。
 * 监听 electronAPI.onModelDownloadProgress 更新进度并同步 store。
 */
export function ModelSettings() {
  const { models, pluginsEnabled, load, downloadModel, refreshModels } = usePluginStore()

  useEffect(() => {
    if (!usePluginStore.getState().loaded) void load()
  }, [load])

  // 订阅下载进度 → 局部更新 store.models
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onModelDownloadProgress) return
    const unsub = api.onModelDownloadProgress((data) => {
      if (data.progress < 0) {
        void refreshModels()
        return
      }
      usePluginStore.setState((s) => ({
        models: s.models.map((m) =>
          m.id === data.modelId
            ? {
                ...m,
                state: data.progress >= 100 ? 'downloaded' : 'downloading',
                progress: data.progress,
              }
            : m,
        ),
      }))
    })
    return () => unsub?.()
  }, [refreshModels])

  if (!pluginsEnabled) {
    return (
      <div className="p-6">
        <p className="text-sm text-text-muted">请先在「插件」页开启插件系统。</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-3">
      {models.length === 0 && (
        <p className="text-sm text-text-muted py-6 text-center">当前无已注册模型</p>
      )}
      {models.map((m) => (
        <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
          <Cpu size={16} className="text-text-muted shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{m.name}</div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>{m.id}</span>
              <span>·</span>
              <span>{fmtSize(m.size)}</span>
            </div>
            {m.state === 'downloading' && (
              <div className="mt-1.5 w-full h-1 bg-canvas-tertiary rounded-full overflow-hidden border border-border">
                <div className="h-full bg-accent transition-all" style={{ width: `${m.progress ?? 0}%` }} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {stateBadge(m)}
            {(m.state === 'not-downloaded' || m.state === 'failed') && (
              <button
                onClick={() => void downloadModel(m.id)}
                disabled={!m.url}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors disabled:opacity-40"
                title={m.url ? '下载模型' : '无可用下载地址'}
              >
                <Download size={12} /> 下载
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
