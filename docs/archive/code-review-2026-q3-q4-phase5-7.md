---
title: 代码评审报告 2026-Q3/Q4 Phase 5-7
description: 对 implementation-plan-2026-q3-q4.md v2 实施结果的三视角合并评审
type: review
status: archived
created: 2026-09-12
updated: 2026-09-19
reviewer: Claude（completeness + correctness + impact 三子代理合并）
related_plan: ./implementation-plan-2026-q3-q4.md
review_scope: e0a9c16..HEAD（Phase 5-7 全量 4 次提交，最近提交 8408788 Task 7.1）
---

# 代码评审报告 2026-Q3/Q4 Phase 5-7

> 本报告是对 [implementation-plan-2026-q3-q4.md](./implementation-plan-2026-q3-q4.md) v2 实施结果的合并评审，覆盖 Phase 5-7 全量代码变更。
> 由 **completeness / correctness / impact** 三个子代理并行评审后合并去重生成。

---

## 📌 评审范围说明

三个子代理的实际扫描范围略有差异：

| 视角 | 扫描范围 | 覆盖内容 |
|------|---------|---------|
| **completeness** | `e0a9c16..HEAD`（4 次提交） | Phase 5-7 全量实施 |
| **correctness** | 最近一次提交 `8408788` | Task 7.1 幻灯片增强 |
| **impact** | 最近一次提交 `8408788` | Task 7.1 幻灯片增强 |

⚠️ **Phase 5/6 的正确性/影响面问题可能被低估**，建议后续对 5.x/6.x 提交单独跑一次 correctness + impact 复审。

---

## 📊 问题总览

| 严重级 | 数量 | 主要集中区域 |
|--------|------|-------------|
| 🔴 Critical（MUST FIX） | 10 | 构建失败、契约误用、计划验收硬缺口 |
| 🟡 Warning（SHOULD FIX） | 18 | UI 未接入、性能节流、分层错位、状态竞态 |
| 🟢 Suggestion（CONSIDER） | 4 | 命名遮蔽、依赖数组、文档同步 |
| **合计** | **32** | — |

---

## 🔴 Critical Issues（MUST FIX）

### 1. `SlideshowAudio` 误用 `getMediaUrl` 契约 + 破坏 `npm run build`

**位置**：[SlideshowAudio.tsx#L33-L46](../../src/components/SlideshowAudio.tsx) · [types/index.ts#L92](../../src/types/index.ts)

**Problem**：
`getMediaUrl` 契约是 `(path) => Promise<string>`（裸字符串），代码却按 `{ success, data, error }` envelope 解构：

```ts
const result = await window.electronAPI.getMediaUrl(audioTrack.path) // result: string
if (cancelled || !result.success || !result.data) { ... return }      // string 无 .success/.data
const mediaUrl = result.data                                          // undefined
```

- **编译层面**：`tsc` 报 4 处 `TS2339: Property 'success'/'data'/'error' does not exist on type 'string'`
- **运行层面**：`result.success` 恒为 undefined → 每次都进入 error 分支 return，**背景音乐永远无法加载**
- **构建阻塞**：同时存在多处 TS6133 未使用变量（`App.tsx` 的 `Pause`/`MonitorPlay`/`SlideshowSettings`、`ImageViewer.tsx` 的 `imageTransition`、`SlideshowBar.tsx` 的 `Settings2`、`PlaylistEditor.tsx` 的 `Save`/`PlaylistItem`/`libraryId`），`npm run build` 中止

**Fix**：

```ts
try {
  const mediaUrl = await window.electronAPI.getMediaUrl(audioTrack.path)
  if (cancelled || !mediaUrl) return
  if (audio.src !== mediaUrl) { audio.src = mediaUrl; audio.load() }
  audio.loop = true
  audio.volume = audioTrack.volume / 100
  if (isPlaying) audio.play().catch(err => logger.warn('SlideshowAudio', err))
} catch (err) {
  logger.error('SlideshowAudio', '获取音频 URL 失败', err)
}
```

并清理全部未使用导入/变量，`npm run build` 通过后再提交。

---

### 2. Ctrl+R 与 App.tsx 既有 keydown 叠加，一次按键触发"切模式 + 复位视图"两个副作用

**位置**：[ImageViewer.tsx#L364-L371](../../src/components/ImageViewer.tsx) · [App.tsx#L845-L848](../../src/App.tsx)

**Problem**：
`ImageViewer` 的 Ctrl+R → `toggleMode()` 仅 `preventDefault()`，未 `stopImmediatePropagation`；App.tsx 的 window keydown 判断 `e.key === 'r'` **未检查 ctrlKey**，同样匹配。

**用户可见后果**：放大查看细节时想切换随机播放，会瞬间丢失 zoom/pan/rotate 状态。此外 grid 模式下 Ctrl+R 未被拦截，会触发 Electron 默认刷新，行为不一致。

**Fix**：

```ts
// ImageViewer 中
if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
  e.preventDefault()
  e.stopImmediatePropagation()
  useSlideshowStore.getState().toggleMode()
  return
}

// App.tsx L845 加修饰键守卫
if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) { ... }
```

---

### 3. `selectAudioFile` 允许任意路径，但 `getMediaUrl` 会拒绝库外路径 —— IPC 契约漂移

**位置**：[library-handlers.ts#L736-L757](../../src/main/ipc/library-handlers.ts) · [library-handlers.ts#L20-L35](../../src/main/ipc/library-handlers.ts)

**Problem**：
新增 `selectAudioFile` 用 `dialog.showOpenDialog` 让用户从**任意目录**选择音频；但 `getMediaUrl` 首行 `validateLibraryAccess(filePath)` 对非库目录直接抛错。

即便修复问题 1，用户从 `D:\Music\xxx.mp3` 选的 BGM 仍会静默失败。这是本次变更**新引入的两个 IPC 之间的契约漂移**。

**Fix**（三选一）：
- (a) `selectAudioFile` 限制 `defaultPath` 到某个已注册库
- (b) 新增不走 `validateLibraryAccess` 的音频专用 URL 通道（如 `getAudioUrl`）
- (c) 将外部音频复制到 `.ivlib/cache/audio/` 后再注册 token

---

### 4. Task E.1 单元测试**完全缺失** —— 7 个新模块 0 覆盖率

**位置**：[docs/plans/implementation-plan-2026-q3-q4.md#L640-L665](./implementation-plan-2026-q3-q4.md)

**Problem**：
计划硬性要求"新增 60-80 单元测试"，分模块覆盖率：

| 模块 | 目标覆盖率 | 实际 |
|------|-----------|------|
| library-monitor | 70% | 0% |
| themeStore | 80% | 0% |
| highlight.tsx | 90% | 0% |
| histogram.ts | 75% | 0% |
| slideshowStore | 70% | 0% |
| export-service | 65% | 0% |
| database.ts 迁移 | 90% | 0% |

检查 `src/**/__tests__`，最新测试文件时间戳为 2026/8/31（Phase 5 之前），提交自述"135 测试全部通过"与 Phase 4 结束时一致，**未新增一例**。工程化 Task E.1 完全未实施。

**Fix**：
为 7 个模块分别新建测试文件（`library-monitor.test.ts` / `themeStore.test.ts` / `highlight.test.tsx` / `histogram.test.ts` / `slideshowStore.test.ts` / `export-service.test.ts` / `database-migration.test.ts`），按计划"关键用例"列覆盖：
- XSS 防护（含 `<script>` 文件名）
- feature flag 关闭回退
- `stop()` 释放资源
- 单文件失败不中断
- 取消后清理
- 迁移幂等/回滚

---

### 5. Task 6.3 DB 迁移框架未实施（`schema_version` / `MIGRATIONS` 全缺失）

**位置**：[database.ts#L64-L148](../../src/main/services/database.ts)

**Problem**：
计划将 Task 6.3 定位为"**DB 迁移框架首次引入**"，硬性要求：
- `ensureSchemaVersion()` 方法
- `schema_version` 表
- `MIGRATIONS` 常量数组（v1 = `ALTER TABLE libraries ADD COLUMN folder_covers TEXT`）
- 事务包裹、幂等、失败回滚

实施版本改为在 `createTables()` 内直接 `CREATE TABLE IF NOT EXISTS folder_covers`（独立表而非 libraries 列），完全没有 `schema_version` 表、没有 `MIGRATIONS` 数组、没有 `ensureSchemaVersion` 方法。

**下游影响**：验收项"老库首次启动自动应用 v1 迁移"、"迁移失败时回滚 + 日志告警"均无法验证。**后续任何 schema 演进都没有可用框架**。

**Fix**：
按计划 442-453 行草案补齐 `ensureSchemaVersion()` + `MIGRATIONS` 数组，`initialize()` 内在 `createTables()` 之后调用；将 folder_covers 结构（无论独立表或列）纳入 v1 迁移，事务包裹。

---

### 6. Task 6.1 回滚保障 feature flag `theme.enabled` 完全缺失

**位置**：[themeStore.ts#L7-L18](../../src/stores/themeStore.ts) · [settings-service.ts#L11-L37](../../src/main/services/settings-service.ts) · [SettingsPanel.tsx](../../src/components/SettingsPanel.tsx)

**Problem**：
计划验收标准第 5 项"**feature flag 关闭时完全回退到当前深色行为**（回滚保障）"、回滚策略表首行"主题系统（6.1）→ electron-store `theme.enabled = false`"。

检查结果：
- themeStore 接口无 `enabled` 字段
- settings-service 的 SettingsSchema 无 `theme.enabled` 键
- SettingsPanel 无 flag 开关
- App.tsx 直接 `applyTheme()` 无守卫

**回滚通道完全缺失**，一旦浅色主题在真机出现视觉崩坏无法快速关闭。

**Fix**：

```ts
// themeStore.ts
interface ThemeState {
  enabled: boolean
  /* ... */
  setEnabled(v: boolean): void
}

applyTheme: () => {
  if (!get().enabled) {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.removeProperty('--color-accent')
    return  // 完全回退当前深色行为
  }
  // ... 原逻辑
}
```

在 settings-service 加 `'theme.enabled': boolean`（默认 `false`），SettingsPanel 顶部增加开关。

---

### 7. Task 5.3 高亮渲染未接入 UI —— `highlightMatch` 是死代码

**位置**：[highlight.tsx#L9-L28](../../src/utils/highlight.tsx) · [ImageGridItem.tsx](../../src/components/ImageGridItem.tsx)

**Problem**：
`highlightMatch` 函数已实现且正确返回 React 节点数组（无 `dangerouslySetInnerHTML`），但 `grep -r highlightMatch src/` 仅命中定义文件自身，**无任何调用方**。

计划涉及文件明确列出 `ImageGridItem.tsx（高亮渲染）`，验收标准"搜索结果中文件名匹配部分以 `<mark>` 高亮"未落地。

**Fix**：
在 `ImageGridItem.tsx` 中根据 searchStore 的 `criteria.fileName` 调用 `highlightMatch(name, keyword)` 渲染文件名节点。

---

### 8. Task 5.3 SearchPanel 历史下拉与预设 UI **完全缺失**

**位置**：[SearchPanel.tsx](../../src/components/SearchPanel.tsx)

**Problem**：
`grep history|preset|历史|预设 SearchPanel.tsx` 命中数为 0。

searchStore 侧的 `history` / `presets` / `addToHistory` / `saveAsPreset` / `removePreset` / `loadHistoryAndPresets` 已实现且 preload/settings-service 后端通路完整，但**前端 UI 一处未挂载**。

验收标准"搜索框下拉显示最近 10 次搜索词，可清空"、"可保存/删除命名预设"未落地。

**Fix**：
- 在 SearchPanel 文件名输入框下增加下拉列表渲染 `history`（点击回填 + 清空按钮）
- 在高级搜索区增加"保存为预设"按钮 + 已存预设列表（点击加载 / 悬停显示删除）
- 面板 mount 时调用 `loadHistoryAndPresets()`

---

### 9. Task 6.2 `histogram.ts` 三项硬性要求全部未达标

**位置**：[histogram.ts#L11-L52](../../src/main/utils/histogram.ts)

**Problem**：
计划代码草案与验收标准明确要求：

| 要求 | 计划 | 实际 | 状态 |
|------|------|------|------|
| 200 万像素降采样 | `MAX_PIXELS = 2_000_000` + `pipeline.resize` | 无任何 resize | ❌ |
| 亮度公式 | Rec.601 `0.299 R + 0.587 G + 0.114 B` | BT.709 `0.2126 R + 0.7152 G + 0.0722 B` | ❌ |
| 数据结构 | `Uint32Array(256)` 四通道 | `new Array(256).fill(0)` 普通 JS 数组 | ❌ |
| `downsampled` 标志 | 返回值含此字段 | 无 | ❌ |

**下游后果**：4K/8K 图直接遍历全像素，分级 SLA（4K <100ms、8K <150ms）**不可能达标**；UI 无法提示"已降采样"。

**Fix**：
严格按计划 348-380 行代码草案重写：加入 metadata 检查 + `pipeline.resize` + `Uint32Array(256)` + Rec.601 系数 + 返回 `downsampled: totalPixels > MAX_PIXELS`；HistogramChart 依据该标志显示"已降采样至 200 万像素"提示。

---

### 10. Task 6.2 HistogramChart 悬停显示 bin 数值缺失

**位置**：[HistogramChart.tsx#L60-L115](../../src/components/HistogramChart.tsx)

**Problem**：
验收标准"支持鼠标悬停显示 bin 具体数值"。检查组件：无 `title=`、无 `onMouseEnter`、无 `<Tooltip>`。

计划要求"可复用 recharts"，实现完全用裸 div 手绘柱形，无任何 hover 交互。

**Fix**：
为每个 bin 的柱形 div 加 `title={`bin ${i}: ${value}`}`，或改用 recharts `<BarChart>` + `<Tooltip>` 以获得完整交互体验。

---

## 🟡 Warnings（SHOULD FIX）

### 11. 过渡动画不会在切图时触发，且 transition 变更无法响应

**位置**：[ImageViewer.tsx#L603](../../src/components/ImageViewer.tsx) · [ImageViewer.tsx#L896-L928](../../src/components/ImageViewer.tsx)

**Problem**：两处缺陷叠加导致"过渡动画"这一核心特性基本失效：
1. `transition={useSlideshowStore.getState().transition}` 在渲染期用 `getState()` 读取而非 `useSlideshowStore(s => s.transition)` 订阅。用户在 SlideshowBar 切换过渡类型时，ImageViewer 未订阅该字段不会重渲染，包装器仍用旧值。
2. `SlideshowTransitionWrapper` 内层 `<div>` 没有随图片变化的 `key`。CSS `animation: slideshow-${transition} 500ms` 只在元素**首次挂载**或 animation-name 变化时播放；切图时 React 复用同一 DOM 节点，动画**不会重新触发**（仅第一张有一次动画）。

**Fix**：

```tsx
const transition = useSlideshowStore(s => s.transition)
// ...
<SlideshowTransitionWrapper key={src} transition={transition}>
```

---

### 12. 跨库播放列表切换存在异步竞态，导航静默失败

**位置**：[App.tsx#L480-L495](../../src/App.tsx)

**Problem**：
随机/顺序播放列表分支中，当 `nextItem.libraryId !== currentLibraryId` 时先 `setCurrentLibrary(nextItem.libraryId)`，紧接着**同步**读取 `useImageStore.getState().images` 并 `findIndex(img => img.relative_path === nextItem.imagePath)`。

切换库会触发异步加载新库图片，此刻 store 中仍是**旧库**的 images，`findIndex` 对新库路径几乎必然返回 `-1`，于是 `imgIndex >= 0` 不成立，跳转被静默跳过。**跨库自定义播放列表无法正常播放**。

**Fix**：
等待库切换/图片加载完成后再查找目标图（例如监听 `currentLibraryId` 变化后的 images 就绪，或在加载完成的回调/effect 中执行跳转），不要在 `setCurrentLibrary` 之后同步读取 images。

---

### 13. `stop()` 强制清空 `audioTrack`，暂停/切库都会永久丢失 BGM

**位置**：[slideshowStore.ts#L215-L221](../../src/stores/slideshowStore.ts) · [App.tsx#L442-L449](../../src/App.tsx)

**Problem**：
`stop()` 的实现同时把 `isPlaying: false` 和 `audioTrack: null` 都清掉。调用点包括：
- `toggleSlideshow`（用户按暂停按钮）
- `handleClose`（Esc 关闭 viewer）
- `handleSwitchLibrary`（切换库）

且 `audioTrack` 未列入 `partialize`，重启应用也不保留。

**下游可见的行为漂移**：用户精心挑选的 BGM 一旦按暂停就得**重新走一次文件选择对话框**；这既违反"暂停/继续"直觉，也和 commit message "退出幻灯片时自动停止并释放资源" 的语义不符（暂停 ≠ 退出）。

**Fix**：拆分 `pause()` 与 `stop()`：

```ts
pause: () => set({ isPlaying: false }),                                    // 保留 audioTrack
stop:  () => set({ isPlaying: false, audioTrack: null, playlist: [] }),    // 显式退出才清理
```

`toggleSlideshow` / SlideshowBar 的"暂停"按钮走 `pause()`，`handleClose` 才走 `stop()`。

---

### 14. `SlideshowBar` 返回 Fragment，被 App 的 `AnimatePresence` 包裹 → `exit` 动画静默失效

**位置**：[App.tsx#L1379-L1387](../../src/App.tsx) · [SlideshowBar.tsx#L60-L189](../../src/components/layout/SlideshowBar.tsx)

**Problem**：
App.tsx 用 `<AnimatePresence>{cond && <SlideshowBar/>}</AnimatePresence>`，但 SlideshowBar 的根节点是 `<>...</>` Fragment，里面才是 `motion.div`（含 `exit={{ opacity: 0, y: 20 }}`）。

Framer Motion 的 AnimatePresence 需要**直接子级**是 motion 组件才能拦截卸载、播放 exit；Fragment 会绕过检测，导致：
- 关闭幻灯片时控制条瞬间消失，`exit` 动画从未触发
- Fragment 内的第二个 `motion.div`（audioTrack 悬浮音乐条）和 `<PlaylistEditor>` 也会随父级瞬时卸载，若 PlaylistEditor 打开状态被拖拽中，可能丢失未保存的重命名输入

**Fix**：
把 SlideshowBar 的根节点改成单一 `motion.div`（把 audio 悬浮条与 PlaylistEditor 通过 portal 或 AnimatePresence 内部管理），或在 App 侧直接条件渲染不加 AnimatePresence。

---

### 15. `selectAudioFile` 用 `BrowserWindow.getAllWindows()[0]` 作 dialog 父窗口

**位置**：[library-handlers.ts#L738-L742](../../src/main/ipc/library-handlers.ts)

**Problem**：
新 handler 忽略了 `IpcMainInvokeEvent.sender`，直接取全局第一个 BrowserWindow 作为 dialog parent。本 IPC **没有传 libraryId 上下文**，一旦未来引入多窗口（如画中画预览窗），对话框会出现在错误的窗口上并阻塞主窗。

**Fix**：

```ts
ipcMain.handle('selectAudioFile', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0]
  if (!parent || parent.isDestroyed()) return { success: false, error: 'No window available' }
  const result = await dialog.showOpenDialog(parent, { ... })
  // ...
})
```

---

### 16. `settings-service` 新增 `slideshow.*` 三键但无任何写入路径 —— 双源真相

**位置**：[settings-service.ts#L20-L22](../../src/main/services/settings-service.ts) · [slideshowStore.ts#L96-L109](../../src/stores/slideshowStore.ts)

**Problem**：
本次同时在两处落地幻灯片偏好：
- 主进程 `electron-store` schema 声明了 `slideshow.mode` / `slideshow.transition` / `slideshow.intervalSec` 及默认值
- 渲染端 `slideshowStore` 用 `zustand/persist` 写入 `localStorage['slideshow-storage']`

grep 结果显示**没有任何主进程/渲染进程代码读写这三个 electron-store 键**（仅在 schema/DEFAULTS 中出现）。

**下游影响**：
- `settings.json` 永远保持默认值
- 任何后续基于 `getSetting('slideshow.*')` 的迁移/统计/导出功能都会读到错误数据
- 用户实际偏好只存在于 renderer localStorage，卸载/清缓存即丢失
- 与项目其他"主进程持久化"约定不一致

**Fix**：二选一 ——
- (a) 删除 settings-service 里新增的三个键
- (b) 在 slideshowStore 里去掉 persist，改为通过 IPC 读写 settings-service

当前 themeStore 已有同类"死 schema"，本次不应继续复制该模式。

---

### 17. `slideshowStore.setInterval` action 遮蔽全局 `setInterval`

**位置**：[slideshowStore.ts#L69](../../src/stores/slideshowStore.ts) · [SlideshowBar.tsx#L43](../../src/components/layout/SlideshowBar.tsx)

**Problem**：
store 定义 `setInterval: (sec: number) => void`；SlideshowBar 用 `const setInterval = useSlideshowStore(s => s.setInterval)` 解构后，整个组件作用域内的 `setInterval` 标识符被劫持。

将来任何人想在 SlideshowBar 里加自动隐藏计时器（`setInterval(fn, ms)`）都会静默调用 store setter 而不是 `window.setInterval`，属于本次变更引入的**新命名污染**。

**Fix**：重命名为语义化别名：

```ts
// slideshowStore.ts
setIntervalSec: (sec: number) => void

// SlideshowBar.tsx
const setIntervalSec = useSlideshowStore(s => s.setIntervalSec)
onChange={e => setIntervalSec(Number(e.target.value))}
```

---

### 18. Task 7.1 未按计划复用 wavesurfer.js（改用原生 `<audio>`）

**位置**：[SlideshowAudio.tsx#L18-L94](../../src/components/SlideshowAudio.tsx) · [slideshowStore.ts#L211-L218](../../src/stores/slideshowStore.ts)

**Problem**：
计划技术方案明确要求：
- "**复用现有 wavesurfer.js@^7.12.8**（无需新增音频依赖）"
- "SlideshowAudio.tsx（封装 wavesurfer）"
- 验收标准"退出全屏 / 关闭幻灯片 → 音乐立即停止 + **wavesurfer 实例 destroy**"
- "stop() 必须 destroy wavesurfer 实例"

实施使用 `useRef<HTMLAudioElement>` + 原生 `<audio>` 标签，`slideshowStore.stop()` 仅 `set({ audioTrack: null })`，销毁依赖组件 useEffect cleanup。功能可用但完全偏离计划技术选型，**无波形可视化能力**。

**Fix**：
要么按计划改用 wavesurfer（`WaveSurfer.create({...})` + `wavesurfer.destroy()`），要么在计划文档变更日志中记录本次技术选型变更并说明理由（原生 audio 更轻量、无需波形）。

---

### 19. Task 6.1 `index.html` 冷启动防闪烁脚本未添加

**位置**：[index.html#L1-L14](../../index.html)

**Problem**：
验收标准"主题选择持久化 + **冷启动无闪烁（在 index.html 内联脚本预置 data-theme）**"、风险表缓解措施"主题切换闪烁 → index.html 内联脚本预置"。

index.html 仅 14 行，无任何内联 `<script>`；themeStore 的 `applyTheme()` 在 React 挂载后（App.tsx L135）才执行，**浅色主题用户冷启动会先看到深色闪烁**。

**Fix**：在 `<head>` 内加入内联脚本：

```html
<script>
  try {
    const s = JSON.parse(localStorage.getItem('theme-storage') || '{}');
    const mode = s?.state?.mode || 'dark';
    const resolved = mode === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    document.documentElement.dataset.theme = resolved;
  } catch {}
</script>
```

---

### 20. Task 6.1 `index.css` 缺少 `[data-accent]` / `[data-density]` 选择器

**位置**：[index.css#L131-L212](../../src/index.css)

**Problem**：
计划 CSS 草案要求 6 个 `[data-accent="violet|blue|green|orange|pink|cyan"]` 选择器 + 3 个 `[data-density="compact|comfortable|spacious"]` 选择器（含 `--density-scale` 变量）。

实施仅有 `[data-theme="light"]` 一处，accent 与 density 均改由 themeStore `root.style.setProperty` 内联写入 `<html style="...">`。功能可达但**违背"CSS-first token 治理"计划约束**，密度未按计划使用统一 `--density-scale` 缩放因子（改为写死 padding/gap 具体值），后续组件适配密度需读多个变量。

**Fix**：
按计划 285-296 行补齐 `[data-accent="..."]` × 6 与 `[data-density="..."]` × 3 选择器；themeStore 改为 `root.dataset.accent = preset` / `root.dataset.density = density`；自定义 HEX 保留内联 style 兜底。

---

### 21. Task 7.2 `export-progress` 未按 100ms 节流

**位置**：[library-handlers.ts#L708-L711](../../src/main/ipc/library-handlers.ts) · [export-service.ts#L106-L128](../../src/main/services/export-service.ts)

**Problem**：
验收标准"导出进度条显示（IPC 事件 `export-progress` **每 100ms 节流**）"。

实施在 for 循环内每处理完一张图片就调用 `onProgress(i+1, total)` → `sendToRenderer('export-progress', ...)`，1000 张批量导出会产生 1000 次 IPC，无节流。**渲染进程会因高频事件掉帧**。

**Fix**：在 library-handlers.ts 的回调内加时间戳节流：

```ts
let lastEmit = 0
await exportService.exportBatch(absPaths, options, taskId, (done, total) => {
  const now = Date.now()
  if (now - lastEmit >= 100 || done === total) {
    lastEmit = now
    sendToRenderer('export-progress', { taskId, done, total, finished: done === total })
  }
})
```

---

### 22. Task 7.2 取消后未清理临时 ZIP + `original` 格式扩展名丢失

**位置**：[export-service.ts#L106-L143](../../src/main/services/export-service.ts) · [export-service.ts#L190-L227](../../src/main/services/export-service.ts)

**Problem**：
- **临时文件泄漏**：验收标准"支持取消：中途取消后临时文件清理，无僵尸进程"。L108-L112 检测到 `ac.signal.aborted` 后仅 `archive.abort(); return`，未 `output.close()` / `fsp.unlink(opts.outputPath)` 删除半成品 ZIP，也未等待 `pipelinePromise` 结算。
- **扩展名丢失**：L214-L227 `getExtForFormat('original')` 返回 `''`，而 L193/L205 `basename(imagePath, extname(imagePath))` 已把原扩展名剥离，两者拼接后**输出文件完全无扩展名**（原始格式单图导出得到 `IMG_001`、ZIP 内条目同名）。破坏验收"格式转换正确"与"ZIP 内文件名与原名一致"。

**Fix**：

```ts
// 取消分支
if (ac.signal.aborted) {
  archive.abort()
  output.destroy()
  await fsp.unlink(opts.outputPath).catch(() => {})
  return
}

// original 分支：保留原扩展名
private resolveOutPath(imagePath: string, opts: ExportOptions): string {
  const base = opts.format === 'original'
    ? basename(imagePath)
    : basename(imagePath, extname(imagePath)) + this.getExtForFormat(opts.format)
  return join(opts.outputPath, base)
}
```

---

### 23. Task 5.2 `imageStore.libraryStatus` 未按计划落地

**位置**：[LibraryPanel.tsx#L20-L55](../../src/components/library/LibraryPanel.tsx) · [imageStore.ts](../../src/stores/imageStore.ts)

**Problem**：
计划涉及文件"src/stores/imageStore.ts（增加 `libraryStatus: Record<number, 'online'|'offline'>`）"。

实施将 statusMap 用 `useState` 局部保存在 LibraryPanel 内，`grep libraryStatus src/stores/imageStore.ts` 无匹配。

**下游影响**：其他组件（如 SearchPanel 需按 Task 5.3 验收"离线库搜索按钮禁用（继承 Task 5.2）"）**无法访问该状态**，Task 5.3 的离线库继承依赖断裂。

**Fix**：
将 statusMap 迁移到 imageStore（含 `setLibraryStatus(id, status)` action），在 App 顶层订阅 `onLibraryStatusChanged` 统一写入 store；LibraryPanel/SearchPanel 从 store 消费。

---

### 24. Task 5.3 / 6.1 / 7.1 settings-service 命名空间不完整

**位置**：[settings-service.ts#L11-L37](../../src/main/services/settings-service.ts)

**Problem**：
计划要求 settings-store 新增 `theme.*` / `search.history` / `search.presets` / `slideshow.playlists` 命名空间。

实施仅有 `theme.mode` / `theme.accentColor` / `search.history` / `search.presets` / `slideshow.mode|transition|intervalSec`；

**缺失**：
- `theme.enabled`（见 #6）
- `theme.density`
- `theme.accentPreset`
- `slideshow.playlists`

密度和播放列表实际改由 zustand persist 存 localStorage（键 `theme-storage` / `slideshow-storage`），**与"持久化到 electron-store"要求不符**。

**Fix**：
补齐 4 个键；themeStore/slideshowStore 改用 IPC 读写 settings-store 而非 zustand persist，或至少将 `savedPlaylists` 双写至 electron-store `slideshow.playlists`。

---

### 25. Task 6.3 FileContextMenu 缺少"设置为封面 / 清除封面"入口

**位置**：[FileContextMenu.tsx#L30-L45](../../src/components/file-ops/FileContextMenu.tsx)

**Problem**：
计划涉及文件"src/components/file-ops/FileContextMenu.tsx（扩展"设置为封面"入口）"，验收标准"右键文件夹菜单包含'设置为封面 / 清除封面'选项"。

实施仅在 FolderTree 空白文件夹右键菜单里提供"用首张图片作封面"（`handleSetCover` 走 `getImagesByFolder(limit:1)` 拿第一张），FileContextMenu 只加了 `export` 一项，无 `setAsCover` 入口。

**下游影响**：用户**无法把特定某张图片设为封面**（只能被强制使用文件夹首图），"封面选择：首张图片（默认）/ **手动指定**"这一半需求缺失。

**Fix**：
FileContextMenu menu 数组增加 `{ id: 'setAsFolderCover', label: '设为文件夹封面', icon: ImageIcon }`，onAction 分支调用 `window.electronAPI.setFolderCover(libraryId, dirname(relativePath), relativePath)`。

---

### 26. Task 6.3 `image-service.ts` 未按计划新增 `setFolderCover` / `getFolderCover`

**位置**：[image-service.ts](../../src/main/services/image-service.ts) · [database.ts#L738-L787](../../src/main/services/database.ts)

**Problem**：
计划涉及文件"src/main/services/image-service.ts（`setFolderCover` / `getFolderCover` 方法）"。

实施直接把方法放在 MasterDB 类，library-handlers.ts 也直接调用 `masterDB.setFolderCover(...)`，跳过 service 层。**分层职责被打乱**（其他 IPC 一致走 image-service）。

**Fix**：
在 image-service.ts 增加薄封装 `setFolderCover(libraryId, folderPath, coverPath)` / `getFolderCovers(libraryId)`，handlers 改调 service。

---

### 27. Task E.2 附录 A 基线数据全部未填写

**位置**：[docs/plans/implementation-plan-2026-q3-q4.md#L784-L803](./implementation-plan-2026-q3-q4.md)

**Problem**：
计划执行节奏"Phase 5 首日跑基线，Phase 7 结束复测"；附录 A 表格所有单元格仍为"待测/待填"：
- CPU / 内存 / 磁盘 / Node 版本
- 应用启动时间
- 10 万张扫描
- FPS
- 内存占用
- 直方图延迟
- 批量导出耗时

`scripts/bench-scan.mjs` 已就绪但**未见执行结果落纸**。Task E.2 未闭环。

**Fix**：
跑 `node scripts/bench-scan.mjs`、`node scripts/smoke-archiver.mjs`，采样直方图 4K/8K 延迟与 1000 张批量导出耗时，填入附录 A + Task E.2 性能基准表的"基线"与"复测"两列。

---

### 28. Task 7.2 export handlers 位置与命名不符计划

**位置**：[library-handlers.ts#L662-L731](../../src/main/ipc/library-handlers.ts) · [file-handlers.ts](../../src/main/ipc/file-handlers.ts)

**Problem**：
计划涉及文件"src/main/ipc/**file-handlers.ts**（新增 `exportSingle` / `exportBatch` / `cancelExport` handlers）"。

实施放在 library-handlers.ts 中，命名为 `exportSingleImage` / `exportBatchImages` / `cancelExport`。file-handlers.ts 自 Phase 5 起未修改。功能等价但**文件职责错位** —— 导出属于文件操作而非库操作。

**Fix**：
迁移三个 handler 到 file-handlers.ts；或在计划文档变更日志中记录本次职责调整。

---

## 🟢 Suggestions（CONSIDER）

### 29. 幻灯片定时器 useEffect 依赖过多，每翻页 clearInterval + setInterval

**位置**：[App.tsx#L458-L522](../../src/App.tsx)

**Problem**：
改造前依赖是 `[slideshow.enabled, slideshow.interval, viewMode, handleNext, currentLibraryId, isVideoPlaying]`（稳定），改造后新增了 `currentIndex` / `images` / `currentImage` / `slideshowPlaylist`。

因为定时器回调自身就会 `setCurrentIndex`，所以每次翻页 → 依赖变化 → cleanup 清 timer → 重新 setInterval。行为上表现为：
- 每张图之间总是"完整 intervalSec"，看似正确，但和之前"每 intervalSec 精确 tick"存在**可观察漂移**（图片加载/spinner 延迟不计入）
- 若 `images` 数组在 store 中被替换（如刷新库、扫描完成推送），会立即重启计时器，用户看到幻灯片节奏被无关事件打断
- CPU 上每次翻页多一次 `clearInterval` + `setInterval` 系统调用，长列表下可测

**Fix**：
把定时器回调内部所有对最新状态的读取都改为 `useImageStore.getState()` / `useSlideshowStore.getState()`，依赖数组精简回稳定项：

```ts
}, [slideshowEnabled, intervalSec, slideshowMode, viewMode, isVideoPlaying, currentLibraryId])
```

`slideshowPlaylist` 用 `useSlideshowStore.getState().playlist` 内部读取即可。

---

### 30. `themeStore` 缺 `accentPreset` / `accentCustom` 双字段

**位置**：[themeStore.ts#L7-L18](../../src/stores/themeStore.ts)

**Problem**：
计划接口要求 `accentPreset: 'violet' | ... | 'custom'` + `accentCustom: string`（HEX）+ `setAccent(preset, hex?)`。

实施合并为单字段 `accentColor: string`，UI 上"6 预设按钮 + 自定义输入框"（SettingsPanel L70-L103）虽然可用，但：
- 用户选择"青色 #06B6D4"后再次打开设置面板，无法区分是"选中了预设青色"还是"手动输入了恰好相同的 HEX"
- 视觉高亮态可能错位（L77 `accentColor === preset.color` 依赖字符串精确匹配，**大小写敏感** —— 用户输入 `#06b6d4` 小写时按钮不高亮）

**Fix**：
按计划分离 `accentPreset` + `accentCustom`，setAccent 时若 hex 匹配某预设则回落到 preset 名，否则标记 `custom`。HEX 比较统一小写。

---

### 31. `slideshowStore.stop()` 未按计划注释显式释放资源

**位置**：[slideshowStore.ts#L211-L218](../../src/stores/slideshowStore.ts)

**Problem**：
计划接口注释"stop: () => void // **必须释放 audio 资源**"。

实施仅 `set({ isPlaying: false, audioTrack: null })`，实际释放依赖 SlideshowAudio.tsx 的 useEffect cleanup 副作用链。

这种"通过状态变更触发子组件副作用清理"的模式对单元测试不友好（E.1 关键用例"stop() 释放资源"难以断言），且如果 SlideshowAudio 未挂载（比如全屏前用户已移除音频）则 stop() 语义变空操作。

**Fix**：
在 stop() 中显式通过事件总线/ref 通知 SlideshowAudio 立即 destroy；或让 stop() 返回释放承诺，测试中可断言 audio 元素 `paused === true && src === ''`。

---

### 32. Task 5.0 chokidar 跳过决策未在计划文档标注

**位置**：[docs/plans/implementation-plan-2026-q3-q4.md#L69-L73](./implementation-plan-2026-q3-q4.md)

**Problem**：
Task 5.0 验收第 3 项"若选择纯 fs.access 方案（推荐），本任务改为**跳过**并在 5.2 中标注"。

实施确实采用了 fs.access（正确决策），package.json 无 chokidar（正确），但计划文档中 Task 5.0 状态仍为 `⬜ 未开始`，未在 Task 5.2 处标注"已决策方案 A，5.0 跳过"。**文档与代码事实脱节**。

**Fix**：
将 Task 5.0 状态改为 `✅ 已跳过（采用方案 A：fs.access）` 并在 Task 5.2 顶部加一行"决策：采用方案 A，Task 5.0 依赖引入跳过"。

---

## 📝 Summary of Changes

- **本次提交**：`8408788`（Task 7.1 幻灯片增强），涉及 12 个文件 —— 新增 `slideshowStore` / `SlideshowAudio` / `PlaylistEditor`，改造 `SlideshowBar` props、`ImageViewer` 过渡动画与 Ctrl+R 快捷键、`App.tsx` 幻灯片状态迁移，新增 `selectAudioFile` IPC 与 `settings-service` 三个键，新增 CSS keyframes。

- **构建状态**：`npm run build` **失败**（多处 TS6133 未使用变量 + 4 处 TS2339 类型错误），背景音乐功能因契约误用**运行时不可用**。

- **交付完成度**：Phase 5-7 主体功能代码骨架已就位（约 70-80%），但存在 5 个 Critical 级计划验收硬缺口：
  - Task E.1 测试完全缺失
  - Task 6.3 DB 迁移框架未实施
  - Task 6.1 feature flag 缺失
  - Task 5.3 UI 接入缺失（高亮 + 历史/预设）
  - Task 6.2 直方图三项硬性要求未达标

- **契约漂移**：
  - 新增 IPC `selectAudioFile` 与既有 `getMediaUrl` 的库访问校验冲突
  - `settings-service` 新增 schema 键无写入路径，与 zustand persist 形成双源真相
  - Ctrl+R 与既有 keydown 监听器叠加产生非预期副作用

- **建议下一步**（按优先级）：
  1. **P0（阻塞交付）**：修复 Critical #1-#3 让 `npm run build` 通过 + BGM 可用 + 快捷键无副作用
  2. **P1（计划验收）**：补齐 Critical #4-#10 的五个计划验收硬缺口
  3. **P2（质量收敛）**：处理 Warning #11-#28 的 UI 接入 / 性能节流 / 状态竞态 / 分层错位
  4. **P3（复审补漏）**：对 Phase 5.x / 6.x 提交单独跑一次 correctness + impact 复审（本次仅 Task 7.1 被深度覆盖）
  5. **P4（文档同步）**：更新计划文档 Task 5.0 状态、变更日志、附录 A 基线数据

---

## 📎 附录：评审子代理原始输出

三个子代理的完整原始报告已合并至本文档，去重规则：
- **同问题多视角命中**：保留证据更丰富的版本，标注"also in X, Y"
- **Correctness #1 + Impact #1** → 合并为 Critical #1（保留 Impact 的 types/preload 引用 + Correctness 的编译错误细节）
- **Correctness #5 + Impact #2** → 合并为 Critical #3
- **Correctness #6 + Impact #4** → 合并为 Warning #17
- **Correctness #3 + Impact #9** → 合并为 Warning #11
- **Correctness #2 中的 Settings2 未使用** → 合并入 Critical #1 的构建错误清单
- **Impact #11（Settings2 死代码）** → 合并入 Critical #1

---

**报告状态**：final
**生成时间**：2026-09-12
**下一步**：按 P0-P4 优先级修复，修复完成后重跑三视角复审验证。
