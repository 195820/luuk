# 变更日志

本文档记录项目的所有重要变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [未发布]

### 新增
- **Agent 体系与智能采集**（Phase 9 M0-M3，2026-09-26）：
  - Agent 统一基座：数据库迁移 v3（preference_profile/proposals/feedback_log/crawl_sources/crawl_items）、偏好画像（冷启动加权 + 水位线增量重算 + learnedDeltas 学习叠加）、决策层（DecisionProvider + 置信度门控升级链 + 本地规则 LocalRulesProvider）、提案状态机与反馈强化（+0.1/-0.02/-0.2，累计拒绝晋级排除项）、调度循环 AgentScheduler（复用 JobRunner，定时/手动/新来源三触发）
  - Jev 决策插件（M2）：`decision-provider` 插件形态 + 隐私护栏（出站文本元数据白名单过滤，API Key 明文不下渲染进程），默认关闭可回落本地规则
  - 采集 Agent 三端接入（M3）：CrawlerService 宿主编排 + per-host 闸门频控退让 + 隐藏窗口浏览器层 + 流式下载（.part 原子落盘/Range 续传）+ url_hash→file_hash→pHash 三级去重入库 + sidecar 溯源；内置适配器 bili-web / xhs-web / tg-mtproto / tg-export-import；RecommendScorer 打分→提案闭环（人在回路，UI 属 M4）
  - 新增 IPC：`triggerCrawlDiscovery` / `getSourceLoginStatus` / `startSourceLogin` 等（preload 已暴露）；Feature Flags `agent.enabled` / `jev.enabled` 默认关闭
- **CLIP 索引与语义搜索**（Phase 9 M5，T21 2026-10-07 / T22 2026-10-07）：
  - T21：`vectors.db` 独立分库（`image_embeddings`，quant 固定 int8）+ usearch HNSW 图索引；真实 `OnnxClipEngine`（sharp 预处理 + onnxruntime 图像塔 + int8 量化）经 `ModelManager` SHA256 校验；扫描后自动增量索引（`ai.clip-index` 作业，R2 会话分时 load/unload + 引擎引用计数）
  - T22 语义搜索：自实现纯 JS CLIP 分词器 `clip-tokenizer.ts`（byte-level BPE + SOT/EOT + pad 77，逐位对齐 transformers.js 黄金 fixture）+ `text-encoder.ts`（`OnnxClipTextEncoder` 文本塔，int8 默认 / fp32 兜底，C2 串行化 load）+ `semantic-search.ts`（DI 编排）+ `ai-wiring.runSemanticQuery`（文本引用计数 + idle TTL 60s + 与索引会话互斥）；`SearchPanel` 新增独立「语义搜索」模式（与关键词互斥）
  - 新增 IPC：`semanticSearchImages`（camelCase、动态 import 保持 C1 零原生加载）；需已索引且 `ai.enabled` 开启方可用。`VectorIndexService.search()` 获得首个生产调用方（W13 技术债清偿）
  - 代码审查修复（2026-10-07）：修出 2 Critical（语义框回车与关键词搜索竞态双触发→`stopPropagation` + 请求序号丢弃过期响应；`ai.enabled` 未门控 + 失败静默→按 `getAiStatus` 隐入口 + `semanticError` 上屏）与 7 Warning（`textInflight` 变负致常驻→防负 + 拆链代际；旧文本编码器未 unload 泄漏→换链卸旧；索引可在查询 await 期卸载共享 ANN→收敛同步临界区；只读检索误落盘 sidecar→`countIndexed` 守卫；§9.7 跨模型拒绝比较未强制→`getModelId` 断言；分词 golden 门控脱离 gitignore cache 入库 fixture；语义结果被过期关键词高亮）；硬红线（C1 零原生 / verifyModel 只读 / 文本塔指纹 / 相似度口径 / HF 截断）经三视角核查无问题（其中“词表 miss 回落 EOT”经核查为误报，保留 EOT）
- **插件系统**（Phase 8）：插件宿主（utilityProcess + MessagePort RPC，崩溃隔离）、PluginLoader 生命周期与 kind 白名单、内置插件静态登记双路径契约、JobRunner 后台作业调度（持久化/断点续跑/优先级）、三级内存水位线监控、模型管理器（SHA256 完整性校验）、编辑版本链（非破坏性编辑输出）、内置插件 autotone、Feature Flags（`plugins.enabled`/`ai.enabled`/`crawler.enabled`）
- **搜索增强与离线库检测**（Phase 5）：离线库自动探测置灰、搜索历史与预设、高亮匹配
- **主题皮肤与直方图**（Phase 6）：themeStore + SettingsPanel 主题/强调色/密度、图片 RGB/亮度直方图、文件夹封面设置
- **导出与幻灯片增强**（Phase 7）：archiver 流式 ZIP 导出 + 进度反馈 + ExportDialog；幻灯片过渡动画/随机播放/自定义播放列表/背景音乐
- **图片对比模式**（Phase 4 Task 1-2）：网格多选 2 张图片后右键「对比」，打开并排/滑块双模式对比视图，共享变换同步缩放平移，自研 `compare-transform.ts` 纯函数变换计算
- **全屏沉浸式模式**（Phase 4 Task 3）：F11 切换系统全屏，全屏时隐藏头部/底部/文件夹侧边栏，主进程转发原生全屏事件保持渲染端同步
- **相邻图预加载**（Phase 4 Task 4）：`useAdjacentPreload` hook，150ms 防抖 + ±1/±2 优先级，快速翻页自动跳过中间图，令牌缓存避免重复注册
- **缓存管理面板**（Phase 4 Task 5-6）：头部「缓存」入口打开面板，显示内存/磁盘占用统计、可调上限滑块（100-1000MB 持久化）、一键清空按钮
- **浏览历史**：查看图片自动记录；侧边栏「最近浏览」缩略图列表，可跳转原图/清空（`history` 表容量上限 500）
- **评分系统接入**：查看器工具栏星标评分（评分隐含收藏，保留 tags），收藏视图支持按评分排序
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

### 修复
- **删除库失败**：`MasterDB.removeLibrary` 先清理 favorites/favorite_folders/history 依赖行再删库，避免 FOREIGN KEY 约束拒绝删除
- **浏览历史无缩略图/打不开**：乐观插入补齐 id 等元数据；历史跳转在未命中预览窗口时按 relative_path 兜底

### 优化
- 增量扫描：文件大小 + 修改时间双条件跳过未变动文件；已有记录批量预载（单次查询 → Map，替代逐文件查询）
- ImageViewer 组件 SVG 图标系统
- 按钮过渡动画和微交互
- 缩略图加载性能优化（消除重复调用、跨库批量 API、前端缓存、路径规范化）
- Store 拆分重构（imageStore → imageStore + libraryStore + favoriteStore + folderStore + uiStore）
- `getFavoriteImages()` 返回值增加完整图片元数据（width, height, format, media_type, duration, codec）
- ImageViewer 视频判断逻辑简化，仅依赖 `mediaType` 不再检查扩展名集合
- 媒体加载增加 `cancelled` 标记防止异步竞态

### 修复
- 修复视频上按 Space 同时触发幻灯片与视频播放的问题（App.tsx 对视频跳过 toggleSlideshow）
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
