import { create } from 'zustand'
import type { PluginInfo, ModelInfo } from '../types/plugin'
import type { MenuItemDefinition } from '../types/plugin'

/**
 * 插件前端状态：聚合插件列表、菜单贡献项、模型清单与 feature flag。
 * op 可见性三条件（§5.11 / Suggestion #16）：
 *   插件已启用（state==='activated'） ∧ 所需模型均已下载
 *   （isAvailable() 运行于 Worker，渲染进程无法直接探测，此处按已激活近似）
 */
interface PluginState {
  plugins: PluginInfo[]
  menuItems: MenuItemDefinition[]
  models: ModelInfo[]
  pluginsEnabled: boolean
  loaded: boolean
  loading: boolean

  load: () => Promise<void>
  refreshModels: () => Promise<void>
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>
  setPluginsFeatureEnabled: (enabled: boolean) => Promise<void>
  downloadModel: (modelId: string) => Promise<void>
  isOpVisible: (pluginId: string, opId: string) => boolean
}

/** 判断插件所需模型是否均已下载（无模型需求视为满足） */
function modelsReady(plugin: PluginInfo, models: ModelInfo[]): boolean {
  const required = plugin.manifest.requires?.models ?? []
  if (required.length === 0) return true
  return required.every((req) => {
    const m = models.find((mm) => mm.id === req.id)
    return m?.state === 'downloaded'
  })
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  menuItems: [],
  models: [],
  pluginsEnabled: false,
  loaded: false,
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const api = window.electronAPI
      const [pluginsRes, menuRes, modelsRes, flagRes] = await Promise.all([
        api.pluginsList(),
        api.pluginsGetMenuItems(),
        api.modelsList(),
        api.settingsGet('plugins.enabled'),
      ])
      set({
        plugins: pluginsRes.success ? pluginsRes.data ?? [] : [],
        menuItems: menuRes.success ? menuRes.data ?? [] : [],
        models: modelsRes.success ? modelsRes.data ?? [] : [],
        pluginsEnabled: flagRes.success ? Boolean(flagRes.data) : false,
        loaded: true,
        loading: false,
      })
    } catch (err) {
      console.error('加载插件状态失败:', err)
      set({ loading: false })
    }
  },

  refreshModels: async () => {
    const res = await window.electronAPI.modelsList()
    if (res.success) set({ models: res.data ?? [] })
  },

  setPluginEnabled: async (pluginId, enabled) => {
    const res = await window.electronAPI.pluginsSetEnabled(pluginId, enabled)
    if (!res.success) {
      console.error('切换插件失败:', res.error)
      return
    }
    // 重新拉取插件与菜单（启用状态影响菜单贡献）
    await get().load()
  },

  setPluginsFeatureEnabled: async (enabled) => {
    await window.electronAPI.settingsSet('plugins.enabled', enabled)
    set({ pluginsEnabled: enabled })
    await get().load()
  },

  downloadModel: async (modelId) => {
    await window.electronAPI.modelsDownload(modelId)
    set((s) => ({
      models: s.models.map((m) => (m.id === modelId ? { ...m, state: 'downloading', progress: 0 } : m)),
    }))
  },

  isOpVisible: (pluginId, opId) => {
    const { plugins, models, pluginsEnabled } = get()
    if (!pluginsEnabled) return false
    const plugin = plugins.find((p) => p.manifest.id === pluginId)
    if (!plugin || plugin.state !== 'activated') return false
    const hasOp = (plugin.manifest.contributes?.ops ?? []).some((op) => op.id === opId)
    if (!hasOp) return false
    return modelsReady(plugin, models)
  },
}))
