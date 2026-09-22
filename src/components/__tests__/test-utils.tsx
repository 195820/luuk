/**
 * 组件测试共享工具（Vitest + @testing-library/react + jsdom）。
 * - electronAPI 采用 Proxy 自动方法 mock：任意 xxx 访问返回稳定 vi.fn()（默认 resolve undefined），
 *   事件订阅 onXxx 返回 unsubscribe；避免手写 100+ IPC 键。个别用例通过 overrides 覆盖返回值。
 * - 只 re-export RTL，交互优先用 fireEvent（不依赖 user-event，避免额外装配假设）。
 */
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import * as RTL from '@testing-library/react'
import type { ElectronAPI } from '@/types'

export * from '@testing-library/react'

type ApiOverrides = Partial<Record<keyof ElectronAPI, unknown>>

export function createElectronApiMock(overrides: ApiOverrides = {}): ElectronAPI {
  const cache = new Map<string, ReturnType<typeof vi.fn>>()
  const target: Record<string, unknown> = { ...overrides } as Record<string, unknown>
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(obj, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in obj) return obj[prop]
      if (prop.startsWith('on')) {
        if (!cache.has(prop)) cache.set(prop, vi.fn(() => () => {}))
        return cache.get(prop)
      }
      if (!cache.has(prop)) cache.set(prop, vi.fn(() => Promise.resolve(undefined)))
      return cache.get(prop)
    },
    set(obj, prop, value) {
      if (typeof prop === 'string') obj[prop] = value
      return true
    },
  }
  return new Proxy(target, handler) as unknown as ElectronAPI
}

export function installElectronApiMock(overrides: ApiOverrides = {}): ElectronAPI {
  const api = createElectronApiMock(overrides)
  ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = api
  return api
}

export function renderWithProviders(ui: ReactElement, options?: RTL.RenderOptions) {
  return RTL.render(ui, options)
}

/** 等待挂起的 microtask / promise 链落地（配合 Proxy 异步 IPC mock） */
export const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0))
