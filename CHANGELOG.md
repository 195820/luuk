# 变更日志

本文档记录项目的所有重要变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [未发布]

### 新增
- 文档结构重新构建
- 评分组件 (RatingStars)
- 扫描进度组件 (ScanProgress)
- 应用布局拆分 (AppHeader, AppSidebar, AppFooter, SlideshowBar)
- 库面板 (LibraryPanel)
- 应用逻辑 hook (useAppLogic)
- **多媒体支持**：视频/音频播放（`luuk-file://` 自定义协议，流式加载，支持 range 请求）
- **IPC 接口**：`loadFullImage`（图片 data URL）、`getMediaUrl`（媒体流式 URL）
- **媒体类型判断**：`getMediaTypeFromPath()` 基于文件扩展名，比数据库 `media_type` 更可靠
- **多媒体模块重构方案**：竞品调研（Immich/Hydrus/ImageGlass/nomacs）、开源库选型（YARL/wavesurfer.js）、4 阶段实施计划（docs/archive/多媒体模块重构方案.md）

### 已知问题（2026-06-22 深度审查发现）
- **P0**: 视频 seek bar 不更新（`defaultValue` 未绑定 `currentTime`）
- **P0**: 视频无 `onEnded` 回调，大文件 data URL 加载导致 OOM
- **P0**: 音频在查看器中渲染为 `<img>` 标签，永久 loading
- **P0**: GIF 暂停按钮状态未应用到 `<img>` 元素
- **P1**: `getThumbnails` 返回 `Map` 对象，IPC 序列化后变空对象
- **P1**: 4 个 store（libraryStore/uiStore/favoriteStore/folderStore）为死代码
- **P1**: 主网格逐个 IPC 调用缩略图（50-80 个并发调用）
- **P1**: `getFolderTree` 全量加载路径到内存
- **P2**: 路径比较大小写不一致、无 CSP、IPC 无输入校验
- **P3**: 媒体类型检测逻辑重复 5 处、`any` 类型泛滥

### 优化
- ImageViewer 组件 SVG 图标系统
- 按钮过渡动画和微交互
- 缩略图加载性能优化（消除重复调用、跨库批量 API、前端缓存、路径规范化）
- Store 拆分重构（imageStore → imageStore + libraryStore + favoriteStore + folderStore + uiStore）
- `getFavoriteImages()` 返回值增加完整图片元数据（width, height, format, media_type, duration, codec）
- ImageViewer 视频判断逻辑简化，仅依赖 `mediaType` 不再检查扩展名集合
- 媒体加载增加 `cancelled` 标记防止异步竞态

### 修复
- 修复收藏库视图切换时索引和数组不同步的问题
- 修复查看器图片居中问题
- 修复查看器适应窗口模式小图片不放大问题

---

## [1.0.0] - 2026-03-01

### 新增
- 基础图片查看功能（缩放/旋转/翻转）
- 网格视图（虚拟滚动）
- 瀑布流视图
- 文件夹树浏览
- 多库管理
- 收藏系统（单图/文件夹收藏）
- 缩略图缓存系统（WebP + LRU）

### 技术栈
- Electron 40
- React 19
- TypeScript 5.9
- Vite 7
- Zustand 5
- better-sqlite3 12
- sharp 0.34

---

## 性能基准

**测试环境**: Windows 11, Node.js 24.14.0, Electron 40.6.1
**测试数据**: 7,780 张高清写真图片

| 指标 | 实测值 | 目标值 | 状态 |
|------|--------|--------|------|
| 扫描速度 | 4.56ms/张 | <20ms/张 | ✅ 优秀 |
| 百张扫描 | 456ms | <2000ms | ✅ 优秀 |
| 千张扫描 | ~4.6s | <30s | ✅ 优秀 |
| 内存占用 | <400MB | <500MB | ✅ 达标 |

---

*更多历史变更请参考 git 提交记录*
