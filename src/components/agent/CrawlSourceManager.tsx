/**
 * T19 — CrawlSourceManager（信息源管理）
 * crawl_sources CRUD + 三 IPC（triggerCrawlDiscovery / getSourceLoginStatus / startSourceLogin）。
 * 建源时 config 在主进程过 parseCrawlSourceConfig 校验（app-bridge 禁建，非法 op 名报错回传）。
 * 扫码登录走 startSourceLogin（D11：用户本人扫码，凭证只落 persist 分区，不下发渲染进程）。
 */
import { useCallback, useEffect, useState } from 'react'
import { X, Plus, Trash2, RefreshCw, Play, LogIn, Loader2 } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import type { ConnectorType, CrawlSourceRecord } from '../../types'
import { logger } from '../../utils/logger'

interface Props {
  onClose: () => void
}

/** 已知采集适配器插件（web/pc-app 三端）；未列出可手填 */
const KNOWN_ADAPTERS: Array<{ id: string; label: string; connector: ConnectorType }> = [
  { id: 'builtin.bili-web', label: 'B 站图文（web-browser）', connector: 'web-browser' },
  { id: 'builtin.xhs-web', label: '小红书（web-browser）', connector: 'web-browser' },
  { id: 'builtin.tg-mtproto', label: 'Telegram 主通道（pc-app）', connector: 'pc-app' },
  { id: 'builtin.tg-export-import', label: 'Telegram 导出导入（pc-app）', connector: 'pc-app' },
]

const HEALTH_STYLE: Record<CrawlSourceRecord['health'], string> = {
  ok: 'text-green-400',
  degraded: 'text-amber-400',
}

export function CrawlSourceManager({ onClose }: Props) {
  const sources = useAgentStore(s => s.sources)
  const loadingSources = useAgentStore(s => s.loadingSources)
  const refreshSources = useAgentStore(s => s.refreshSources)
  const createSource = useAgentStore(s => s.createSource)
  const deleteSource = useAgentStore(s => s.deleteSource)
  const toggleSource = useAgentStore(s => s.toggleSource)
  const triggerDiscovery = useAgentStore(s => s.triggerDiscovery)

  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loginState, setLoginState] = useState<Record<number, boolean | null>>({})

  const flash = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text })
    window.setTimeout(() => setToast(null), 3000)
  }, [])

  useEffect(() => { void refreshSources() }, [refreshSources])

  const checkLogin = useCallback(async (s: CrawlSourceRecord) => {
    try {
      const res = await window.electronAPI.getSourceLoginStatus(s.id)
      setLoginState(prev => ({ ...prev, [s.id]: res.success ? !!res.data?.loggedIn : null }))
    } catch (err) {
      logger.error('CrawlSourceManager', 'getSourceLoginStatus 失败', err)
    }
  }, [])

  const doLogin = useCallback(async (s: CrawlSourceRecord) => {
    const res = await window.electronAPI.startSourceLogin(s.id)
    if (!res.success) { flash(false, res.error ?? '登录窗口打开失败'); return }
    setLoginState(prev => ({ ...prev, [s.id]: !!res.data?.loggedIn }))
    flash(!!res.data?.loggedIn, res.data?.loggedIn ? '登录态已就绪' : '未完成登录')
  }, [flash])

  const runTrigger = useCallback(async (id: number) => {
    const res = await triggerDiscovery([id])
    flash(res.ok, res.message)
  }, [triggerDiscovery, flash])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-l2 flex flex-col w-[720px] max-h-[80vh]">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            信息源管理
            <span className="text-xs font-normal text-text-muted">{sources.length} 个</span>
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAdd(v => !v)} className="px-2.5 py-1 rounded-md text-sm bg-accent text-white flex items-center gap-1">
              <Plus size={14} /> 新建
            </button>
            <button onClick={() => void refreshSources()} className="btn-icon-sm hover:bg-overlay-lighter rounded-md p-1.5">
              <RefreshCw size={16} className={loadingSources ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="btn-icon-sm hover:bg-overlay-lighter rounded-md p-1.5"><X size={16} /></button>
          </div>
        </div>

        {showAdd && (
          <AddSourceForm
            busy={busy}
            onCancel={() => setShowAdd(false)}
            onSubmit={async input => {
              setBusy(true)
              const res = await createSource(input)
              setBusy(false)
              setShowAdd(res.ok ? false : showAdd)
              flash(res.ok, res.message)
            }}
          />
        )}

        <div className="flex-1 overflow-auto p-4 space-y-2">
          {sources.length === 0 && !loadingSources && (
            <div className="text-sm text-text-muted py-8 text-center">还没有信息源，点右上「新建」添加</div>
          )}
          {sources.map(s => (
            <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg bg-overlay-light/40 border border-border/50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{s.name}</span>
                  <span className={`text-xs ${HEALTH_STYLE[s.health]}`}>{s.health === 'ok' ? '健康' : '退让'}</span>
                  {s.successRate != null && <span className="text-xs text-text-muted">{(s.successRate * 100).toFixed(0)}%</span>}
                </div>
                <div className="text-xs text-text-muted truncate mt-0.5">{s.pluginId} · {s.config.connectorType}</div>
              </div>

              <button
                onClick={() => { void checkLogin(s) }}
                className="text-xs px-2 py-1 rounded hover:bg-overlay-lighter text-text-secondary flex items-center gap-1"
                title="检查浏览器登录态（仅 web 连接器）"
              >
                {loginState[s.id] === true ? '已登录' : loginState[s.id] === false ? '未登录' : '登录态?'}
              </button>
              {s.config.connectorType !== 'pc-app' && loginState[s.id] === false && (
                <button onClick={() => void doLogin(s)} className="text-xs px-2 py-1 rounded hover:bg-overlay-lighter text-text-secondary flex items-center gap-1"><LogIn size={13} />扫码</button>
              )}
              <button onClick={() => void runTrigger(s.id)} className="p-1.5 rounded hover:bg-overlay-lighter text-text-secondary" title="立即发现一轮"><Play size={15} /></button>
              <button
                onClick={async () => { const r = await toggleSource(s.id, !s.enabled); flash(r.ok, r.message) }}
                className={`text-xs px-2 py-1 rounded ${s.enabled ? 'bg-green-500/20 text-green-400' : 'bg-overlay-lighter text-text-muted'}`}
              >
                {s.enabled ? '启用' : '停用'}
              </button>
              <button onClick={async () => { const r = await deleteSource(s.id); flash(r.ok, r.message) }} className="p-1.5 rounded hover:bg-red-500/15 text-red-400" title="删除"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-border shrink-0 text-sm">
          {toast ? <span className={toast.ok ? 'text-green-400' : 'text-red-400'}>{toast.text}</span> : '\u00A0'}
        </div>
      </div>
    </div>
  )
}

interface AddSourceFormProps {
  busy: boolean
  onCancel: () => void
  onSubmit: (input: { pluginId: string; name: string; config: import('../../types').CrawlSourceConfig }) => Promise<void>
}

function AddSourceForm({ busy, onCancel, onSubmit }: AddSourceFormProps) {
  const [adapterIdx, setAdapterIdx] = useState(0)
  const [name, setName] = useState('')
  const [params, setParams] = useState('{}')
  const [buildOp, setBuildOp] = useState('')
  const [parseOp, setParseOp] = useState('')
  const [discoverOp, setDiscoverOp] = useState('')

  const adapter = KNOWN_ADAPTERS[adapterIdx]

  const submit = async () => {
    let parsedParams: Record<string, unknown> = {}
    try { parsedParams = params.trim() ? JSON.parse(params) : {} } catch { return }
    await onSubmit({
      pluginId: adapter.id,
      name: name.trim() || adapter.label,
      config: {
        connectorType: adapter.connector,
        params: parsedParams,
        ops: {
          buildRequests: buildOp.trim(),
          parseResponse: parseOp.trim(),
          ...(discoverOp.trim() ? { discover: discoverOp.trim() } : {}),
        },
      },
    })
  }

  return (
    <div className="px-4 py-3 border-b border-border bg-overlay-light/30 space-y-2 shrink-0">
      <div className="flex items-center gap-2">
        <select value={adapterIdx} onChange={e => setAdapterIdx(Number(e.target.value))} className="glass-input text-sm px-2 py-1 rounded-md">
          {KNOWN_ADAPTERS.map((a, i) => <option key={a.id} value={i}>{a.label}</option>)}
        </select>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="信息源名称" className="glass-input text-sm px-2 py-1 rounded-md flex-1" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <input value={buildOp} onChange={e => setBuildOp(e.target.value)} placeholder="buildRequests op 名" className="glass-input px-2 py-1 rounded-md flex-1" />
        <input value={parseOp} onChange={e => setParseOp(e.target.value)} placeholder="parseResponse op 名" className="glass-input px-2 py-1 rounded-md flex-1" />
        {adapter.connector === 'pc-app' && (
          <input value={discoverOp} onChange={e => setDiscoverOp(e.target.value)} placeholder="discover op 名（pc-app 必填）" className="glass-input px-2 py-1 rounded-md flex-1" />
        )}
      </div>
      <textarea value={params} onChange={e => setParams(e.target.value)} placeholder='站点参数 JSON，如 {"keyword":"落日"}' className="glass-input w-full text-sm px-2 py-1 rounded-md h-14 font-mono" />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1 rounded-md text-sm hover:bg-overlay-lighter">取消</button>
        <button disabled={busy || !buildOp.trim() || !parseOp.trim()} onClick={() => void submit()} className="px-3 py-1 rounded-md text-sm bg-accent text-white disabled:opacity-40 flex items-center gap-1">
          {busy && <Loader2 size={14} className="animate-spin" />} 创建
        </button>
      </div>
    </div>
  )
}
