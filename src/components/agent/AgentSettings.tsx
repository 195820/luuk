/**
 * T20 — AgentSettings（采集 Agent 设置分区）
 * 三开关：agent.enabled（定时调度总闸）/ crawler.enabled（执行闸）/ jev.enabled（云端决策，默认关）。
 * Jev Key 只写不读：界面仅显示 hasKey，明文永不出主进程（D9）。
 * 定时间隔变更后由主进程 handler 调 AgentScheduler.reschedule()（M1 修正口径）；
 * 画像重建节流固定 5 分钟（展示项，非可配）。
 */
import { useEffect, useState } from 'react'
import { X, Bot, KeyRound, Loader2, Sparkles } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import type { JevStatus, AiStatus } from '../../types'

interface Props {
  onClose: () => void
}

const INTERVAL_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 15 * 60 * 1000, label: '15 分钟' },
  { ms: 60 * 60 * 1000, label: '1 小时' },
  { ms: 3 * 60 * 60 * 1000, label: '3 小时' },
  { ms: 6 * 60 * 60 * 1000, label: '6 小时' },
  { ms: 12 * 60 * 60 * 1000, label: '12 小时' },
  { ms: 24 * 60 * 60 * 1000, label: '24 小时' },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full border transition-colors shrink-0 ${
        checked ? 'bg-accent border-accent' : 'bg-overlay-lighter border-border'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export function AgentSettings({ onClose }: Props) {
  const status = useAgentStore(s => s.status)
  const setAgentEnabled = useAgentStore(s => s.setAgentEnabled)
  const setAgentIntervalMs = useAgentStore(s => s.setAgentIntervalMs)
  const setCrawlerEnabled = useAgentStore(s => s.setCrawlerEnabled)
  const setJevEnabled = useAgentStore(s => s.setJevEnabled)
  const setJevApiKey = useAgentStore(s => s.setJevApiKey)

  const [jev, setJev] = useState<JevStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)

  const [ai, setAi] = useState<AiStatus | null>(null)
  const [aiSaving, setAiSaving] = useState(false)

  useEffect(() => {
    void window.electronAPI.getJevStatus().then(r => { if (r.success && r.data) setJev(r.data) })
  }, [])

  useEffect(() => {
    void window.electronAPI.getAiStatus().then(r => { if (r.success && r.data) setAi(r.data) })
  }, [])

  const toggleAi = async (v: boolean) => {
    if (aiSaving) return
    setAiSaving(true)
    const r = await window.electronAPI.setAiEnabled(v)
    if (r.success) {
      const s = await window.electronAPI.getAiStatus()
      if (s.success && s.data) setAi(s.data)
    }
    setAiSaving(false)
  }

  const intervalMs = status?.intervalMs ?? 6 * 60 * 60 * 1000

  const saveKey = async () => {
    setSaving(true)
    await setJevApiKey(keyInput)
    const r = await window.electronAPI.getJevStatus()
    if (r.success && r.data) setJev(r.data)
    setKeyInput('')
    setSaving(false)
  }

  const clearKey = async () => {
    setSaving(true)
    await setJevApiKey('')
    const r = await window.electronAPI.getJevStatus()
    if (r.success && r.data) setJev(r.data)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-l2 w-[520px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Bot size={20} />采集 Agent 设置</h2>
          <button onClick={onClose} className="btn-icon-sm hover:bg-overlay-lighter rounded-md p-1.5"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* agent.enabled */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="text-sm font-medium block">启用定时采集</label>
              <span className="text-xs text-text-muted">按下方间隔自动发现候选并生成提案</span>
            </div>
            <Toggle checked={!!status?.enabled} onChange={v => void setAgentEnabled(v)} />
          </div>

          {/* crawler.enabled */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="text-sm font-medium block">启用采集执行层</label>
              <span className="text-xs text-text-muted">双闸：关闭时下载/抓取整体停用（零网络）</span>
            </div>
            <Toggle checked={!!status?.crawlerEnabled} onChange={v => void setCrawlerEnabled(v)} />
          </div>

          {/* 间隔 */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="text-sm font-medium block">采集间隔</label>
              <span className="text-xs text-text-muted">变更后即时重建定时任务（下限 60 秒）</span>
            </div>
            <select
              value={intervalMs}
              onChange={e => void setAgentIntervalMs(Number(e.target.value))}
              className="glass-input text-sm px-2 py-1 rounded-md"
            >
              {INTERVAL_OPTIONS.map(o => <option key={o.ms} value={o.ms}>{o.label}</option>)}
            </select>
          </div>

          <div className="text-xs text-text-muted border-t border-border pt-4">
            画像重建节流：<span className="text-text-secondary">5 分钟</span>（固定口径，避免高频重建）；
            待确认提案：<span className="text-text-secondary">{status?.pendingProposals ?? 0}</span> 条
          </div>

          {/* Jev 云端决策（默认关，隐私敏感） */}
          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium block flex items-center gap-1.5"><KeyRound size={14} />Jev 云端决策</label>
                <span className="text-xs text-text-muted">
                  可选增强：仅发文本元数据（D9），需插件系统与 API Key 同时就绪才入链
                </span>
              </div>
              <Toggle checked={!!jev?.enabled} onChange={v => void setJevEnabled(v)} />
            </div>

            <div className="flex items-center gap-2 text-sm">
              <input
                type="password"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                placeholder={jev?.hasKey ? 'API Key 已设置（留空不改）' : '输入 Jev API Key'}
                className="glass-input flex-1 px-2 py-1 rounded-md"
              />
              <button disabled={saving || !keyInput.trim()} onClick={() => void saveKey()} className="px-3 py-1 rounded-md bg-accent text-white disabled:opacity-40 flex items-center gap-1">
                {saving && <Loader2 size={14} className="animate-spin" />}保存
              </button>
              {jev?.hasKey && (
                <button disabled={saving} onClick={() => void clearKey()} className="px-3 py-1 rounded-md hover:bg-overlay-lighter text-text-secondary">清除</button>
              )}
            </div>

            {jev && (
              <div className="text-xs text-text-muted flex flex-wrap gap-x-4 gap-y-1">
                <span>插件系统：{jev.pluginsEnabled ? '开' : '关'}</span>
                <span>Jev 插件：{jev.pluginEnabled ? '启用' : '停用'}（{jev.pluginState}）</span>
                <span>Key：{jev.hasKey ? '已设置' : '未设置'}</span>
                <span>调用 {jev.stats.calls} / 成功 {jev.stats.successes} / 回落 {jev.stats.failures} / 跳过 {jev.stats.skipped}</span>
              </div>
            )}
          </div>

          {/* AI 向量索引（T21，默认关；开启后扫描完成自动增量索引） */}
          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium block flex items-center gap-1.5"><Sparkles size={14} />AI 向量索引</label>
                <span className="text-xs text-text-muted">
                  本地 CLIP 图像嵌入（int8）：开启后扫描完成自动为新增图片建向量索引（模型缺失/校验失败则不启用推理）
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {aiSaving && <Loader2 size={14} className="animate-spin text-text-muted" />}
                <Toggle checked={!!ai?.enabled} onChange={v => void toggleAi(v)} />
              </div>
            </div>
            {ai && (
              <div className="text-xs text-text-muted flex flex-wrap gap-x-4 gap-y-1">
                <span>已索引：<span className="text-text-secondary">{ai.indexed}</span> 张</span>
                <span>待索引：<span className="text-text-secondary">{ai.pending}</span> 张</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
