// src/lib/motion-presets.ts
import type { Transition } from 'motion/react'

/**
 * Liquid Glass 动效预设
 * 所有 spring 参数经过调优，匹配玻璃材质的"厚重感"
 */
export const motionPresets = {
  /** 微交互 — 按钮 hover/click */
  micro: { type: 'spring' as const, stiffness: 400, damping: 30 },

  /** 面板展开 — Sidebar, Dialog */
  panel: { type: 'spring' as const, stiffness: 300, damping: 30 },

  /** 页面过渡 — 图片翻页 */
  page: { type: 'tween' as const, duration: 0.3, ease: [0.4, 0, 0.2, 1] as const },

  /** 缩放 — 图片缩放/拖拽回弹 */
  zoom: { type: 'spring' as const, stiffness: 200, damping: 25 },

  /** 淡入淡出 — 工具栏显隐 */
  fade: { duration: 0.2, ease: 'easeOut' as const },
} satisfies Record<string, Transition>

/** 常用 Motion 变体 */
export const motionVariants = {
  /** 淡入 + 上移 4px */
  fadeInUp: {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
  },
  /** 缩放弹出 0.95 → 1 */
  scaleIn: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },
  /** 侧边滑入 */
  slideInLeft: {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  },
}
