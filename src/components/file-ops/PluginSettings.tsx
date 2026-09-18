import { useEffect, useState } from 'react'
import { Puzzle, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react'
import { usePluginStore } from '../../stores/pluginStore'

/**
 * 插件 Tab：列表 + 启用开关 + 权限展示 + feature flag 引导。
 * 依赖 usePluginStore（plugins / menuItems / pluginsEnabled）。
 */
export function PluginSettings() {
  const {
    plugins,
    pluginsEnabled,
    loading,
    load,
    setPluginEnabled,
    setPluginsFeatureEnabled,
  } = usePluginStore()
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!usePluginStore.getState().loaded) void load()
  }, [load])

  if (!pluginsEnabled) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-overlay-lighter/40">
          <AlertCircle size={18} className="text-accent mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">插件系统当前已关闭</p>
            <p className="text-xs text-text-muted mt-1">
              开启后可加载内置与第三方 AI 插件（自动调色、抠图、超分等）。
            </p>
          </div>
          <button
            onClick={() => void setPluginsFeatureEnabled(true)}
            className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent-hover transition-colors shrink-0"
          >
            开启
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          共 {plugins.length} 个插件
        </p>
        {loading && <Loader2 size={14} className="animate-spin text-text-muted" />}
      </div>

      {plugins.length === 0 && !loading && (
        <p className="text-sm text-text-muted py-6 text-center">未发现插件</p>
      )}

      {plugins.map((plugin) => {
        const id = plugin.manifest.id
        const enabled = plugin.state === 'activated'
        const invalid = plugin.state === 'invalid'
        const crashed = plugin.state === 'crashed'
        const perms = plugin.manifest.permissions ?? []
        return (
          <div key={id} className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center gap-3 p-3">
              <Puzzle size={16} className="text-text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{plugin.manifest.name}</span>
                  <span className="text-xs text-text-muted">v{plugin.manifest.version}</span>
                  {invalid && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">无效</span>
                  )}
                  {crashed && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">已熔断</span>
                  )}
                </div>
                <span className="text-xs text-text-muted">
                  {invalid ? plugin.error ?? '清单校验失败' : `${id} · ${plugin.manifest.kind}`}
                </span>
              </div>
              <button
                className="text-xs text-text-muted hover:text-text-primary px-1"
                onClick={() => setExpanded(expanded === id ? null : id)}
                title="查看权限"
              >
                <ShieldCheck size={14} />
              </button>
              <button
                role="switch"
                aria-checked={enabled}
                disabled={invalid}
                onClick={() => void setPluginEnabled(id, !enabled)}
                className={`relative w-10 h-5 rounded-full border transition-colors shrink-0 disabled:opacity-40 ${
                  enabled ? 'bg-accent border-accent' : 'bg-overlay-lighter border-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 size-3.5 rounded-full bg-white transition-all ${
                    enabled ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
            {expanded === id && (
              <div className="px-3 pb-3 pt-0 text-xs text-text-muted">
                <span className="font-medium text-text-secondary">声明权限：</span>
                {perms.length ? perms.join('、') : '（无）'}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
