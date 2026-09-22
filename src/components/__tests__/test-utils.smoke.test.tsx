import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, installElectronApiMock, flushAsync } from './test-utils'
import type { ElectronAPI } from '@/types'

/**
 * jsdom polyfill + test-utils 基建自检（§5.2 试点前置）。
 * 目的：确认组件测试层的浏览器 API 骨架与 electronAPI 自动 mock 可用，
 * 再批量补真实组件用例。不耦合具体业务组件、不依赖 jest-dom。
 */
function Probe() {
  const mql = window.matchMedia('(min-width: 640px)')
  const ro = new ResizeObserver(() => {})
  ro.observe(document.body)
  return <div data-testid="probe" data-matches={String(mql.matches)} data-has-adapter={typeof mql.addEventListener === 'function'}>probe</div>
}

describe('组件测试基建 polyfill', () => {
  it('matchMedia 可用且默认不匹配', () => {
    render(<Probe />)
    const el = screen.getByTestId('probe')
    expect(el.getAttribute('data-matches')).toBe('false')
    expect(el.getAttribute('data-has-adapter')).toBe('true')
  })

  it('ResizeObserver / IntersectionObserver / getBoundingClientRect 已就位', () => {
    expect(typeof window.ResizeObserver).toBe('function')
    expect(typeof window.IntersectionObserver).toBe('function')
    const el = document.createElement('div')
    document.body.appendChild(el)
    const rect = el.getBoundingClientRect()
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  })

  it('canvas getContext 返回可用 2D 骨架', () => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d') as unknown as { measureText: (t: string) => { width: number } } | null
    expect(ctx).toBeTruthy()
    expect(typeof ctx!.measureText('x').width).toBe('number')
  })

  it('fireEvent 交互可驱动', () => {
    const onClick = vi.fn()
    render(<button onClick={onClick}>go</button>)
    fireEvent.click(screen.getByText('go'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('electronAPI 自动 mock（Proxy）', () => {
  it('未指定的方法返回 resolve undefined；on* 返回 unsubscribe；override 生效', async () => {
    const api = installElectronApiMock({
      getSearchPresets: async () => [{ id: 1, name: 'p', criteria: {} }],
    })
    const loose = api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>

    // override 生效
    await expect(loose.getSearchPresets()).resolves.toEqual([{ id: 1, name: 'p', criteria: {} }])
    // 未覆盖的方法自动生成，默认 resolve undefined
    await expect(loose.getImages()).resolves.toBeUndefined()
    // on* 订阅返回 unsubscribe 函数
    const unsub = (api as Partial<ElectronAPI>).onScanProgress?.(() => {})
    expect(typeof unsub).toBe('function')
    // 同一访问返回稳定引用
    expect(loose.getImages).toBe(loose.getImages)
    await flushAsync()
  })
})
