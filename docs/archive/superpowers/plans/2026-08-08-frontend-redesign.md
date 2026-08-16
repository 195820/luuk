# 前端全套重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将项目从纯 CSS Modules 迁移至 Tailwind CSS v4 + Liquid Glass 视觉体系，集成 Geist 排版 + Motion 动画 + Lucide 图标 + shadcn/ui 组件。

**Architecture:** Tailwind v4 CSS-first `@theme` 配置承载全部设计 token（颜色/字体/圆角/模糊/阴影）。自定义 `@utility glass-L1/L2/L3` 实现三级液态玻璃深度。所有组件从全局 CSS 类名迁移至 Tailwind 原子化 class。Motion 提供 spring 物理弹性动画。shadcn/ui 组件通过 CSS 变量覆盖适配 Liquid Glass 暗色风格。

**Tech Stack:** Tailwind CSS v4 (`@tailwindcss/vite`) · shadcn/ui (Radix UI) · Motion v11 · Lucide React · Geist Sans/Mono · React 19 · Vite 7 · Electron 40

## Global Constraints

- Tailwind v4 CSS-first 配置，**禁止**生成 `tailwind.config.js`
- 所有设计 token 在 `@theme { }` 中定义，组件中使用 Tailwind 类名
- `@utility glass-L1/L2/L3` 为唯一玻璃材质工具类
- 所有组件 **禁止** 导入 `.css` / `.module.css` 文件（Tailwind 迁移完成后删除原 CSS）
- 字体统一使用 Geist Sans（正文）+ Geist Mono（数据/路径）
- 动画统一使用 Motion 预设（`motionPresets`），禁止手写 `@keyframes`（保留 `skeleton-loader` 的 shimmer）
- 图标统一使用 Lucide React，替换所有手写 SVG
- 保留 `@tanstack/react-virtual` 虚拟滚动，不替换
- 路径别名 `@/*` → `src/*`（已在 tsconfig + vite.config 中配置）

---

## 文件结构

```
新建:
  src/index.css                  — Tailwind 入口 + @theme + @utility + 全局样式
  src/lib/motion-presets.ts      — Motion 动画预设常量
  src/components/ui/             — shadcn/ui 组件目录（CLI 自动生成）

修改:
  package.json                   — 新增依赖
  vite.config.ts                 — 新增 @tailwindcss/vite 插件
  src/main.tsx                   — 新增 Geist 字体导入
  src/App.tsx                    — 移除 CSS 导入，全面 Tailwind 类名
  src/components/ImageViewer.tsx — 移除 CSS 导入，Tailwind + Motion
  src/components/ImageGrid.tsx   — 移除 CSS 导入，Tailwind 类名
  src/components/MasonryGrid.tsx — 移除 CSS 导入，Tailwind 类名
  src/components/FolderTree.tsx  — 移除 CSS 导入，Tailwind + Motion
  src/components/SortControl.tsx — 移除 CSS 导入，Tailwind + Lucide
  src/components/RatingStars.tsx — 移除 CSS 导入，Tailwind + Lucide Star + Motion
  src/components/ScanProgress.tsx — 移除 CSS 导入，Tailwind 类名
  src/components/AudioPlayer.tsx  — 移除 CSS 导入，Tailwind + Motion
  src/components/AudioCard.tsx    — 移除 CSS 导入，Tailwind 类名
  src/components/AudioViewer.tsx  — 移除 CSS 导入，Tailwind 类名
  src/components/MediaFilter.tsx  — 移除 CSS 导入，Tailwind 类名
  src/components/ImageLightbox.tsx — 移除 CSS 导入，Tailwind 类名

删除（Phase 12 清理）:
  src/App.css                    — 被 App.tsx Tailwind 类名替代
  src/App.module.css             — 从未使用的重复文件
  src/variables.module.css       — 被 Tailwind @theme 替代
  src/index.css 旧内容            — 被新 Tailwind 入口替代
  src/components/*.css            — 全部 19 个组件 CSS 文件
  src/components/*.module.css     — 全部未使用的 CSS Module 文件

不变:
  src/stores/*                   — Zustand 状态层不动
  src/main/*                     — 后端服务层不动
  electron/*                     — 主进程不动
  src/types/*                    — 类型定义不动
```

---

## Task 1: 安装 Tailwind CSS v4 + Geist 字体 + Motion + Lucide

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `src/main.tsx`
- Create: `src/index.css`（新 Tailwind 入口）

**Interfaces:**
- Produces: Tailwind 工具类可用（`bg-canvas`, `text-text-primary` 等）
- Produces: Geist 字体 CSS 变量 `--font-geist-sans`, `--font-geist-mono` 可用

- [ ] **Step 1: 安装依赖**

```bash
conda activate imageviewer
npm install tailwindcss @tailwindcss/vite motion lucide-react geist
```

验证 `package.json` 中新增：
```json
"tailwindcss": "^4.x",
"@tailwindcss/vite": "^4.x",
"motion": "^11.x",
"lucide-react": "^0.x",
"geist": "^1.x"
```

- [ ] **Step 2: 添加 Tailwind Vite 插件**

在 `vite.config.ts` 的 `plugins` 数组中添加 `tailwindcss()`：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),  // ← 新增，放在 react() 之后
    electron([
      // ... 保持不变
    ]),
  ],
  // resolve, base, build, server 保持不变
})
```

- [ ] **Step 3: 更新入口文件**

`src/main.tsx` 顶部添加 Geist 字体导入：

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import 'geist/font/sans'   // 注册 --font-geist-sans
import 'geist/font/mono'   // 注册 --font-geist-mono
import App from './App'
import './index.css'        // Tailwind 入口（下一步创建）

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 4: 创建 Tailwind 入口 CSS**

用以下内容 **完全替换** `src/index.css`（保留旧文件内容作为参考，后面会删）：

```css
@import "tailwindcss";

/* ═══════════════════════════════════════════════════════
   Tailwind v4 @theme — Liquid Glass 设计 Token
   ═══════════════════════════════════════════════════════ */
@theme {
  /* ── 字体 ── */
  --font-family-sans: var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-family-mono: var(--font-geist-mono), 'SF Mono', 'Fira Code', monospace;

  /* ── 颜色：画布 ── */
  --color-canvas:           #050505;
  --color-canvas-raised:    #0a0a0a;
  --color-canvas-tertiary:  #0f0f0f;

  /* ── 颜色：玻璃材质（三级深度） ── */
  --color-glass-l1:         rgba(20, 20, 20, 0.6);
  --color-glass-l2:         rgba(30, 30, 30, 0.7);
  --color-glass-l3:         rgba(40, 40, 40, 0.8);

  /* ── 颜色：文字 ── */
  --color-text-primary:     rgba(255, 255, 255, 0.95);
  --color-text-secondary:   rgba(255, 255, 255, 0.6);
  --color-text-muted:       rgba(255, 255, 255, 0.4);
  --color-text-dim:         rgba(255, 255, 255, 0.3);

  /* ── 颜色：功能色 ── */
  --color-accent:           rgba(255, 255, 255, 0.9);
  --color-border:           rgba(255, 255, 255, 0.06);
  --color-border-default:   rgba(255, 255, 255, 0.08);
  --color-border-hover:     rgba(255, 255, 255, 0.15);
  --color-border-glass:     rgba(255, 255, 255, 0.12);
  --color-favorite:         rgba(255, 71, 87, 0.9);
  --color-star:             #ffd700;
  --color-star-empty:       rgba(255, 255, 255, 0.2);
  --color-success:          rgba(76, 175, 80, 0.8);
  --color-warning:          rgba(255, 152, 0, 0.8);
  --color-error:            rgba(244, 67, 54, 0.8);

  /* ── 颜色：叠加层 ── */
  --color-overlay-dark:     rgba(0, 0, 0, 0.6);
  --color-overlay-darker:   rgba(0, 0, 0, 0.75);
  --color-overlay-light:    rgba(255, 255, 255, 0.03);
  --color-overlay-lighter:  rgba(255, 255, 255, 0.05);
  --color-overlay-selected: rgba(255, 255, 255, 0.08);

  /* ── 圆角 ── */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* ── 字体层级（自定义 size scale） ── */
  --text-display: 1.25rem;
  --text-title:   1rem;
  --text-body:    0.875rem;
  --text-caption: 0.75rem;
  --text-micro:   0.625rem;

  /* ── 模糊尺寸 ── */
  --blur-l1: 20px;
  --blur-l2: 24px;
  --blur-l3: 32px;

  /* ── 阴影 ── */
  --shadow-glass:    0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  --shadow-glass-lg: 0 16px 48px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* ═══════════════════════════════════════════════════════
   shadcn/ui 暗色主题变量覆盖
   ═══════════════════════════════════════════════════════ */
:root {
  --background:       var(--color-canvas);
  --foreground:       var(--color-text-primary);
  --card:             var(--color-glass-l1);
  --card-foreground:  var(--color-text-primary);
  --popover:          var(--color-glass-l3);
  --popover-foreground: var(--color-text-primary);
  --primary:          var(--color-accent);
  --primary-foreground: #050505;
  --secondary:        rgba(255, 255, 255, 0.06);
  --secondary-foreground: var(--color-text-primary);
  --muted:            rgba(255, 255, 255, 0.04);
  --muted-foreground: var(--color-text-muted);
  --accent:           rgba(255, 255, 255, 0.06);
  --accent-foreground: var(--color-text-primary);
  --destructive:      var(--color-error);
  --border:           var(--color-border);
  --input:            var(--color-border);
  --ring:             rgba(255, 255, 255, 0.15);
  --radius:           var(--radius-lg);
}

/* ═══════════════════════════════════════════════════════
   液态玻璃工具类
   ═══════════════════════════════════════════════════════ */
@utility glass-l1 {
  background: var(--color-glass-l1);
  backdrop-filter: blur(var(--blur-l1)) saturate(180%);
  border: 1px solid var(--color-border-glass);
  box-shadow: var(--shadow-glass);
  border-radius: var(--radius-lg);
}

@utility glass-l2 {
  background: var(--color-glass-l2);
  backdrop-filter: blur(var(--blur-l2)) saturate(180%);
  border: 1px solid var(--color-border-glass);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-lg);
}

@utility glass-l3 {
  background: var(--color-glass-l3);
  backdrop-filter: blur(var(--blur-l3)) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: var(--shadow-glass-lg);
  border-radius: var(--radius-xl);
}

/* ═══════════════════════════════════════════════════════
   全局基础样式
   ═══════════════════════════════════════════════════════ */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  background-color: var(--color-canvas);
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-image:
    radial-gradient(ellipse at top, rgba(255,255,255,0.02) 0%, transparent 50%),
    radial-gradient(ellipse at bottom, rgba(255,255,255,0.01) 0%, transparent 50%);
}

#root {
  width: 100%;
  height: 100%;
}

/* 滚动条 */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--color-canvas-raised); }
::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: var(--radius-lg); }
::-webkit-scrollbar-thumb:hover { background: var(--color-text-muted); }

/* 焦点无障碍 */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* 骨架屏动画（保留） */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton-loader {
  background: linear-gradient(90deg, var(--color-canvas-tertiary) 0%, var(--color-canvas-raised) 50%, var(--color-canvas-tertiary) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

- [ ] **Step 5: 验证构建**

```bash
npm run dev
```

打开浏览器 DevTools，检查：
1. `body` 的 `font-family` 包含 `Geist Sans`
2. `bg-canvas` 类名可解析为 `#050505`
3. `glass-l1` 类名可解析出 `backdrop-filter: blur(20px)`
4. 页面无白屏（此时组件尚未迁移，旧 CSS 仍被 `App.css` 引用，但 `index.css` 的 Tailwind reset 不应破坏布局）

> **注意**：此时 App 仍然使用 `App.css` 的全局类名。Tailwind 的 CSS reset 可能导致少量样式偏移，这是正常的，后续 Task 4 会修复。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json vite.config.ts src/main.tsx src/index.css
git commit -m "feat: 安装 Tailwind v4 + Geist 字体 + Motion + Lucide，配置 @theme 设计 token"
```

---

## Task 2: 创建 Motion 动画预设 + Lucide 图标常量

**Files:**
- Create: `src/lib/motion-presets.ts`

**Interfaces:**
- Produces: `motionPresets` 对象，被所有组件的 Motion 动画引用

- [ ] **Step 1: 创建动画预设文件**

```ts
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
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/motion-presets.ts
git commit -m "feat: 创建 Motion 动画预设（micro/panel/page/zoom/fade）"
```

---

## Task 3: 初始化 shadcn/ui + 安装核心组件

**Files:**
- Create: `components.json`（shadcn/ui 配置）
- Create: `src/components/ui/*.tsx`（组件文件，CLI 自动生成）

**Interfaces:**
- Produces: `<Button>`, `<Dialog>`, `<Tooltip>`, `<DropdownMenu>`, `<Select>`, `<Slider>`, `<Badge>`, `<Skeleton>`, `<ScrollArea>`, `<Separator>` 组件可用

- [ ] **Step 1: 初始化 shadcn/ui**

```bash
npx shadcn@latest init
```

CLI 交互中选择：
- Style: **New York**
- Base color: **Neutral**
- CSS variables: **Yes**
- 当提示覆盖 CSS 变量时，选择 **No**（保留 Task 1 中已写入的变量）

> 如果 CLI 自动修改了 `src/index.css`，检查 shadcn 变量块是否与 Task 1 的 `:root` 块冲突。如有冲突，以 Task 1 中的变量为准。

- [ ] **Step 2: 安装所需组件**

```bash
npx shadcn@latest add button dialog tooltip dropdown-menu select slider badge skeleton scroll-area separator
```

- [ ] **Step 3: 验证 shadcn 组件渲染**

在任意组件中临时导入测试：

```tsx
import { Button } from '@/components/ui/button'
// 渲染 <Button variant="ghost">测试</Button>，确认暗色主题正确
```

确认后删除测试代码。

- [ ] **Step 4: 提交**

```bash
git add components.json src/components/ui/
git commit -m "feat: 初始化 shadcn/ui，安装 button/dialog/tooltip/dropdown-menu/select/slider/badge/skeleton"
```

---

## Task 4: 迁移 App.tsx（CSS → Tailwind）

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/App.css`（本 Task 末尾删除）

**Interfaces:**
- Consumes: Task 1 的 Tailwind token + glass 工具类
- Produces: App.tsx 无任何 CSS 文件导入，全部使用 Tailwind 类名

**关键 CSS → Tailwind 映射表：**

| 旧 CSS 类 | Tailwind 替代 |
|-----------|--------------|
| `.app-container` | `w-full h-full flex flex-col` |
| `.app-header` | `h-[50px] px-5 flex items-center justify-between glass-l1 [-webkit-app-region:drag]` |
| `.app-header h1` | `text-title font-semibold tracking-[0.02em]` |
| `.header-actions` | `flex items-center gap-2 [-webkit-app-region:no-drag]` |
| `.header-action-btn` | `px-3 py-2 bg-transparent border border-border rounded-md text-text-secondary text-caption cursor-pointer transition-colors duration-150 flex items-center justify-center whitespace-nowrap hover:border-border-hover hover:text-text-primary hover:bg-overlay-light disabled:opacity-30 disabled:cursor-not-allowed` |
| `.folder-toggle-btn` | `w-9 h-9 border border-border rounded-md text-text-secondary cursor-pointer transition-colors duration-150 flex items-center justify-center hover:border-border-hover hover:text-text-primary hover:bg-overlay-light` |
| `.header-view-btn` | （同 header-action-btn）`bg-overlay-selected border-border-hover text-text-primary` |
| `.thumbnail-size-control` | `flex items-center gap-2 text-caption text-text-secondary` |
| `.thumbnail-size-control input[type="range"]` | 保留为 `index.css` 中的自定义样式（range input 样式 Tailwind 无法原子化） |
| `.image-count` | `text-micro text-text-muted bg-canvas-tertiary px-3 py-1 rounded-full border border-border tabular-nums transition-colors duration-150 hover:border-border-hover hover:bg-canvas-raised` |
| `.app-body` | `flex-1 flex overflow-hidden` |
| `.folder-sidebar` | `w-60 min-w-[200px] max-w-80 bg-canvas-raised border-r border-border flex flex-col overflow-hidden transition-all duration-200` |
| `.folder-sidebar-header` | `flex items-center justify-between px-4 py-3 border-b border-border bg-canvas-tertiary` |
| `.close-sidebar-btn` | `w-[18px] h-[18px] border-none bg-transparent text-text-muted cursor-pointer rounded-sm flex items-center justify-center transition-colors duration-150 hover:bg-overlay-lighter hover:text-text-primary` |
| `.folder-tree-container` | `flex-1 overflow-y-auto` |
| `.app-footer` | `h-8 px-4 flex items-center justify-between bg-canvas-raised border-t border-border text-micro text-text-muted` |
| `.slideshow-bar` | `h-11 px-4 flex items-center justify-center gap-4 bg-[rgba(255,255,255,0.1)] border-t border-[rgba(255,255,255,0.2)]` |
| `.library-panel` | `absolute top-16 left-4 w-80 glass-l2` |
| `.library-item` | `flex items-center justify-between p-3 rounded-lg border border-border cursor-pointer transition-colors duration-150 hover:bg-overlay-light` |
| `.library-item.active` | `bg-overlay-selected border-border-hover` |
| `.audio-area` | `flex gap-3 p-3 overflow-x-auto glass-l1` |
| `.favorite-filter-bar` | `flex items-center gap-2 p-2` |

**操作步骤：**

- [ ] **Step 1: 移除 CSS 导入**

在 `App.tsx` 顶部，删除 `import './App.css'`。

- [ ] **Step 2: 替换 Header 区域类名**

找到 `<header className="app-header">`，按上表替换所有 className。对于复合样式（如 ghost button），提取为内联 Tailwind 字符串。

具体替换规则（在 JSX 中逐一搜索替换）：

```
className="app-container"    → className="w-full h-full flex flex-col"
className="app-header"       → className="h-[50px] px-5 flex items-center justify-between glass-l1 [-webkit-app-region:drag]"
className="header-actions"   → className="flex items-center gap-2 [-webkit-app-region:no-drag]"
className="header-action-btn"→ className="px-3 py-2 bg-transparent border border-border rounded-md text-text-secondary text-caption cursor-pointer transition-colors duration-150 flex items-center justify-center whitespace-nowrap hover:border-border-hover hover:text-text-primary hover:bg-overlay-light disabled:opacity-30 disabled:cursor-not-allowed"
className="folder-toggle-btn"→ className="w-9 h-9 border border-border rounded-md text-text-secondary cursor-pointer transition-colors duration-150 flex items-center justify-center hover:border-border-hover hover:text-text-primary hover:bg-overlay-light"
className="header-view-btn"  → 在 header-action-btn 基础上追加: bg-overlay-selected border-border-hover text-text-primary
className="library-btn"      → 同 header-action-btn
className="thumbnail-size-control" → className="flex items-center gap-2 text-caption text-text-secondary"
className="image-count"      → className="text-micro text-text-muted bg-canvas-tertiary px-3 py-1 rounded-full border border-border tabular-nums transition-colors duration-150 hover:border-border-hover hover:bg-canvas-raised"
```

对于 `<h1>` 标题元素：
```
（无特定 class）→ 添加 className="text-title font-semibold tracking-[0.02em]"
```

> **注意**：App.css 中 `.app-header h1` 有渐变文字效果（`background: linear-gradient; -webkit-background-clip: text`）。此效果 Tailwind 无法直接表达，保留为内联 style 或在 index.css 中添加一个 `@utility text-gradient` 自定义工具类。推荐保留内联 style。

- [ ] **Step 3: 替换 Body + Sidebar 区域类名**

```
className="app-body"              → className="flex-1 flex overflow-hidden"
className="folder-sidebar"        → className="w-60 min-w-[200px] max-w-80 bg-canvas-raised border-r border-border flex flex-col overflow-hidden transition-all duration-200"
className="folder-sidebar-header" → className="flex items-center justify-between px-4 py-3 border-b border-border bg-canvas-tertiary"
className="close-sidebar-btn"     → className="w-[18px] h-[18px] border-none bg-transparent text-text-muted cursor-pointer rounded-sm flex items-center justify-center transition-colors duration-150 hover:bg-overlay-lighter hover:text-text-primary"
className="folder-tree-container" → className="flex-1 overflow-y-auto"
```

- [ ] **Step 4: 替换 Footer + Overlay 区域类名**

```
className="app-footer"       → className="h-8 px-4 flex items-center justify-between bg-canvas-raised border-t border-border text-micro text-text-muted"
className="slideshow-bar"    → className="h-11 px-4 flex items-center justify-center gap-4 bg-[rgba(255,255,255,0.1)] border-t border-[rgba(255,255,255,0.2)]"
className="library-panel"    → className="absolute top-16 left-4 w-80 glass-l2 z-50"
className="library-item"     → className="flex items-center justify-between p-3 rounded-lg border border-border cursor-pointer transition-colors duration-150 hover:bg-overlay-light"
```

对于 `library-item` 的动态激活态：
```tsx
// 原: className={`library-item ${isActive ? 'active' : ''}`}
// 新:
className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors duration-150 hover:bg-overlay-light ${
  isActive
    ? 'bg-overlay-selected border-border-hover'
    : 'border-border'
}`}
```

- [ ] **Step 5: 处理 Range Input 样式**

`App.css` 中的 `.thumbnail-size-control input[type="range"]` 涉及伪元素（`::-webkit-slider-thumb`），Tailwind 无法原子化。在 `src/index.css` 末尾追加：

```css
/* 缩略图滑块自定义样式 */
.thumbnail-slider {
  width: 80px;
  height: 4px;
  -webkit-appearance: none;
  background: var(--color-canvas-tertiary);
  border-radius: 9999px;
  outline: none;
  transition: background 150ms;
}
.thumbnail-slider:hover {
  background: var(--color-canvas-raised);
}
.thumbnail-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  background: var(--color-text-muted);
  border-radius: 9999px;
  cursor: pointer;
  transition: all 150ms;
}
.thumbnail-slider::-webkit-slider-thumb:hover {
  background: var(--color-text-primary);
  transform: scale(1.15);
}
```

在 `App.tsx` 中将 range input 的 className 改为 `thumbnail-slider`。

- [ ] **Step 6: 删除 App.css**

```bash
git rm src/App.css
```

- [ ] **Step 7: 验证**

```bash
npm run dev
```

逐项检查：
1. Header 毛玻璃效果正确（glass-l1）
2. 所有按钮 hover 效果正常
3. Sidebar 布局正常
4. Footer 显示正常
5. Library panel 弹出正常
6. 无 CSS 类名遗漏（DevTools 检查无 `undefined` 或空 class）

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: App.tsx 从 CSS 类名迁移至 Tailwind，删除 App.css"
```

---

## Task 5: 迁移 ImageViewer（CSS → Tailwind + Motion）

**Files:**
- Modify: `src/components/ImageViewer.tsx`
- Delete: `src/components/ImageViewer.css`, `src/components/ImageViewer.module.css`

**Interfaces:**
- Consumes: `motionPresets` from `@/lib/motion-presets`
- Consumes: Tailwind glass 工具类 + 颜色 token
- Produces: 无 CSS 导入，Tailwind 类名 + Motion 动画

**操作指引：**

- [ ] **Step 1: 读取 ImageViewer.css**

完整读取 `src/components/ImageViewer.css`，理解所有 CSS 类名。

- [ ] **Step 2: 移除 CSS 导入**

删除 `import './ImageViewer.css'`。

- [ ] **Step 3: 添加 Motion 导入**

```tsx
import { motion, AnimatePresence } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import { ZoomIn, ZoomOut, RotateCw, FlipHorizontal, FlipVertical, Info, X, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX } from 'lucide-react'
```

- [ ] **Step 4: 逐一替换 CSS 类名**

按照 Task 4 的映射思路，将每个 `className="..."` 替换为 Tailwind 类名。关键映射：

| CSS 类 | Tailwind 替代 |
|--------|--------------|
| `.image-viewer` | `fixed inset-0 z-50 bg-overlay-darker flex items-center justify-center` |
| `.viewer-container` | `relative w-full h-full flex items-center justify-center overflow-hidden` |
| `.viewer-image` | `max-w-full max-h-full object-contain select-none` |
| `.viewer-toolbar` | `glass-l2 absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2` |
| `.toolbar-btn` | `w-9 h-9 flex items-center justify-center rounded-md border border-border bg-transparent text-text-secondary cursor-pointer transition-colors duration-150 hover:bg-overlay-light hover:text-text-primary` |
| `.toolbar-btn.active` | 追加 `bg-overlay-selected text-text-primary` |
| `.viewer-nav-btn` | `absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full glass-l2 cursor-pointer transition-opacity hover:opacity-100 opacity-60` |
| `.viewer-nav-btn.prev` | `left-4` |
| `.viewer-nav-btn.next` | `right-4` |
| `.image-info-panel` | `glass-l3 absolute top-4 right-4 w-72 p-4` |
| `.video-controls` | `glass-l2 absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2` |

> 对于 CSS 中未覆盖到的类名，读取 `ImageViewer.css` 原文后按相同模式翻译。

- [ ] **Step 5: 添加 Motion 动画**

为以下交互添加 Motion 动画：

```tsx
// 信息面板弹出
<AnimatePresence>
  {showInfo && (
    <motion.div
      className="glass-l3 absolute top-4 right-4 w-72 p-4"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={motionPresets.panel}
    >
      {/* 信息面板内容 */}
    </motion.div>
  )}
</AnimatePresence>

// 工具栏按钮 hover — 用 CSS transition 即可（已在 Step 4 中添加）

// 导航按钮用 motion.button 替代 button（可选）
```

- [ ] **Step 6: 替换手写 SVG 图标为 Lucide**

```tsx
// 原: <svg>...</svg> 手写星形/箭头
// 新: <ZoomIn size={16} /> <ZoomOut size={16} /> <ChevronLeft size={20} />
```

- [ ] **Step 7: 删除旧 CSS 文件**

```bash
git rm src/components/ImageViewer.css src/components/ImageViewer.module.css
```

- [ ] **Step 8: 验证 + 提交**

`npm run dev`，打开查看器，测试：缩放、翻页、视频播放、信息面板、工具栏。

```bash
git add -A
git commit -m "feat: ImageViewer 迁移 Tailwind + Motion 动画 + Lucide 图标"
```

---

## Task 6: 迁移 ImageGrid + MasonryGrid（CSS → Tailwind）

**Files:**
- Modify: `src/components/ImageGrid.tsx`
- Modify: `src/components/MasonryGrid.tsx`
- Modify: `src/components/ImageGridItem.tsx`（如存在）
- Delete: `src/components/ImageGrid.css`, `src/components/ImageGrid.module.css`, `src/components/MasonryGrid.css`, `src/components/MasonryGrid.module.css`

**Interfaces:**
- Consumes: Tailwind token
- Produces: 保留 `@tanstack/react-virtual` 虚拟滚动

**操作指引：**

- [ ] **Step 1: 读取两个 CSS 文件**

完整读取 `ImageGrid.css` 和 `MasonryGrid.css`。

- [ ] **Step 2: 移除 CSS 导入**

删除 `import './ImageGrid.css'` 和 `import './MasonryGrid.css'`。

- [ ] **Step 3: 替换 ImageGrid 类名**

关键映射（按实际 CSS 类名翻译）：

| CSS 类 | Tailwind 替代 |
|--------|--------------|
| `.image-grid-container` | `w-full h-full overflow-auto` |
| `.image-grid` | `relative` |
| `.grid-item` | `absolute overflow-hidden rounded-md cursor-pointer transition-all duration-200` |
| `.grid-item:hover` | `hover:ring-1 hover:ring-border-hover hover:brightness-110` |
| `.grid-item.selected` | `ring-2 ring-border-hover bg-overlay-selected` |
| `.grid-item img` | `w-full h-full object-cover` |
| `.grid-item-overlay` | `absolute inset-0 bg-gradient-to-t from-overlay-dark to-transparent opacity-0 transition-opacity` |
| `.grid-item:hover .grid-item-overlay` | `group-hover:opacity-100`（需在外层加 `group`） |
| `.grid-item-info` | `absolute bottom-0 left-0 right-0 p-2 text-micro text-text-primary` |

> 注意：虚拟滚动依赖绝对定位，确保 `top/left/width/height` 由 `@tanstack/react-virtual` 计算，不被 Tailwind 覆盖。

- [ ] **Step 4: 替换 MasonryGrid 类名**

同理读取 `MasonryGrid.css`，按相同模式翻译。

- [ ] **Step 5: 删除旧 CSS 文件**

```bash
git rm src/components/ImageGrid.css src/components/ImageGrid.module.css src/components/MasonryGrid.css src/components/MasonryGrid.module.css
```

- [ ] **Step 6: 验证 + 提交**

`npm run dev`，测试网格视图、瀑布流视图、选中态、hover 效果。

```bash
git add -A
git commit -m "feat: ImageGrid + MasonryGrid 迁移 Tailwind"
```

---

## Task 7: 迁移 FolderTree（CSS → Tailwind + Motion）

**Files:**
- Modify: `src/components/FolderTree.tsx`
- Delete: `src/components/FolderTree.css`, `src/components/FolderTree.module.css`

**Interfaces:**
- Consumes: `motionPresets`, `AnimatePresence`
- Produces: 展开/折叠使用 Motion `AnimatePresence` + height 动画

- [ ] **Step 1: 读取 FolderTree.css**

- [ ] **Step 2: 移除 CSS 导入，添加 Motion 导入**

```tsx
import { motion, AnimatePresence } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'
import { ChevronRight, ChevronDown, Folder, FolderHeart } from 'lucide-react'
```

- [ ] **Step 3: 替换类名**

| CSS 类 | Tailwind 替代 |
|--------|--------------|
| `.folder-tree` | `flex flex-col` |
| `.folder-tree-item` | `flex items-center gap-1 px-3 py-1.5 cursor-pointer text-text-secondary text-caption rounded-sm transition-colors duration-150 hover:bg-overlay-light hover:text-text-primary` |
| `.folder-tree-item.active` | 追加 `bg-overlay-selected text-text-primary` |
| `.folder-icon` | `w-4 h-4 text-text-muted` |
| `.folder-arrow` | `w-3 h-3 text-text-muted transition-transform duration-150` |
| `.folder-children` | `ml-4` |

- [ ] **Step 4: 添加展开/折叠动画**

```tsx
// 子文件夹列表用 AnimatePresence 包裹
<AnimatePresence initial={false}>
  {isExpanded && children.length > 0 && (
    <motion.div
      className="ml-4 overflow-hidden"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={motionPresets.panel}
    >
      {children.map(child => <FolderTreeItem key={child.path} ... />)}
    </motion.div>
  )}
</AnimatePresence>
```

- [ ] **Step 5: 替换 SVG 图标为 Lucide**

```tsx
// 展开箭头: <ChevronRight size={12} /> / <ChevronDown size={12} />
// 文件夹图标: <Folder size={16} />
// 收藏文件夹: <FolderHeart size={16} />
```

- [ ] **Step 6: 删除旧 CSS + 验证 + 提交**

```bash
git rm src/components/FolderTree.css src/components/FolderTree.module.css
npm run dev  # 验证文件夹树展开/折叠动画
git add -A
git commit -m "feat: FolderTree 迁移 Tailwind + Motion 展开折叠动画 + Lucide 图标"
```

---

## Task 8: 迁移辅助组件（SortControl + RatingStars + ScanProgress + MediaFilter）

**Files:**
- Modify: `src/components/SortControl.tsx`
- Modify: `src/components/RatingStars.tsx`
- Modify: `src/components/ScanProgress.tsx`
- Modify: `src/components/MediaFilter.tsx`
- Delete: 以上 4 个组件对应的 `.css` + `.module.css`（共 8 个文件）

- [ ] **Step 1: 迁移 SortControl**

读取 `SortControl.css`，移除 `import './SortControl.css'`。

替换类名：
```
.sort-control    → flex items-center gap-2
.sort-label      → text-caption text-text-secondary
.sort-select     → bg-transparent border border-border rounded-md px-2 py-1 text-caption text-text-secondary cursor-pointer outline-none hover:border-border-hover
.sort-order-btn  → w-7 h-7 flex items-center justify-center border border-border rounded-md bg-transparent text-text-secondary cursor-pointer transition-colors duration-150 hover:bg-overlay-light hover:text-text-primary
```

添加 Lucide 图标替换排序箭头：
```tsx
import { ArrowUp, ArrowDown } from 'lucide-react'
// ↑ 替换为: {sortOrder === 'ASC' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
```

- [ ] **Step 2: 迁移 RatingStars**

读取 `RatingStars.css`，移除 `import './RatingStars.css'`。

替换类名：
```
.rating-stars      → flex items-center gap-0.5
.rating-small      → scale-75
.rating-medium     → (default)
.rating-large      → scale-125
.rating-star       → bg-transparent border-none cursor-pointer p-0 text-star-empty transition-all duration-150 hover:scale-110
.rating-star.is-filled → text-star
.loading           → opacity-50 pointer-events-none
```

替换手写 SVG 为 Lucide Star：
```tsx
import { Star } from 'lucide-react'

// 在 render 中:
<Star
  size={size === 'small' ? 14 : size === 'large' ? 20 : 16}
  className={`transition-colors duration-150 ${
    starValue <= displayRating ? 'fill-star text-star' : 'text-star-empty'
  }`}
/>
```

添加 Motion 点击动画（可选）：
```tsx
import { motion } from 'motion/react'
import { motionPresets } from '@/lib/motion-presets'

// 将 button 替换为 motion.button:
<motion.button
  whileTap={{ scale: 0.9 }}
  transition={motionPresets.micro}
  ...
>
```

- [ ] **Step 3: 迁移 ScanProgress**

读取 `ScanProgress.css`，移除 `import './ScanProgress.css'`。

替换类名：
```
.scan-progress        → glass-l1 mx-4 my-2 p-4
.scan-progress-bar    → w-full h-1.5 bg-canvas-tertiary rounded-full overflow-hidden
.scan-progress-fill   → h-full bg-success rounded-full transition-all duration-300
.scan-progress-text   → text-caption text-text-secondary mt-2
```

- [ ] **Step 4: 迁移 MediaFilter**

读取 `MediaFilter.module.css`（或 `MediaFilter.css`），移除导入。

替换类名：
```
.media-filter       → flex items-center gap-2
.filter-btn         → px-3 py-1.5 border border-border rounded-full bg-transparent text-caption text-text-secondary cursor-pointer transition-colors duration-150 hover:border-border-hover hover:text-text-primary
.filter-btn.active  → bg-overlay-selected border-border-hover text-text-primary
```

- [ ] **Step 5: 删除所有旧 CSS 文件**

```bash
git rm src/components/SortControl.css src/components/SortControl.module.css
git rm src/components/RatingStars.css src/components/RatingStars.module.css
git rm src/components/ScanProgress.css src/components/ScanProgress.module.css
git rm src/components/MediaFilter.module.css
```

- [ ] **Step 6: 验证 + 提交**

```bash
npm run dev
git add -A
git commit -m "feat: SortControl/RatingStars/ScanProgress/MediaFilter 迁移 Tailwind + Lucide 图标"
```

---

## Task 9: 迁移多媒体组件（AudioPlayer + AudioCard + AudioViewer + ImageLightbox）

**Files:**
- Modify: `src/components/AudioPlayer.tsx`
- Modify: `src/components/AudioCard.tsx`
- Modify: `src/components/AudioViewer.tsx`
- Modify: `src/components/ImageLightbox.tsx`
- Delete: 以上 4 个组件对应的 CSS 文件（共约 6 个文件）

- [ ] **Step 1: 迁移 AudioPlayer**

读取 `AudioPlayer.module.css`，移除导入。

AudioPlayer 迁移为 `glass-l2` 浮动面板：
```
.audio-player       → glass-l2 fixed bottom-12 left-1/2 -translate-x-1/2 w-96 px-4 py-3 flex flex-col gap-2
.player-controls    → flex items-center justify-center gap-3
.player-btn         → w-8 h-8 flex items-center justify-center rounded-full border border-border bg-transparent text-text-secondary cursor-pointer hover:text-text-primary hover:border-border-hover transition-colors
.play-btn           → w-10 h-10 bg-accent text-canvas rounded-full flex items-center justify-center cursor-pointer hover:brightness-110 transition-all
.progress-bar       → w-full h-1 bg-canvas-tertiary rounded-full appearance-none cursor-pointer
.progress-bar fill  → 保留自定义 CSS 样式（range input 伪元素）
.time-display       → flex justify-between text-micro text-text-muted tabular-nums
.volume-control     → flex items-center gap-2
```

替换图标为 Lucide：
```tsx
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
```

- [ ] **Step 2: 迁移 AudioCard**

读取 `AudioCard.module.css`，移除导入。

```
.audio-card         → glass-l1 p-3 flex items-center gap-3 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-glass
.audio-card-icon    → w-10 h-10 rounded-lg bg-overlay-lighter flex items-center justify-center text-text-muted
.audio-card-info    → flex flex-col gap-1
.audio-card-title   → text-caption text-text-primary truncate
.audio-card-subtitle→ text-micro text-text-muted
```

- [ ] **Step 3: 迁移 AudioViewer**

读取 `AudioViewer.css`，移除导入。按 AudioPlayer 类似模式翻译。波形容器保留原有 Canvas 逻辑。

- [ ] **Step 4: 迁移 ImageLightbox**

读取 `ImageLightbox.css`，移除导入。

```
.lightbox-overlay   → fixed inset-0 z-[100] bg-overlay-darkest flex items-center justify-center
.lightbox-close     → absolute top-4 right-4 w-10 h-10 glass-l2 flex items-center justify-center cursor-pointer hover:opacity-100 opacity-60 transition-opacity
```

> 注：如果使用了 `yet-another-react-lightbox`，其内部样式不受影响。只需迁移自定义 wrapper 的类名。

- [ ] **Step 5: 删除旧 CSS 文件**

```bash
git rm src/components/AudioPlayer.module.css
git rm src/components/AudioCard.module.css
git rm src/components/AudioViewer.css
git rm src/components/ImageLightbox.css
```

- [ ] **Step 6: 验证 + 提交**

```bash
npm run dev
git add -A
git commit -m "feat: 多媒体组件迁移 Tailwind + Lucide 图标"
```

---

## Task 10: 清理残留 + 更新文档

**Files:**
- Delete: `src/App.module.css`, `src/variables.module.css`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 删除所有残留 CSS 文件**

```bash
git rm src/App.module.css
git rm src/variables.module.css
```

验证 `src/components/` 下不再有任何 `.css` 或 `.module.css` 文件：

```bash
fd "\.(module\.)?css$" src/components/
# 预期输出：空
```

- [ ] **Step 2: 清理 global.d.ts 中的 CSS Module 声明**

从 `src/global.d.ts` 中移除 CSS Module 类型声明：

```ts
// 删除:
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
```

- [ ] **Step 3: 更新 CLAUDE.md**

更新架构描述，反映新的前端技术栈：
- 样式方案：CSS Modules → Tailwind CSS v4 + Liquid Glass
- 组件库：无 → shadcn/ui
- 动画库：无 → Motion
- 图标库：手写 SVG → Lucide React
- 字体：系统字体 → Geist Sans + Geist Mono

- [ ] **Step 4: 全量构建验证**

```bash
npm run build
```

确认无编译错误、无 TypeScript 类型错误。

```bash
npm run dev
```

完整功能验证：
1. 库管理（添加/删除/扫描）
2. 文件夹树浏览 + 展开折叠动画
3. 网格视图 + 瀑布流视图切换
4. 图片查看器（缩放/拖拽/翻页/信息面板）
5. 视频播放
6. 音频播放
7. 收藏功能
8. 排序功能
9. 幻灯片播放
10. 排序/筛选控件

- [ ] **Step 5: 提交**

```bash
git add -A CLAUDE.md
git commit -m "chore: 清理残留 CSS 文件，更新 CLAUDE.md 架构文档"
```

---

## 完成标准

- [ ] Liquid Glass 视觉风格完整实现（3 级玻璃深度：`glass-l1` / `glass-l2` / `glass-l3`）
- [ ] Geist 字体全量替换
- [ ] Tailwind v4 `@theme` 包含所有设计 token
- [ ] shadcn/ui 组件覆盖通用 UI 需求
- [ ] Motion 动画覆盖核心交互（FolderTree 展开、ImageViewer 信息面板、按钮微交互）
- [ ] Lucide React 图标替换所有手写 SVG
- [ ] 所有 `.css` / `.module.css` 文件已删除
- [ ] `npm run build` 构建成功
- [ ] `npm run dev` 功能验证通过
- [ ] `CLAUDE.md` 架构文档已更新
