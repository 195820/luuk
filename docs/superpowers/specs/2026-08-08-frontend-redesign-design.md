# 前端全套重构设计规格书

> 日期：2026-08-08  
> 状态：已确认  
> 视觉方向：Liquid Glass（液态玻璃）  
> 排版体系：Geist Sans + Geist Mono  
> 技术方案：Tailwind v4 + shadcn/ui + Framer Motion + Lucide React

---

## 1. 背景与目标

### 1.1 现状

| 维度 | 现状 |
|------|------|
| 技术栈 | React 19 + TypeScript + Electron 40 |
| 样式方案 | 纯 CSS Modules，已建立 CSS 变量设计系统 |
| 主题 | 纯黑画布极简暗色，毛玻璃 + 微噪点纹理 |
| 组件库 | 无，全部手写 |
| CSS 框架 | 无 |
| 动画库 | 无（仅手写 CSS keyframes） |

### 1.2 目标

通过引入现代化前端工具链 + 全新视觉设计，实现：
- **视觉升级**：从"可用"到"精致"——液态玻璃质感、物理弹性动画、Geist 排版
- **开发效率提升**：原子化 CSS 减少样板代码，shadcn/ui 提供开箱即用的高质量组件
- **交互体验**：Framer Motion 提供流畅的微交互——缩放、拖拽、翻页、展开/折叠
- **可维护性**：代码级组件所有权（shadcn/ui 复制粘贴模式），设计 token 体系统一

---

## 2. 视觉设计：Liquid Glass（液态玻璃）

### 2.1 设计灵感

- **Apple visionOS / WWDC 2025**：自适应玻璃材质，物理折射，动态模糊
- **核心哲学**：UI 面板如玻璃般半透明浮于内容之上，不遮挡、不干扰，让图片成为主角
- **2025-2026 趋势**：Liquid Glass 是当年最受关注的 UI 设计语言（[Apple Newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)）

### 2.2 视觉特征

| 特征 | 描述 | CSS 实现 |
|------|------|----------|
| **毛玻璃面板** | 半透明模糊背景，内容透出 | `backdrop-filter: blur(24px) saturate(180%)` |
| **折射边框** | 1px 渐变边框模拟玻璃边缘高光 | `border: 1px solid rgba(255,255,255,0.12)` + 线性渐变 |
| **环境光阴影** | 彩色阴影基于背景色反射 | `box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)` |
| **深度层级** | 多层玻璃叠加，越高层越亮 | 3 级：基础层/浮动层/弹出层 |
| **画布纯黑** | 图片展示区纯黑，让内容浮现 | `background: #050505` |
| **微噪点纹理** | 保留现有背景噪点，增加质感 | `radial-gradient` 叠加（已实现） |

### 2.3 深度层级系统

```
Level 0 — 画布层      #050505 纯黑，图片展示区
Level 1 — 基础面板     glass-bg: rgba(20,20,20,0.6) + blur(20px)    — Header, Footer, Sidebar
Level 2 — 浮动面板     glass-bg: rgba(30,30,30,0.7) + blur(24px)    — 工具栏, 控制条
Level 3 — 弹出层       glass-bg: rgba(40,40,40,0.8) + blur(32px)    — Dialog, Dropdown, Tooltip
```

### 2.4 颜色系统

```css
/* 基础色 — 纯黑画布 */
--bg-canvas:        #050505;
--bg-canvas-raised: #0a0a0a;

/* 玻璃材质 — 三级深度 */
--glass-L1-bg:     rgba(20, 20, 20, 0.6);
--glass-L1-blur:   20px;
--glass-L1-border: rgba(255, 255, 255, 0.08);

--glass-L2-bg:     rgba(30, 30, 30, 0.7);
--glass-L2-blur:   24px;
--glass-L2-border: rgba(255, 255, 255, 0.12);

--glass-L3-bg:     rgba(40, 40, 40, 0.8);
--glass-L3-blur:   32px;
--glass-L3-border: rgba(255, 255, 255, 0.15);

/* 文字 — 克制分层 */
--text-primary:    rgba(255, 255, 255, 0.95);
--text-secondary:  rgba(255, 255, 255, 0.6);
--text-muted:      rgba(255, 255, 255, 0.4);

/* 功能色 */
--accent:          rgba(255, 255, 255, 0.9);
--border:          rgba(255, 255, 255, 0.06);
--star-filled:     #ffd700;
--favorite:        rgba(255, 71, 87, 0.9);
--success:         rgba(76, 175, 80, 0.8);
--warning:         rgba(255, 152, 0, 0.8);
--error:           rgba(244, 67, 54, 0.8);

/* 环境光阴影 */
--shadow-glass:    0 8px 32px rgba(0, 0, 0, 0.4),
                   inset 0 1px 0 rgba(255, 255, 255, 0.08);
--shadow-glass-lg: 0 16px 48px rgba(0, 0, 0, 0.5),
                   inset 0 1px 0 rgba(255, 255, 255, 0.1);
```

### 2.5 布局原则

- **浮动而非贴边**：工具栏/控制条悬浮于内容之上，四周留 8-16px 间距
- **圆角 12-16px**：大圆角强化玻璃面板的柔和感
- **间距 32-48px**：慷慨留白，呼吸感
- **工具栏 hover 显现**：非持久显示，减少视觉噪音

---

## 3. 排版系统：Geist 体系

### 3.1 字体选型

| 用途 | 字体 | 来源 | 理由 |
|------|------|------|------|
| 正文/UI | **Geist Sans** | [Vercel](https://vercel.com/font) / npm `geist` | 极简几何，暗色可读性高，shadcn/ui 生态匹配 |
| 技术信息 | **Geist Mono** | 同上 | 文件路径、分辨率、文件大小等数据展示 |
| 回退栈 | `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | 系统 | 字体加载前的过渡 |

### 3.2 字体安装（Electron 非 Next.js）

```bash
npm install geist
```

```tsx
// src/main.tsx
import 'geist/font/sans';
import 'geist/font/mono';

// Geist 自动注册 CSS 变量 --font-geist-sans, --font-geist-mono
```

```css
/* Tailwind v4 @theme 映射 */
@theme {
  --font-sans: 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', 'SF Mono', 'Fira Code', monospace;
}
```

### 3.3 字体层级

| 层级 | Token | 字号 | 字重 | 行高 | 字间距 | 用途 |
|------|-------|------|------|------|--------|------|
| Display | `text-display` | 20px (1.25rem) | 500 | 1.3 | -0.01em | 查看器标题、库名 |
| Title | `text-title` | 16px (1rem) | 500 | 1.4 | 0 | 面板标题 |
| Body | `text-body` | 14px (0.875rem) | 400 | 1.5 | 0.01em | 正文、描述 |
| Caption | `text-caption` | 12px (0.75rem) | 400 | 1.5 | 0.02em | 辅助文字、时间戳、元数据 |
| Micro | `text-micro` | 10px (0.625rem) | 500 | 1.4 | 0.04em | 角标、徽章、状态指示 |

### 3.4 暗色排版规则

| 规则 | 实施 |
|------|------|
| 最小字重 400 | 禁止 300/200 用于正文，暗底上细笔画不可读 |
| 字间距补偿 | Caption +0.02em，Micro +0.04em，补偿暗色对比度损失 |
| 层级对比度 ≥ 3:1 | primary(0.95) vs secondary(0.6) vs muted(0.4) 已满足 |
| 数字/路径用 Mono | 文件大小 `2.4 MB`、路径 `/photos/2026/` 使用 Geist Mono |

---

## 4. 动效系统：Framer Motion

### 4.1 动画原则

- **自然物理感**：所有动画使用 spring 弹性，非机械 linear
- **150-250ms 微交互**：hover/click 反馈保持敏捷
- **300-400ms 布局变化**：面板展开、视图切换允许更长时间
- **克制不炫技**：图片本身是主角，UI 动画服务于功能而非装饰

### 4.2 动画预设

```tsx
// src/lib/motion-presets.ts
export const motionPresets = {
  // 微交互 — 按钮 hover/click
  micro: {
    type: 'spring',
    stiffness: 400,
    damping: 30,
  },

  // 面板展开 — Sidebar, Dialog
  panel: {
    type: 'spring',
    stiffness: 300,
    damping: 30,
  },

  // 页面过渡 — 图片翻页
  page: {
    type: 'tween',
    duration: 0.3,
    ease: [0.4, 0, 0.2, 1],
  },

  // 缩放 — 图片缩放
  zoom: {
    type: 'spring',
    stiffness: 200,
    damping: 25,
  },

  // 淡入淡出 — 工具栏显隐
  fade: {
    duration: 0.2,
    ease: 'easeOut',
  },
};
```

### 4.3 关键动画场景

| 场景 | 实现 | 预设 |
|------|------|------|
| 图片翻页 | `AnimatePresence` + `mode="wait"` + 水平滑动 | `page` |
| 图片缩放 | `motion.div` + `onWheel` + `scale` transform | `zoom` |
| 图片拖拽 | `drag` + `dragConstraints` | `zoom` |
| Sidebar 展开/折叠 | `layout` + `AnimatePresence` | `panel` |
| Dialog 弹出 | `AnimatePresence` + scale(0.95→1) + fade | `panel` |
| Tooltip 出现 | `AnimatePresence` + fade + translateY(4px→0) | `fade` |
| 网格项选中 | `layout` + scale + border 过渡 | `micro` |
| 工具栏显隐 | `AnimatePresence` + fade | `fade` |
| 文件夹树展开 | `AnimatePresence` + height auto + fade | `panel` |

### 4.4 微交互细节

| 交互 | 效果 | 时长 |
|------|------|------|
| 按钮 hover | `scale(1.02)` + 背景微亮 | 150ms spring |
| 按钮 click | `scale(0.98)` 按压感 | 100ms |
| 收藏星星 | `scale(1→1.3→1)` 弹性 + 颜色过渡 | 300ms spring |
| 评分点击 | 星星依次点亮 stagger 10ms | 200ms |
| 视图切换 | 网格项 `layout` 动画重排 | 300ms spring |
| 滚动到顶/底 | 弹性回弹 `overshoot` | 200ms spring |

---

## 5. 技术栈选型

### 5.1 最终选型

| 层 | 选型 | 版本 | 用途 |
|----|------|------|------|
| CSS 框架 | **Tailwind CSS v4** | v4.x | 原子化 CSS，CSS-first 配置 |
| 组件库 | **shadcn/ui** | latest | 基于 Radix UI 的复制粘贴组件集 |
| 动画库 | **Motion**（原 Framer Motion） | v11+ | 声明式动画、布局动画、手势交互 |
| 图标库 | **Lucide React** | latest | 轻量树摇图标库（shadcn/ui 默认） |
| 基础原语 | **Radix UI** | latest | 无障碍组件内核（shadcn/ui 底层依赖） |
| 字体 | **Geist Sans + Geist Mono** | latest | 排版系统（[vercel.com/font](https://vercel.com/font)） |
| 虚拟滚动 | **@tanstack/react-virtual** | v3.x | 保留现有方案，不替换 |

### 5.2 选型理由

- **Tailwind CSS v4**：CSS-first `@theme` 指令与 Geist 字体变量 + Liquid Glass 设计 token 天然契合
- **shadcn/ui**：复制粘贴模式（代码完全属于你）；暗色主题通过 CSS 变量覆盖即可适配 Liquid Glass 风格；[官方文档](https://ui.shadcn.com/docs/theming)推荐 CSS Variables 方式
- **Motion**：React 生态 #1 动画库；spring 物理弹性完美匹配 Liquid Glass 的"材质感"；布局动画 + AnimatePresence 覆盖所有过渡
- **Lucide React**：shadcn/ui 默认图标；线条风格与 Geist 字体视觉重量匹配
- **Geist**：Vercel 设计的几何无衬线字体，暗色可读性极高；与 shadcn/ui 生态天然搭配（[StackOverflow 2025](https://stackoverflow.com/questions/79616396/how-do-i-add-geist-from-the-npm-package-to-tailwindcss-4)）

---

## 6. Tailwind v4 + shadcn/ui 主题配置

### 6.1 入口 CSS 配置

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  /* ── 字体 ── */
  --font-sans: 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', 'SF Mono', 'Fira Code', monospace;

  /* ── 颜色：画布 ── */
  --color-canvas:           #050505;
  --color-canvas-raised:    #0a0a0a;

  /* ── 颜色：玻璃材质 ── */
  --color-glass-L1:         rgba(20, 20, 20, 0.6);
  --color-glass-L2:         rgba(30, 30, 30, 0.7);
  --color-glass-L3:         rgba(40, 40, 40, 0.8);

  /* ── 颜色：文字 ── */
  --color-text-primary:     rgba(255, 255, 255, 0.95);
  --color-text-secondary:   rgba(255, 255, 255, 0.6);
  --color-text-muted:       rgba(255, 255, 255, 0.4);

  /* ── 颜色：功能 ── */
  --color-accent:           rgba(255, 255, 255, 0.9);
  --color-border:           rgba(255, 255, 255, 0.06);
  --color-border-glass:     rgba(255, 255, 255, 0.12);
  --color-favorite:         rgba(255, 71, 87, 0.9);
  --color-star:             #ffd700;
  --color-success:          rgba(76, 175, 80, 0.8);
  --color-warning:          rgba(255, 152, 0, 0.8);
  --color-error:            rgba(244, 67, 54, 0.8);

  /* ── 圆角 ── */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* ── 字体层级 ── */
  --text-display: 1.25rem;
  --text-title:   1rem;
  --text-body:    0.875rem;
  --text-caption: 0.75rem;
  --text-micro:   0.625rem;

  /* ── 模糊尺寸 ── */
  --blur-L1: 20px;
  --blur-L2: 24px;
  --blur-L3: 32px;
}
```

### 6.2 shadcn/ui 暗色主题覆盖

```css
/* src/index.css — shadcn/ui 变量覆盖 */
:root {
  --background:    var(--color-canvas);
  --foreground:    var(--color-text-primary);
  --card:          var(--color-glass-L1);
  --card-foreground: var(--color-text-primary);
  --popover:       var(--color-glass-L3);
  --popover-foreground: var(--color-text-primary);
  --primary:       var(--color-accent);
  --primary-foreground: #050505;
  --secondary:     rgba(255, 255, 255, 0.06);
  --secondary-foreground: var(--color-text-primary);
  --muted:         rgba(255, 255, 255, 0.04);
  --muted-foreground: var(--color-text-muted);
  --accent:        rgba(255, 255, 255, 0.06);
  --accent-foreground: var(--color-text-primary);
  --destructive:   var(--color-error);
  --border:        var(--color-border);
  --input:         var(--color-border);
  --ring:          rgba(255, 255, 255, 0.15);
  --radius:        var(--radius-lg);
}
```

### 6.3 玻璃面板 Tailwind 工具类

```css
/* src/index.css — 自定义工具类 */
@utility glass-L1 {
  background: var(--color-glass-L1);
  backdrop-filter: blur(var(--blur-L1)) saturate(180%);
  border: 1px solid var(--color-border-glass);
  box-shadow: var(--shadow-glass, 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08));
  border-radius: var(--radius-lg);
}

@utility glass-L2 {
  background: var(--color-glass-L2);
  backdrop-filter: blur(var(--blur-L2)) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1);
  border-radius: var(--radius-lg);
}

@utility glass-L3 {
  background: var(--color-glass-L3);
  backdrop-filter: blur(var(--blur-L3)) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12);
  border-radius: var(--radius-xl);
}
```

**使用方式**：
```tsx
<header className="glass-L1">...</header>
<dialog className="glass-L3">...</dialog>
```

---

## 7. 迁移策略

### 7.1 核心思路

```
现有 CSS 变量 → Tailwind v4 @theme token → shadcn/ui 主题变量 + 玻璃工具类
```

### 7.2 变量映射

| 现有变量 | 新 Token | 用途 |
|----------|----------|------|
| `--bg-primary` | `--color-canvas` | 主背景 |
| `--bg-secondary` | `--color-canvas-raised` | 次背景 |
| `--bg-elevated` | `--color-glass-L1` | 浮动面板 |
| `--glass-bg` | `--color-glass-L1` | 玻璃材质基础 |
| `--glass-blur` | `--blur-L1` | 模糊尺寸 |
| `--glass-border` | `--color-border-glass` | 玻璃边框 |
| `--text-primary` | `--color-text-primary` | 主文字 |
| `--text-secondary` | `--color-text-secondary` | 次文字 |
| `--accent` | `--color-accent` | 强调色 |
| `--border` | `--color-border` | 基础边框 |
| `--radius-*` | `--radius-*` | 圆角（值微调） |
| `--shadow-*` | `--shadow-glass*` | 阴影升级为玻璃阴影 |

---

## 8. 实施阶段

### Phase 1：基础设施安装

**目标**：搭建新工具链，零功能变更。

- [ ] 安装 Tailwind CSS v4 + Vite 插件
- [ ] 安装 Geist 字体 `npm install geist`
- [ ] 创建 Tailwind 入口 CSS，配置 `@theme`（颜色/字体/圆角/模糊/层级）
- [ ] 配置 shadcn/ui 暗色主题（CSS 变量覆盖）
- [ ] 安装 Motion `npm install motion`
- [ ] 安装 Lucide React `npm install lucide-react`
- [ ] 创建 `src/lib/motion-presets.ts` 动画预设
- [ ] 创建玻璃工具类 `glass-L1` / `glass-L2` / `glass-L3`

### Phase 2：通用 UI 组件

**目标**：用 shadcn/ui 替换手写通用组件。

需安装的 shadcn/ui 组件：
- `button` — 替换手写按钮
- `dialog` — 替换手写弹窗
- `tooltip` — 替换手写提示
- `dropdown-menu` — 替换手写下拉菜单
- `toast` + `toaster` — 新增通知系统
- `slider` — 音频播放器进度条
- `scroll-area` — 统一滚动容器
- `separator` — 分隔线
- `badge` — 标签/状态标记
- `select` — 排序/筛选下拉
- `skeleton` — 加载占位

### Phase 3：布局组件迁移

**目标**：Header、Sidebar、Footer 迁移至 Tailwind + Liquid Glass。

| 组件 | 变更 |
|------|------|
| AppHeader | `glass-L1` 毛玻璃面板 + Geist 排版 + Lucide 图标 |
| AppSidebar | `glass-L1` + Framer Motion `layout` 折叠/展开动画 |
| AppFooter | `glass-L1` + 极简信息展示 |
| SlideshowBar | `glass-L2` 浮动控制条 + Framer Motion 显隐 |

### Phase 4：核心查看器（ImageViewer）

**目标**：Framer Motion 重构交互层。

| 场景 | 实现 |
|------|------|
| 缩放 | `motion.div` + `onWheel` + spring `zoom` 预设 |
| 拖拽 | `drag` + `dragConstraints` + spring 回弹 |
| 翻页 | `AnimatePresence` + `mode="wait"` + `page` 预设 |
| 工具栏 | `AnimatePresence` + `fade` 预设 + `glass-L2` 浮动 |
| 重置 | `layout` + spring 过渡回原位 |
| 信息面板 | `glass-L3` + AnimatePresence 弹出 |

### Phase 5：网格视图

**目标**：ImageGrid / MasonryGrid 迁移。

- 保留 `@tanstack/react-virtual` 虚拟滚动
- 网格项 Tailwind 样式 + `skeleton` 加载态
- Framer Motion `layout` 动画（视图切换/排序变化时平滑重排）
- 选中态：`scale(1.02)` + 边框高亮 spring 过渡

### Phase 6：辅助组件

| 组件 | 变更 |
|------|------|
| SortControl | `glass-L1` + shadcn/ui `select` |
| RatingStars | Lucide `Star` + Framer Motion `scale` 弹性点击 |
| ScanProgress | shadcn/ui `progress` + `glass-L1` |
| FolderTree | Framer Motion 展开/折叠 + `AnimatePresence` |
| MediaFilter | shadcn/ui `badge` + `button` toggle |
| LibraryPanel | `glass-L1` 面板 + Lucide 图标 |

### Phase 7：多媒体组件

| 组件 | 变更 |
|------|------|
| AudioPlayer | `glass-L2` 浮动面板 + shadcn/ui `slider` + Framer Motion |
| AudioViewer | `glass-L1` + 波形可视化 |
| AudioCard | `glass-L1` + hover `scale(1.02)` |
| ImageLightbox | 评估：保留 yet-another-react-lightbox 或替换为 shadcn/ui `dialog` |

### Phase 8：清理与文档

- [ ] 删除所有废弃 `.module.css` 文件
- [ ] 删除 `variables.module.css`（已被 Tailwind `@theme` 替代）
- [ ] 精简 `index.css`
- [ ] 更新 `CLAUDE.md` 架构描述
- [ ] 截图对比：迁移前后视觉差异

---

## 9. 关键设计决策

### 9.1 Tailwind v4 CSS-first 配置

不使用 `tailwind.config.js`，所有配置在 CSS 中通过 `@theme` 指令定义。与 Geist 字体变量 + Liquid Glass 设计 token 统一。

### 9.2 shadcn/ui 暗色覆盖

通过覆盖 shadcn/ui 的 CSS 变量（`--background`, `--card`, `--popover` 等）将组件适配为 Liquid Glass 风格。组件代码可自由修改（复制粘贴模式）。

### 9.3 动画策略

- **CSS transition 优先**：按钮 hover、颜色变化等简单微交互
- **Framer Motion 负责**：布局动画、页面过渡、手势、复杂编排
- **spring 物理感**：所有动画使用 spring，非 linear tween
- **AnimatePresence**：所有 mount/unmount 过渡

### 9.4 图标替换

全部替换为 Lucide React：
```tsx
import { Star, Folder, Heart, ZoomIn, ZoomOut, Play, Pause, SkipBack, SkipForward } from 'lucide-react'
```

### 9.5 虚拟滚动保留

`@tanstack/react-virtual` 已验证可用，不替换。

---

## 10. 约束与风险

| 风险 | 缓解措施 |
|------|----------|
| Tailwind v4 + Electron 兼容性 | v4 已广泛验证；Vite 插件成熟 |
| shadcn/ui 暗色覆盖与 Liquid Glass 风格冲突 | 逐组件验证；CSS 变量覆盖优先级高 |
| `backdrop-filter` 性能（大量模糊叠加） | 限制 3 级玻璃层；避免在滚动列表项上使用模糊 |
| Framer Motion 包体积 | ~30KB gzipped；桌面应用可接受 |
| Geist 字体加载 | npm 本地打包，无网络依赖 |
| 迁移期间功能回归 | 每阶段 `npm run dev` 验证；细粒度 git 提交 |

---

## 11. 完成标准

- [ ] Liquid Glass 视觉风格完整实现（3 级玻璃深度）
- [ ] Geist 字体全量替换，排版层级一致
- [ ] Tailwind v4 `@theme` 包含所有设计 token
- [ ] shadcn/ui 组件覆盖所有通用 UI 需求
- [ ] Framer Motion 动画覆盖图片查看器核心交互 + 全局微交互
- [ ] Lucide React 图标替换所有手写 SVG/emoji
- [ ] 所有 `.module.css` 文件已删除
- [ ] `npm run build` 构建成功
- [ ] `npm run dev` 功能验证通过
- [ ] `CLAUDE.md` 架构文档已更新

---

## 参考来源

- [Apple WWDC 2025 — Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)
- [shadcn/ui Theming 官方文档](https://ui.shadcn.com/docs/theming)
- [Tailwind CSS v4 backdrop-filter](https://tailwindcss.com/docs/backdrop-filter-blur)
- [FlyonUI — Liquid Glass Effects in Tailwind CSS](https://flyonui.com/blog/liquid-glass-effects-in-tailwind-css/)
- [Josh W. Comeau — Next-level Frosted Glass](https://www.joshwcomeau.com/css/backdrop-filter/)
- [LogRocket — Liquid Glass Effects with CSS and SVG](https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/)
- [Motion (Framer Motion) 官方文档](https://motion.dev/)
- [Geist Font — Vercel](https://vercel.com/font)
- [NNGroup — Dark Mode: How Users Think About It](https://www.nngroup.com/articles/dark-mode-users-issues/)
- [ResearchGate — Minimalistic UI Design and Dark Mode Usage (2024)](https://www.researchgate.net/publication/384553048)
- [Design Systems Collective — Typography Hierarchy Rules](https://www.designsystemscollective.com/typography-systems-the-hierarchy-rules-most-designers-break-7187fdc4adb2)
- [uxdesign.cc — Typography with Semantic Tokens](https://uxdesign.cc/mastering-typography-in-design-systems-with-semantic-tokens-and-responsive-scaling-6ccd598d9f21)
