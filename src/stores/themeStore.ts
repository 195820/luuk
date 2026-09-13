import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious'

interface ThemeState {
  /** feature flag：关闭时完全回退到深色行为（回滚保障） */
  enabled: boolean
  mode: ThemeMode
  accentColor: string
  density: ThemeDensity

  setEnabled: (v: boolean) => void
  setMode: (mode: ThemeMode) => void
  setAccentColor: (color: string) => void
  setDensity: (density: ThemeDensity) => void

  /** 应用主题到 DOM（data-theme 属性） */
  applyTheme: () => void
}

/** 预设强调色（6 种） */
export const ACCENT_PRESETS = [
  { name: '紫色（默认）', color: '#7c6ef0' },
  { name: '蓝色', color: '#3B82F6' },
  { name: '青色', color: '#06B6D4' },
  { name: '绿色', color: '#10B981' },
  { name: '橙色', color: '#F59E0B' },
  { name: '粉色', color: '#EC4899' },
]

/** 获取系统首选主题（深色/浅色） */
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 获取实际应应用的主题（解析 system） */
function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  return mode === 'system' ? getSystemTheme() : mode
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      enabled: false,  // 默认关闭，需用户在设置面板显式开启
      mode: 'dark',
      accentColor: '#7c6ef0',
      density: 'comfortable',

      setEnabled: (v) => {
        set({ enabled: v })
        get().applyTheme()
      },

      setMode: (mode) => {
        set({ mode })
        get().applyTheme()
      },

      setAccentColor: (color) => {
        set({ accentColor: color })
        get().applyTheme()
      },

      setDensity: (density) => {
        set({ density })
        get().applyTheme()
      },

      applyTheme: () => {
        if (typeof document === 'undefined') return

        const root = document.documentElement

        // feature flag 关闭：完全回退到深色行为
        if (!get().enabled) {
          root.setAttribute('data-theme', 'dark')
          root.removeAttribute('data-accent')
          root.removeAttribute('data-density')
          root.style.removeProperty('--color-accent')
          root.style.removeProperty('--color-accent-hover')
          root.style.removeProperty('--density-padding')
          root.style.removeProperty('--density-gap')
          return
        }

        const resolved = resolveTheme(get().mode)

        // 设置 data-theme 属性
        root.setAttribute('data-theme', resolved)

        // 强调色：优先匹配预设（用 data-accent 触发 CSS 选择器），自定义色用 inline style 兜底
        const accentColor = get().accentColor.toLowerCase()
        const presetMatch = ACCENT_PRESETS.find(p => p.color.toLowerCase() === accentColor)
        if (presetMatch) {
          const presetName = ACCENT_PRESETS.indexOf(presetMatch) === 0 ? 'violet'
            : ACCENT_PRESETS.indexOf(presetMatch) === 1 ? 'blue'
            : ACCENT_PRESETS.indexOf(presetMatch) === 2 ? 'cyan'
            : ACCENT_PRESETS.indexOf(presetMatch) === 3 ? 'green'
            : ACCENT_PRESETS.indexOf(presetMatch) === 4 ? 'orange'
            : 'pink'
          root.dataset.accent = presetName
          root.style.removeProperty('--color-accent')
          root.style.removeProperty('--color-accent-hover')
        } else {
          root.removeAttribute('data-accent')
          root.style.setProperty('--color-accent', accentColor)
          root.style.setProperty('--color-accent-hover', adjustBrightness(accentColor, 15))
        }

        // 密度：用 data-density 触发 CSS 选择器
        root.dataset.density = get().density
      },
    }),
    {
      name: 'theme-storage',
      partialize: (state) => ({
        enabled: state.enabled,
        mode: state.mode,
        accentColor: state.accentColor,
        density: state.density,
      }),
    }
  )
)

/**
 * 调整颜色亮度
 * @param hex HEX 颜色值（如 #7c6ef0）
 * @param percent 亮度调整百分比（正数提亮，负数变暗）
 */
function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + percent))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + percent))
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + percent))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/**
 * 监听系统主题变化（仅在 mode='system' 时生效）
 */
export function watchSystemTheme(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => callback()

  mediaQuery.addEventListener('change', handler)
  return () => mediaQuery.removeEventListener('change', handler)
}
