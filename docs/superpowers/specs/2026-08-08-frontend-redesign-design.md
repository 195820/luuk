# 前端全套重构设计规格书

> 日期：2026-08-08  
> 状态：已确认  
> 方案：方案 A — Tailwind v4 + shadcn/ui + Framer Motion

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

通过引入现代化前端工具链，实现：
- **开发效率提升**：原子化 CSS 减少样板代码，shadcn/ui 提供开箱即用的高质量组件
- **视觉一致性**：统一的设计 token 系统，Framer Motion 提供流畅的微交互
- **可维护性**：代码级组件所有权（shadcn/ui 复制粘贴模式），易于定制和迭代

---

## 2. 技术栈选型

### 2.1 最终选型

| 层 | 选型 | 版本 | 用途 |
|----|------|------|------|
| CSS 框架 | **Tailwind CSS v4** | v4.x | 原子化 CSS，CSS-first 配置 |
| 组件库 | **shadcn/ui** | latest | 基于 Radix UI 的复制粘贴组件集 |
| 动画库 | **Framer Motion**（Motion） | v11+ | 声明式动画、布局动画、手势交互 |
| 图标库 | **Lucide React** | latest | 轻量树摇图标库（shadcn/ui 默认） |
| 基础原语 | **Radix UI** | latest | 无障碍组件内核（shadcn/ui 底层依赖） |

### 2.2 选型理由

- **Tailwind CSS v4**：CSS-first 配置（`@theme` 指令）与现有 CSS 变量系统天然契合；v4 性能大幅提升；与 shadcn/ui 深度集成
- **shadcn/ui**：复制粘贴模式（代码完全属于你）；66k+ GitHub stars；社区最活跃；暗色主题原生支持；基于 Radix UI 保证无障碍
- **Framer Motion**：React 生态 #1 动画库；声明式 API 适合图片查看器的缩放/拖拽/翻页场景；布局动画 + AnimatePresence 覆盖所有过渡需求
- **Lucide React**：shadcn/ui 默认图标库；轻量树摇；一致的视觉风格

---

## 3. 迁移策略

### 3.1 核心思路

将现有 CSS 变量系统直接映射为 Tailwind v4 的 `@theme` token，保持视觉一致性：

```
现有 CSS 变量 (--bg-primary, --text-primary, ...) 
    ↓ 映射
Tailwind v4 @theme (--color-bg-primary, --color-text-primary, ...)
    ↓ 消费
shadcn/ui 主题变量 (基于 CSS 变量)
```

### 3.2 变量映射规则

| 现有变量 | Tailwind token 名 | 用途 |
|----------|-------------------|------|
| `--bg-primary` | `--color-bg-primary` | 主背景色 |
| `--bg-secondary` | `--color-bg-secondary` | 次背景色 |
| `--text-primary` | `--color-text-primary` | 主文字色 |
| `--text-secondary` | `--color-text-secondary` | 次文字色 |
| `--accent` | `--color-accent` | 强调色 |
| `--border` | `--color-border` | 边框色 |
| `--radius-md` | `--radius-md` | 圆角（shadcn/ui 直接消费） |

所有现有变量保留原始值，仅重命名前缀以符合 Tailwind v4 命名约定。

---

## 4. 实施阶段

### Phase 1：基础设施安装

**目标**：搭建新工具链基础，零功能变更。

- [ ] 安装 Tailwind CSS v4 + Vite 插件
- [ ] 创建 Tailwind 入口 CSS，配置 `@theme` 映射现有变量
- [ ] 安装 shadcn/ui CLI (`npx shadcn@latest init`)
- [ ] 配置 shadcn/ui（选择 New York 风格、Radix 原语）
- [ ] 安装 Framer Motion (`npm install motion`)
- [ ] 安装 Lucide React (`npm install lucide-react`)

### Phase 2：通用 UI 组件

**目标**：用 shadcn/ui 替换手写的通用组件。

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

### Phase 3：布局组件迁移

**目标**：Header、Sidebar、Footer 迁移至 Tailwind。

| 组件 | 文件 | 变更 |
|------|------|------|
| AppHeader | `src/components/layout/AppHeader.tsx` | CSS Modules → Tailwind class |
| AppSidebar | `src/components/layout/AppSidebar.tsx` | CSS Modules → Tailwind + Framer Motion 折叠动画 |
| AppFooter | `src/components/layout/AppFooter.tsx` | CSS Modules → Tailwind |
| SlideshowBar | `src/components/layout/SlideshowBar.tsx` | CSS Modules → Tailwind + Framer Motion |

### Phase 4：核心查看器（ImageViewer）

**目标**：用 Framer Motion 重构图片查看器的交互层。

关键动画场景：
- **缩放**：`motion.div` + `useTransform` + 手势 `onWheel`/`onPan`
- **翻页过渡**：`AnimatePresence` + `mode="wait"` + 滑动动画
- **工具栏显隐**：`AnimatePresence` + 淡入淡出
- **重置动画**：`layout` prop + spring 过渡

### Phase 5：网格视图

**目标**：ImageGrid 和 MasonryGrid 迁移至 Tailwind。

- 保留 `@tanstack/react-virtual` 虚拟滚动逻辑不变
- 网格项样式迁移至 Tailwind utility classes
- 添加 Framer Motion `layout` 动画（视图切换时的平滑过渡）
- 图片加载状态用 shadcn/ui `skeleton` 替换手写 shimmer

### Phase 6：辅助组件

| 组件 | 变更 |
|------|------|
| SortControl | Tailwind + shadcn/ui `select` / `dropdown-menu` |
| RatingStars | Tailwind + Framer Motion 星星动画 |
| ScanProgress | Tailwind + shadcn/ui `progress` |
| FolderTree | Tailwind + Framer Motion 展开/折叠动画 |
| MediaFilter | Tailwind + shadcn/ui `badge` + `button` |

### Phase 7：多媒体组件

| 组件 | 变更 |
|------|------|
| AudioPlayer | Tailwind + shadcn/ui `slider` + Framer Motion |
| AudioViewer | Tailwind |
| AudioCard | Tailwind |
| ImageLightbox | 评估是否替换为 shadcn/ui `dialog` 或保留 yet-another-react-lightbox |

### Phase 8：清理

- [ ] 删除所有废弃的 `.module.css` 文件
- [ ] 删除 `variables.module.css`（已被 Tailwind `@theme` 替代）
- [ ] 精简 `index.css`，仅保留 Tailwind 入口 + 全局重置
- [ ] 更新 `CLAUDE.md` 中的架构描述

---

## 5. 关键设计决策

### 5.1 Tailwind v4 配置方式

采用 CSS-first 配置（`@theme` 指令），不使用 `tailwind.config.js`。

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  --color-bg-primary: #050505;
  --color-bg-secondary: #0a0a0a;
  --color-text-primary: rgba(255, 255, 255, 0.95);
  --color-text-secondary: rgba(255, 255, 255, 0.6);
  --color-accent: rgba(255, 255, 255, 0.9);
  --color-border: rgba(255, 255, 255, 0.06);
  /* ... 其余变量映射 */
}
```

### 5.2 shadcn/ui 安装模式

使用 CLI 安装，组件代码复制到 `src/components/ui/`：

```bash
npx shadcn@latest add button dialog tooltip dropdown-menu
```

### 5.3 动画集成策略

- **布局动画**：Framer Motion `layout` prop（视图切换、列表重排）
- **页面过渡**：`AnimatePresence` + `mode="wait"`（图片翻页）
- **手势**：`whileTap`、`whileHover`、`drag`（图片缩放/拖拽）
- **微交互**：CSS `transition` 优先（按钮 hover），复杂动效用 Framer Motion

### 5.4 图标替换策略

全局替换为 Lucide React 图标：

```tsx
import { Star, Folder, Heart, ZoomIn, ZoomOut } from 'lucide-react'
```

### 5.5 虚拟滚动保留

保留 `@tanstack/react-virtual`，不替换。原因：
- 已验证可用，性能优秀
- shadcn/ui 无虚拟滚动方案
- 替换收益不大，风险高

---

## 6. 约束与风险

| 风险 | 缓解措施 |
|------|----------|
| Tailwind v4 与 Electron 兼容性 | v4 已广泛验证 Electron 场景；Vite 插件成熟 |
| shadcn/ui 组件与现有手写组件冲突 | 逐组件迁移，不一次性替换；新旧组件可共存 |
| Framer Motion 包体积 | ~30KB gzipped；对桌面应用可接受 |
| 迁移期间功能回归 | 每阶段完成后运行 `npm run dev` 验证；保持 git 提交粒度 |
| CSS 变量映射丢失 | 迁移前完整记录所有变量，映射后视觉对比验证 |

---

## 7. 完成标准

- [ ] 所有 `.module.css` 文件已删除或替换
- [ ] Tailwind v4 `@theme` 包含所有设计 token
- [ ] shadcn/ui 组件覆盖所有通用 UI 需求
- [ ] Framer Motion 动画覆盖图片查看器核心交互
- [ ] Lucide React 图标替换所有手写 SVG/emoji
- [ ] `npm run build` 构建成功
- [ ] `npm run dev` 功能验证通过（所有现有功能正常）
- [ ] `CLAUDE.md` 架构文档已更新
