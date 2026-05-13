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

### 优化
- ImageViewer 组件 SVG 图标系统
- 按钮过渡动画和微交互
- 缩略图加载性能优化（消除重复调用、跨库批量 API、前端缓存、路径规范化）
- Store 拆分重构（imageStore → imageStore + libraryStore + favoriteStore + folderStore + uiStore）

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
