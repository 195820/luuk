---
title: 缺陷修复总结 — 2026-09-15
description: 回归测试 DEF-1~DEF-10 首轮修复记录（7/10 通过，剩余 R-1/R-2/R-3 已由 07c1c3d 闭环）
type: review
status: archived
updated: 2026-09-15
---

# 缺陷修复总结 — 2026-09-15

## 已通过（7/10）

| 缺陷 | 修复要点 | 验证 |
|------|----------|------|
| DEF-1 新增库 UI 状态不刷新 | `image-service.scanLibrary` 末尾广播 `library-scan-finished`；前端 subscribe reload | 诊断 IPC 通过 |
| DEF-2 avi/mkv 缩略图刷屏 | `thumbnailer.ts` / `image-service.getThumbnail` / `scanner` 对 avi/mkv 短路 | 日志无 ffmpeg 错 |
| DEF-3 搜索预设 undefined 白屏 | handler `Array.isArray` 兜底 + store isArray 校验 + 组件 `?? []` | `getSearchPresets` 回 `[]` |
| DEF-4 网格间距过大/底部黑边 | `ImageGrid.tsx` 行高 260→216、列 5→6、底部空白 21600px→16px | 代码计算对比 |
| DEF-5 查看器翻页/关闭失效 | App + ImageViewer keydown 改 `addEventListener(..., true)` 捕获阶段，绕过 YARL `stopPropagation` | 代码 + tsc |
| DEF-6 收藏无反馈 | 心形按钮 + Framer Motion 脉冲 + 玻璃 toast；F/按钮同路径 | 代码 + tsc |
| DEF-9 幻灯片不播放 | `App.tsx:565` 定时器回调改 `handleSlideshowNext()` 统一 `slideshowNavTick` 链路 | 代码 + tsc |

## 剩余问题（3/10）

### R-1 搜索框限制在头部栏，面板展开伸不出去（原 DEF-3 的后续表现）
- **现象**：搜索面板展开后被头部栏区域截断（overflow: hidden），下拉的历史/预设/面板内容无法向下方网格区域延伸。
- **代码定位**：`src/components/SearchPanel.tsx` 内联渲染于 header 的 `App.tsx:1025`，header 容器或其父容器 `overflow: hidden` 把展开内容切断。
- **修复方向**：把搜索面板从 header 流内改为 portal/绝对定位浮层（`fixed` 或 portal 到 `body`），让展开内容不受 header 裁剪。或把 header 的 `overflow` 改为 `visible`，但注意与 frameless 拖拽区的冲突。

### R-2 设置面板更换主题/密度/强调色后没有实时反应（原 DEF-8 后续）
- **现象**：在设置面板里切浅色/深色、改密度、换强调色，UI 不立即刷新（可能要关面板重开或等一会才变）。
- **代码定位**：`src/components/SettingsPanel.tsx` 调用 `useThemeStore` 的 `setMode/setAccentColor/setDensity`，store 已更新但渲染层（`src/index.css` 的 `@theme` CSS 变量、class 绑定）未响应式跟随。可能原因：主题 class（`dark/light/system`）是通过副作用（`useEffect`）写入 `document.documentElement`，而 CSS 变量更新走 `persist` 存储异步回写，存在时序差；或 density class 挂载到 body/根容器但面板自身用的是固定 class。
- **修复方向**：让 `themeStore` 的 `setMode/setAccentColor/setDensity` 同步更新 `document.documentElement` 上的 class + CSS 变量，确保面板关闭前已生效；或在面板内加本地预览（预览区强制用当前选择值渲染）。

### R-3 关闭应用仍卡（原 DEF-10 未完全解决）
- **现象**：按之前修复后关闭仍长时间无响应。`shutdownApp()` 已有 `stop → kill ffmpeg → pluginManager.shutdown → jobRunner.shutdown(2s) → closeAllDatabases` 顺序，但依然卡。
- **排查方向**：
  - `shutdownApp` 是 `void` 调用（fire-and-forget），`app.quit()` 在 `shutdownPromise` 完成前执行 → 数据库关闭与退出竞态。
  - `window-all-closed` 走 `void shutdownApp(); app.quit()`，但 `before-quit` 会 `preventDefault` 等待 `shutdownApp().finally` → 若 2s 超时不够（ffmpeg kill 后还有 close 回调的 300ms 定时器）、或 `closeAllDatabases` 被某处 `.db` 文件锁住，仍会拖。
  - 可能遗漏的 keepalive：`vitest.setup.ts` / `scanner.ts` 的某处 `setInterval`、或 `image-service` 的缓存过期定时器。
- **修复方向**：① `window-all-closed` 改为 `await shutdownApp()` 后 `app.quit()`（而非 fire-and-forget）；② 把 `SHUTDOWN_TIMEOUT_MS` 从 2s 降到 1s 并加日志，找出具体卡在哪一步； 检查是否还有其他 interval/timer 未清理。

## 统计

- 改动：20 文件，+474/-98
- 通过：7/10
- 剩余：3/10（搜索框截断、主题实时反应、关闭仍卡）
