---
title: Phase 4 实施计划 — 查看器体验强化
description: 图片对比模式（#14）、全屏沉浸式（#20）、相邻图预加载（#11）、缓存管理 UI（#19）四项功能的完整实施计划
type: plan
status: archived
updated: 2026-08-31
archived: 2026-08-31
---

# Phase 4 实施计划：查看器体验强化

> 对应方向规划 `2026-08-31-phase4-and-beyond.md` 的 Phase 4：#14 对比模式 → #20 全屏沉浸 → #11 预加载 → #19 缓存管理。
> 分支建议：`phase-4-viewer-experience`；预估 4 天（含收口缓冲）。

## 当前基线（预读核实，2026-08-31）

以下事实均已对照代码核实，实施时以此为锚点：

1. **查看器变换架构**：`ImageLightbox.tsx` 基于 YARL（Inline + Zoom 插件），`zoom.ref` 仅暴露 `zoomIn/zoomOut/changeZoom`，**无法读取或外部施加当前平移/缩放变换**；控制通道 `lightboxActions` 是 window 全局自定义事件（`image-lightbox-*`），**隐含单实例假设**——同屏挂载两个 Lightbox 会互相串扰。
2. **快捷键分布**：`ImageViewer.tsx` 内部 window 监听 `R/H/V/I/Space/Esc/←/→`（L348-389）；`App.tsx` 监听 `F5`（视图切换 L683）、`F6`（文件夹面板 L689）、`Home/End` 等。主进程无全屏处理。
3. **窗口**：`electron/main.ts` L134 `frame: false`；窗口控制 IPC 用 `ipcMain.on` 风格（`window-minimize/maximize/close`，L152-161）。
4. **media:// 链路**：`App.tsx` L639 `loadMedia` effect → `getMediaUrl(filePath)` → `setCurrentImageSrc`；`media-registry.ts` 令牌有 1 小时 TTL + 10000 条上限 + 每 10 分钟清理，`resolveMediaToken` 访问续期——预加载消耗令牌可控。
5. **缓存现状**：`cache.ts` `LRUCache` 已具备 `getStats/trim/setMaxSize/clear`；`image-service.ts` L54 硬编码 `getLRUCache(200)`；`getCacheStats/clearCache` IPC 已注册（`library-handlers.ts` L345-352，`IPC_HANDLER_NAMES` L514），但**只覆盖内存 LRU，不含 thumbs.db 磁盘占用**；`types/index.ts` L47-48 已有 ElectronAPI 声明。
6. **设置持久化**：`settings-service.ts`（electron-store，类型化 `SettingsSchema`）仅主进程使用，**无渲染端设置 IPC**。
7. **多选与右键**：`selectionStore.selectedPaths`（Set<string>）；`FileContextMenu.tsx` L30-41 items 数组（含 `findSimilar`/`tag`），无选中数量感知——对比入口需在网格层判断。
8. **可复用图标**：`App.tsx` 已导入 `Database`、`Columns3`（L8）。

## 设计决策（先于 Task 声明）

- **D1 对比模式不复用 YARL**：同步缩放平移需要「读取变换 + 外部施加变换」两个能力，YARL zoom ref 都不提供；且全局事件通道是单实例假设。对比视图自建受控变换面板（单一共享变换状态驱动双 `<img>`）。
- **D2 对比仅限图片**：选中集含视频/音频时对比项置灰不显示，避免媒体类型分叉。
- **D3 全屏不做设置持久化**：会话级状态，F11 切换；主进程转发原生全屏事件保持渲染端同步（防止 Alt+Tab 等系统路径改变状态）。
- **D4 预加载只做查看器相邻图**：网格滚动预加载已由三级缩略图缓存覆盖（4.56ms/张），不重复建设；「按滚动速度动态调整」实现为翻页防抖——快速翻页时跳过中间图的预加载。
- **D5 缓存上限持久化走专用通道**：不新建通用设置 IPC，只加 `getCacheConfig/setCacheLimit` 两个通道 + `SettingsSchema` 新增字段，控制暴露面。

---

## Task 1：对比模式 — CompareViewer 组件（最高风险，最先做）

**目标**：新建 `src/components/CompareViewer.tsx`，双图并排 + 滑块两种模式，共享变换同步。

**涉及文件**：
- `src/components/CompareViewer.tsx`（新）
- `src/utils/compare-transform.ts`（新，纯函数变换计算，便于单测）

**关键设计**：
- 单一变换状态 `{ scale, tx, ty }`，两个面板的 `<img>` 施加相同 `transform: translate(tx,ty) scale(scale)`，天然同步。
- 交互：滚轮以光标为中心缩放（`compare-transform.ts` 的 `zoomAt(point, delta, state)`）、拖拽平移（`clampPan` 边界约束）、双击重置。
- 并排模式：两面板各占 50%，独立 `<img>`；滑块模式：右图叠加在上，`clip-path: inset(0 0 0 X%)`，分割条可拖动（只改 clip 位置，不动变换）。
- 工具栏：模式切换（并排/滑块）、缩放百分比显示、重置、交换左右图、关闭（Esc）。
- 图片加载：入参为两个 `src`（media:// URL），各自独立 `onLoad`，未就绪显示 spinner。

**验证**：`compare-transform.test.ts` 覆盖缩放边界（0.1~10，与 Lightbox 口径一致）、光标锚点缩放坐标计算、平移钳制；手动验证两图同步缩放/平移无偏移。

## Task 2：对比模式 — 入口接线

**目标**：网格多选恰好 2 张图片时可进入对比。

**涉及文件**：
- `src/components/file-ops/FileContextMenu.tsx`：items 加 `{ id: 'compare', label: '对比', icon: Columns2 }`，新增可选 `compareEnabled?: boolean` prop 控制显示。
- `src/components/ImageGrid.tsx` / `MasonryGrid.tsx`：`handleMenuAction` 加 `case 'compare'`——取 `selectedPaths` 中恰好 2 个路径，经 `getMediaPath(libraryId, imageId)` → `getMediaUrl` 解析出两个 media:// URL，打开 CompareViewer 覆盖层；`compareEnabled={selectedPaths.size === 2 && 均为图片}`。
- `src/App.tsx` 或网格层渲染 CompareViewer 覆盖层（就近在网格层，与现有 `renameDialog` 模式一致）。

**验证**：选 1 张/3 张时菜单无对比项；选中含视频时无对比项；2 张图片可进入并正常显示。

## Task 3：全屏沉浸式模式（#20）

**目标**：F11 切换系统全屏，全屏时隐藏 AppHeader/AppFooter/文件夹侧边栏，只留内容区。

**涉及文件**：
- `electron/main.ts`：`createWindow` 内新增 `ipcMain.on('window-toggle-fullscreen')`（与现有窗口控制同风格）、`ipcMain.handle('window-is-fullscreen')`；`mainWindow.on('enter-full-screen'/'leave-full-screen')` → `webContents.send('fullscreen-changed', bool)`。
- `electron/preload.ts` + `src/types/index.ts`（ElectronAPI）：`toggleFullscreen()`、`isFullscreen()`、`onFullscreenChanged(cb)` 三处同步（**声明三处同步纪律**）。
- `src/stores/viewStore.ts`：加 `immersiveFullscreen: boolean` + setter。
- `src/App.tsx`：F11 键（与 F5/F6 同处，`preventDefault`）→ `toggleFullscreen()`；`useEffect` 订阅 `onFullscreenChanged` 同步状态；`immersiveFullscreen` 为 true 时条件渲染隐藏 header/footer/侧边栏。
- `src/components/layout/AppFooter.tsx`、`docs/README.md` 快捷键表：补 `F11: 全屏` 说明。

**验证**：F11 进出全屏；全屏下无任何 chrome；退出后布局恢复；系统途径（如外接显示器切换）改变全屏状态时 UI 状态跟随。

## Task 4：图片预加载优化（#11）

**目标**：查看器浏览时预热相邻图，快速翻页时自动跳过，降低切图等待。

**涉及文件**：
- `src/hooks/useAdjacentPreload.ts`（新，hook）
- `src/App.tsx`：在 `currentImage` 变化处接入。

**关键设计**：
- 触发：`currentIndex` 变化后启动 150ms 防抖；防抖窗口内再次翻页则重置计时——快速翻页时中间图自然被跳过（即「按滚动速度动态调整」）。
- 预热流程（仅 `mediaType === 'image'` 的相邻图，±1 优先、±2 次之）：`getMediaPath` → 查 `Map<absolutePath, mediaUrl>` 缓存避免重复注册令牌 → 未命中则 `getMediaUrl` → `new Image().src = url` 触发浏览器解码预热。
- 取消：组件卸载或再次翻页时中断未开始的预热（`cancelled` 标志，与现有 `loadMedia` 模式一致）。
- 预加载结果缓存上限 20 条，超出清空（防内存累积）。

**验证**：`useAdjacentPreload` 的防抖与优先级逻辑抽纯函数测试；手动验证正常翻页相邻图秒开、长按方向键快速翻页不卡顿不阻塞。

## Task 5：缓存管理 — 主进程扩展（#19 数据层）

**目标**：缓存统计覆盖磁盘占用，上限可配置且持久化。

**涉及文件**：
- `src/main/services/settings-service.ts`：`SettingsSchema` 加 `'cache.maxMemoryMB': number`（默认 200）。
- `src/main/services/image-service.ts`：构造函数 `getLRUCache(200)` 改为读取持久化上限；`getCacheStats()` 扩展返回 `{ memory: {count,sizeMB,maxSizeMB,utilization}, disk: { thumbsDbSizeMB } }`（disk 为各库 `.ivlib/thumbs.db` 文件大小之和，`fs.stat` 容错文件缺失）；新增 `getCacheConfig()/setCacheLimit(mb)`（写设置 + `cache.setMaxSize`）。
- `src/main/ipc/library-handlers.ts`：`getCacheStats` 返回类型同步；新增 `getCacheConfig/setCacheLimit` 两个 handle，**同步加入 `IPC_HANDLER_NAMES` 数组（L514 区域，防窗口关闭泄漏）**。
- `src/types/index.ts`：ElectronAPI 声明同步（`getCacheStats` 返回类型扩展 + 两个新方法）。

**验证**：`cache.test.ts` 扩展——上限变更后 `setMaxSize` 生效与超限修剪；磁盘统计对缺失文件容错。

## Task 6：缓存管理 — CachePanel UI（#19 渲染端）

**目标**：头部入口打开缓存管理面板：占用统计（内存/磁盘）、上限滑块、一键清理。

**涉及文件**：
- `src/components/CachePanel.tsx`（新）：液态玻璃浮层（复用 `glass-l3` 风格，参考信息面板），内存占用进度条（现有 `utilization` 字段）、磁盘占用、上限滑块（100-1000MB，步进 100，失焦保存调 `setCacheLimit`）、「清空内存缓存」按钮（调 `clearCache` 后刷新统计）。
- `src/App.tsx`：头部按钮组加 `Database` 图标按钮（已导入）切换面板显隐。

**验证**：面板打开即拉取统计；清空后内存占用归零且网格缩略图再次可见（缓存重建正常）；上限调低后超限条目被修剪（观察统计数字）。

## Task 7：收口

1. 全量验证：`npx vitest run` 全绿、`npx tsc --noEmit` 零错误、`npm run build` 产出安装包（`GH_TOKEN` 缺失导致的 exit 1 非构建失败，既有结论）。
2. 手动回归清单：对比模式（并排/滑块/同步变换/交换）、F11 全屏进出与布局、快速翻页流畅度（对照 ≥30FPS 红线）、缓存面板清空后浏览正常、既有右键菜单其余项不受影响、多选/幻灯片/收藏视图回归。
3. 归档原子性：本计划文档复制进 `docs/archive/superpowers/plans/` 与删除原件**同一提交**，front matter 改 `status: archived` + `archived` 日期。
4. `docs/roadmap.md` 回写：#11/#14/#19/#20 标 ✅ 并注明实施批次；「推荐执行顺序」补第五轮（3 列表格格式纪律）；「当前进度」引用行补第五轮。
5. `docs/README.md` 快捷键表补 F11（Task 3 已含，此处复核）。
6. `CHANGELOG.md` 补 Phase 4 条目。

---

## 风险与顺序

| Task | 风险 | 说明 |
|------|------|------|
| 1-2 对比模式 | 高 | 自研变换同步是唯一技术难点；最先做，失败可独立回滚 |
| 3 全屏 | 中 | 多显示器/系统全屏状态同步是边界；事件转发兜底 |
| 4 预加载 | 中 | 令牌消耗与内存为约束点，已有缓存与上限设计 |
| 5-6 缓存 | 低 | 主进程能力大半已存在，主要是扩展与 UI |

顺序：1 → 2 → 3 → 4 → 5 → 6 → 7，每 Task 独立提交。

## 约束与红线

- 性能红线：启动 <3s、内存 <500MB、滚动 ≥30FPS；预加载不得阻塞翻页主线程。
- **声明同步纪律**：新/改 IPC 必须同步 `preload.ts` + `types/index.ts` ElectronAPI + `IPC_HANDLER_NAMES`（三处）。
- 对比模式不触碰 `ImageLightbox` 既有实现，避免影响现有查看器回归。
- 不新增第三方依赖（对比自研变换，无新库）。

## 测试增量预期

- 新增：`compare-transform.test.ts`（变换计算）、预加载防抖/优先级测试、`cache.test.ts` 上限与磁盘统计扩展。
- 全量基线：当前 124/124，完成后预期 ≥135。
