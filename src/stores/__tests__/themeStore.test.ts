import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThemeStore, ACCENT_PRESETS } from '../themeStore'

// jsdom 未实现 matchMedia，getSystemTheme() 需要它
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false, // 系统偏好浅色
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

const root = () => document.documentElement

function resetDom() {
  const r = root()
  r.removeAttribute('data-theme')
  r.removeAttribute('data-accent')
  r.removeAttribute('data-density')
  r.style.removeProperty('--color-accent')
  r.style.removeProperty('--color-accent-hover')
}

describe('themeStore.applyTheme', () => {
  beforeEach(() => {
    useThemeStore.setState({
      enabled: false,
      mode: 'dark',
      accentColor: '#7c6ef0',
      density: 'comfortable',
    })
    resetDom()
  })

  it('enabled=false：强制深色回退，清除 accent/density 与自定义变量', () => {
    // 先制造一些"脏"状态
    root().setAttribute('data-accent', 'blue')
    root().style.setProperty('--color-accent', '#123456')
    useThemeStore.getState().applyTheme()
    expect(root().getAttribute('data-theme')).toBe('dark')
    expect(root().hasAttribute('data-accent')).toBe(false)
    expect(root().hasAttribute('data-density')).toBe(false)
    expect(root().style.getPropertyValue('--color-accent')).toBe('')
  })

  it('enabled=true + mode=light：data-theme=light', () => {
    useThemeStore.setState({ enabled: true, mode: 'light' })
    useThemeStore.getState().applyTheme()
    expect(root().getAttribute('data-theme')).toBe('light')
  })

  it('enabled=true + mode=system：解析为系统偏好（matchMedia.matches=false → light）', () => {
    useThemeStore.setState({ enabled: true, mode: 'system' })
    useThemeStore.getState().applyTheme()
    expect(root().getAttribute('data-theme')).toBe('light')
  })

  it('预设强调色（大小写不敏感）→ data-accent，且不写 inline 变量', () => {
    useThemeStore.setState({ enabled: true })
    // 蓝色预设，故意用小写触发大小写不敏感匹配
    useThemeStore.getState().setAccentColor('#3b82f6')
    expect(root().dataset.accent).toBe('blue')
    expect(root().style.getPropertyValue('--color-accent')).toBe('')
  })

  it('默认预设 #7c6ef0 → violet', () => {
    useThemeStore.setState({ enabled: true })
    useThemeStore.getState().setAccentColor('#7C6EF0') // 大写
    expect(root().dataset.accent).toBe('violet')
  })

  it('自定义强调色 → 移除 data-accent，写 inline --color-accent 与 hover', () => {
    useThemeStore.setState({ enabled: true })
    useThemeStore.getState().setAccentColor('#123456')
    expect(root().hasAttribute('data-accent')).toBe(false)
    expect(root().style.getPropertyValue('--color-accent')).toBe('#123456')
    // adjustBrightness('#123456', 15) => #214365
    expect(root().style.getPropertyValue('--color-accent-hover')).toBe('#214365')
  })

  it('密度写入 data-density', () => {
    useThemeStore.setState({ enabled: true })
    useThemeStore.getState().setDensity('compact')
    expect(root().dataset.density).toBe('compact')
  })

  it('setEnabled(false) 从自定义色回退到深色纯净态', () => {
    useThemeStore.setState({ enabled: true })
    useThemeStore.getState().setAccentColor('#123456')
    useThemeStore.getState().setEnabled(false)
    expect(root().getAttribute('data-theme')).toBe('dark')
    expect(root().hasAttribute('data-accent')).toBe(false)
    expect(root().style.getPropertyValue('--color-accent')).toBe('')
  })

  it('ACCENT_PRESETS 提供 6 种预设', () => {
    expect(ACCENT_PRESETS).toHaveLength(6)
  })
})
