import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious'

interface ThemeState {
  mode: ThemeMode
  accentColor: string
  density: ThemeDensity

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
      mode: 'dark',
      accentColor: '#7c6ef0',
      density: 'comfortable',

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

        const resolved = resolveTheme(get().mode)
        const root = document.documentElement

        // 设置 data-theme 属性
        root.setAttribute('data-theme', resolved)

        // 设置强调色 CSS 变量
        root.style.setProperty('--color-accent', get().accentColor)

        // 计算强调色 hover 状态（稍微提亮）
        const hoverColor = adjustBrightness(get().accentColor, 15)
        root.style.setProperty('--color-accent-hover', hoverColor)

        // 设置密度相关变量
        const density = get().density
        const paddingMap: Record<ThemeDensity, string> = {
          compact: '8px',
          comfortable: '12px',
          spacious: '16px',
        }
        root.style.setProperty('--density-padding', paddingMap[density])

        const gapMap: Record<ThemeDensity, string> = {
          compact: '6px',
          comfortable: '8px',
          spacious: '12px',
        }
        root.style.setProperty('--density-gap', gapMap[density])
      },
    }),
    {
      name: 'theme-storage',
      partialize: (state) => ({
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
