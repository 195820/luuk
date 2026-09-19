import { describe, it, expect, beforeEach } from 'vitest'
import { usePluginStore } from '../pluginStore'
import type { PluginInfo, ModelInfo } from '../../types/plugin'

function plugin(overrides: Partial<PluginInfo> & { id: string; models?: string[]; ops?: string[] }): PluginInfo {
  return {
    manifest: {
      id: overrides.id,
      name: overrides.id,
      version: '1.0.0',
      apiVersion: '^1.0.0',
      kind: 'ai-transform',
      entry: 'index.js',
      capabilities: [],
      permissions: [],
      requires: { models: (overrides.models ?? []).map((m) => ({ id: m, size: 1, sha256: '' })) },
      contributes: { ops: (overrides.ops ?? []).map((o) => ({ id: o, capability: 'c' })) },
    },
    state: overrides.state ?? 'activated',
    path: '/x',
    isBuiltin: true,
  } as PluginInfo
}

describe('pluginStore · op 可见性三条件（Suggestion #16）', () => {
  beforeEach(() => {
    usePluginStore.setState({
      plugins: [],
      models: [],
      pluginsEnabled: true,
      loaded: true,
    })
  })

  it('插件启用 + 无模型需求 → 可见', () => {
    usePluginStore.setState({ plugins: [plugin({ id: 'a', ops: ['a.run'] })] })
    expect(usePluginStore.getState().isOpVisible('a', 'a.run')).toBe(true)
  })

  it('feature flag 关闭 → 不可见', () => {
    usePluginStore.setState({ plugins: [plugin({ id: 'a', ops: ['a.run'] })], pluginsEnabled: false })
    expect(usePluginStore.getState().isOpVisible('a', 'a.run')).toBe(false)
  })

  it('插件未激活 → 不可见', () => {
    usePluginStore.setState({ plugins: [plugin({ id: 'a', ops: ['a.run'], state: 'idle' as any })] })
    expect(usePluginStore.getState().isOpVisible('a', 'a.run')).toBe(false)
  })

  it('模型未下载 → 不可见', () => {
    usePluginStore.setState({
      plugins: [plugin({ id: 'a', ops: ['a.run'], models: ['m1'] })],
      models: [{ id: 'm1', name: 'm1', size: 1, sha256: '', state: 'not-downloaded' } as ModelInfo],
    })
    expect(usePluginStore.getState().isOpVisible('a', 'a.run')).toBe(false)
  })

  it('模型已下载 → 可见', () => {
    usePluginStore.setState({
      plugins: [plugin({ id: 'a', ops: ['a.run'], models: ['m1'] })],
      models: [{ id: 'm1', name: 'm1', size: 1, sha256: '', state: 'downloaded' } as ModelInfo],
    })
    expect(usePluginStore.getState().isOpVisible('a', 'a.run')).toBe(true)
  })

  it('op 不属于插件 → 不可见', () => {
    usePluginStore.setState({ plugins: [plugin({ id: 'a', ops: ['a.run'] })] })
    expect(usePluginStore.getState().isOpVisible('a', 'a.other')).toBe(false)
  })

  it('未知插件 → 不可见', () => {
    expect(usePluginStore.getState().isOpVisible('ghost', 'x')).toBe(false)
  })
})

describe('P2-17 · pluginStore.getOpAvailability（区分隐藏与置灰需下载模型）', () => {
  beforeEach(() => {
    usePluginStore.setState({ plugins: [], models: [], pluginsEnabled: true, loaded: true })
  })

  it('已激活 + 模型已下载 → visible、无需模型', () => {
    usePluginStore.setState({
      plugins: [plugin({ id: 'a', ops: ['a.run'], models: ['m1'] })],
      models: [{ id: 'm1', name: 'm1', size: 1, sha256: '', state: 'downloaded' } as ModelInfo],
    })
    expect(usePluginStore.getState().getOpAvailability('a', 'a.run')).toEqual({ visible: true, needsModel: false })
  })

  it('已激活但模型未下载 → visible、needsModel（展示但置灰）', () => {
    usePluginStore.setState({
      plugins: [plugin({ id: 'a', ops: ['a.run'], models: ['m1'] })],
      models: [{ id: 'm1', name: 'm1', size: 1, sha256: '', state: 'not-downloaded' } as ModelInfo],
    })
    expect(usePluginStore.getState().getOpAvailability('a', 'a.run')).toEqual({ visible: true, needsModel: true })
  })

  it('feature flag 关闭 → 完全隐藏', () => {
    usePluginStore.setState({
      plugins: [plugin({ id: 'a', ops: ['a.run'], models: ['m1'] })],
      pluginsEnabled: false,
    })
    expect(usePluginStore.getState().getOpAvailability('a', 'a.run')).toEqual({ visible: false, needsModel: false })
  })

  it('插件未激活 → 完全隐藏（即使有模型需求也不置灰）', () => {
    usePluginStore.setState({ plugins: [plugin({ id: 'a', ops: ['a.run'], models: ['m1'], state: 'idle' as any })] })
    expect(usePluginStore.getState().getOpAvailability('a', 'a.run')).toEqual({ visible: false, needsModel: false })
  })

  it('op 不属于插件 / 未知插件 → 隐藏', () => {
    usePluginStore.setState({ plugins: [plugin({ id: 'a', ops: ['a.run'] })] })
    expect(usePluginStore.getState().getOpAvailability('a', 'a.other').visible).toBe(false)
    expect(usePluginStore.getState().getOpAvailability('ghost', 'x').visible).toBe(false)
  })

  it('isOpVisible 与可用性一致（= visible && !needsModel）', () => {
    usePluginStore.setState({
      plugins: [plugin({ id: 'a', ops: ['a.run'], models: ['m1'] })],
      models: [{ id: 'm1', name: 'm1', size: 1, sha256: '', state: 'not-downloaded' } as ModelInfo],
    })
    expect(usePluginStore.getState().getOpAvailability('a', 'a.run').needsModel).toBe(true)
    expect(usePluginStore.getState().isOpVisible('a', 'a.run')).toBe(false)
  })
})
