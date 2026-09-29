/**
 * T10 — Agent IPC 边界单测（Key 只写不读、默认全关零装配）
 * 覆盖：getJevStatus 不回吐 API Key 明文、开关/Key 变更后重新装配升级链、
 *       启动装配在 flag 关闭时不触碰插件系统
 */
import os from 'os'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      mocks.handlers.set(channel, fn)
    },
    removeHandler: (channel: string) => {
      mocks.handlers.delete(channel)
    },
  },
}))

/** settings / plugin-manager / database 全部替身：本用例只验证 IPC 边界与装配编排 */
const state = vi.hoisted(() => ({
  settings: { 'jev.enabled': false as boolean, 'jev.apiKey': '', 'plugins.enabled': true },
  pluginEnabled: false,
  setEnabledCalls: [] as Array<{ id: string; enabled: boolean }>,
  setEnabledError: null as Error | null,
}))

vi.mock('../../services/settings-service', () => ({
  getSetting: (key: string) => (state.settings as Record<string, unknown>)[key],
  setSetting: (key: string, value: unknown) => {
    ;(state.settings as Record<string, unknown>)[key] = value
  },
}))

vi.mock('../../services/plugin-manager', () => ({
  getPluginManager: () => ({
    isPluginEnabled: () => state.pluginEnabled,
    getPluginInfo: (id: string) => ({ id, state: state.pluginEnabled ? 'activated' : 'valid' }),
    setEnabled: async (id: string, enabled: boolean) => {
      state.setEnabledCalls.push({ id, enabled })
      if (state.setEnabledError) throw state.setEnabledError
      state.pluginEnabled = enabled
    },
    executeOp: async () => ({}),
  }),
}))

vi.mock('../../services/database', () => ({
  getMasterDB: () => ({}),
}))

import { ensureAgentDecisionLayer, registerAgentHandlers, unregisterAgentHandlers } from '../agent-handlers'
import { JEV_PLUGIN_ID } from '../../plugins/builtins/jev-decision'

const SECRET = 'sk-jev-secret-1234567890'

/** IPC 统一包装形式：{ success, data | error } */
interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** 取已注册的 handler 并直接调用（等价于渲染进程 invoke；首参为 Electron 事件对象） */
function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const fn = mocks.handlers.get(channel) as ((...a: unknown[]) => Promise<IpcResult<T>>) | undefined
  if (!fn) throw new Error(`未注册的 IPC channel: ${channel}`)
  return fn({} as unknown, ...args)
}

beforeEach(() => {
  state.settings = { 'jev.enabled': false, 'jev.apiKey': '', 'plugins.enabled': true }
  state.pluginEnabled = false
  state.setEnabledCalls = []
  state.setEnabledError = null
  mocks.handlers.clear()
  registerAgentHandlers()
})

describe('API Key 隐私边界（D9）', () => {
  it('getJevStatus 只回 hasKey，响应全文不含 Key 明文', async () => {
    state.settings['jev.apiKey'] = SECRET

    const res = await invoke<{ hasKey: boolean }>('getJevStatus')
    expect(res.success).toBe(true)
    expect(res.data?.hasKey).toBe(true)
    expect(JSON.stringify(res)).not.toContain(SECRET)
  })

  it('setJevApiKey 写入后返回状态同样不含 Key', async () => {
    const res = await invoke<{ hasKey: boolean }>('setJevApiKey', `  ${SECRET}  `)
    expect(state.settings['jev.apiKey']).toBe(SECRET) // trim 后落盘
    expect(res.data?.hasKey).toBe(true)
    expect(JSON.stringify(res)).not.toContain(SECRET)
  })
})

describe('开关变更 → 决策层重新装配', () => {
  it('flag + Key 齐备 → 启用内置 Jev 插件并入链', async () => {
    state.settings['jev.apiKey'] = SECRET
    const res = await invoke<{ jevRegistered: boolean; pluginEnabled: boolean }>('setJevEnabled', true)

    expect(res.data?.jevRegistered).toBe(true)
    expect(res.data?.pluginEnabled).toBe(true)
    expect(state.setEnabledCalls).toEqual([{ id: JEV_PLUGIN_ID, enabled: true }])
  })

  it('缺 Key → 开关置真也不入链，插件系统零改动', async () => {
    const res = await invoke<{ jevRegistered: boolean; enabled: boolean }>('setJevEnabled', true)

    expect(res.data?.enabled).toBe(true)
    expect(res.data?.jevRegistered).toBe(false)
    expect(state.setEnabledCalls).toHaveLength(0)
  })

  it('插件启用失败 → 回传原因且标记未入链（本地规则继续兜底）', async () => {
    state.settings['jev.enabled'] = true
    state.settings['jev.apiKey'] = SECRET
    state.setEnabledError = new Error('插件系统未启用')

    const res = await invoke<{ jevRegistered: boolean; jevError?: string }>('setJevApiKey', SECRET)
    expect(res.data?.jevRegistered).toBe(false)
    expect(res.data?.jevError).toBe('插件系统未启用')
  })
})

describe('启动装配（ensureAgentDecisionLayer）', () => {
  it('默认关闭 → 直接返回，不触碰插件系统', async () => {
    await ensureAgentDecisionLayer()
    expect(state.setEnabledCalls).toHaveLength(0)
  })

  it('开启后启动即入链', async () => {
    state.settings['jev.enabled'] = true
    state.settings['jev.apiKey'] = SECRET

    await ensureAgentDecisionLayer()
    expect(state.setEnabledCalls).toEqual([{ id: JEV_PLUGIN_ID, enabled: true }])
  })
})

describe('注销', () => {
  it('unregisterAgentHandlers 移除三个 channel', () => {
    unregisterAgentHandlers()
    expect([...mocks.handlers.keys()]).toEqual([])
  })
})
