# 变更日志

本文档记录项目的所有重要变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [未发布]

### 新增
- **媒体加载性能提升（2026-09-19，已提交 `6df2c18`）**：缩略图/preview 出口由 base64 data URL 改稳定 `media://` URL（HMAC-SHA1 确定性 token + 进程级随机密钥）；协议层流式响应（`stream:true`）+ ETag/304 + Range（含 suffix）+ Cache-Control；`loadFullImage` 下线；sharp/ffmpeg 限流与临时文件泄漏治理；扫描批量事务化；Lightbox preview→原图双图层渐进；Masonry 视口窗口化；方向感知预取。CDP 真机验证 29/29（`scripts/cdp-verify-media.mjs`）；方案与基线见 `docs/archive/媒体加载性能提升方案-2026-09.md`
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
- **Phase 8 AI 插件系统补全**（2026-09-18）：`luuk.*` SDK 全链路 + 双向 RPC（`channel` 分域、requestId 命名空间隔离）、`InferencePool`（并发=1 / 交互式插队 / EP 回退 CPU / 关闭 CPU mem-arena）、模型下载（流式 SHA256 校验 + 断点续传 + url→mirrorUrls 回退）、内存水位线统一 300/400MB + 三进程 RSS 聚合、崩溃熔断（MAX_CRASHES=3）、builtins esbuild 编译管线、三个内置插件（autotone / matting(u2netp) / upscale(RealESRGAN-x4plus 分块)）、前端接线（pluginStore / SettingsPanel 三 Tab / 动态右键菜单 / JobProgressBar）、五类插件测试（SDK 契约 / 权限拒绝 / autotone 契约 / RPC 集成 / op 可见性）。全量 323 测试通过、tsc 无错、vite build 四入口成功

### 遗留项（Phase 8，2026-09-18 交付时未闭环）
- **批处理主链路交付时未真正闭合（P0-1）**：`registerOpHandlers` 当时仅透传 `{ libraryId, imageId, item }`（不含 `paths`），内置插件收到空 `paths` 返回 `skipped:true` 却仍被记为 done（假成功）；`jobsEnqueue` 仅有 preload/类型声明，渲染层无调用方；JobProgressBar 仅具备展示能力但未接入真实入队。→ **已于 P0-1 修复**（handler 解析绝对路径 + `skipped` 抛错落 failed + 多选 >20 走 `jobsEnqueue` + 入队 toast）。
- **`npm run build:dir` 完整 electron-builder 打包未验证**：R1 的「打包通道」子项仍 pending（dev 模式模块加载 + CPU EP createSession 已实测通过；win-unpacked `.node` 随包 + asarUnpack 待跑 `build:dir` 确认）
- **设计文档 PoC 数据未回填**：`ai-crawler-direction-2026-q4.md` 附录 A 中 R2（4650U CLIP 吞吐）/ R4 / R5 / R6 / R8 / R9 仍「待回填」（属其它 Phase 的 PoC，本次范围内未涉及）；R1 / R3 / R7 已回填实测值
- **matting 端到端验证仅覆盖合成图库**：test-library 图为无显著主体的生成图，抠图前景占比 ~0.5%（已确认非代码缺陷，量纲对比验证），真实含主体照片的抠图质量待人工抽检

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
- **Phase 8 AI 插件系统缺陷修复（M1–M5，2026-09-19，分支 `fix/phase8-defects`）**：
  - **M1 批处理与资源上限**：P0-1 批处理主链闭合（handler 解析绝对 `paths`、`skipped` 归 failed、多选 >20 走 `jobsEnqueue`、入队 toast）；P0-2 upscale 输出像素预算守卫（>40M 抛业务错 + dst 分配兼底）；P0-3 内存水位线阈值口径/阈值统一。
  - **M2 权限**：P1-4 `edit.write` 绕过路径守卫；P1-5 移除 `activePluginId` 改为逐调用传自身 pluginId（防并发串位）；P2-12 `createSession` 忽略外部 modelPath + 模型所有权校验。
  - **M3 生命周期**：P1-6 Worker 崩溃后清 `loadedInWorker` + 自愈重载；P1-8 `verifyModel` 空 sha256 不删文件/大小写修正/成功回写 + manifest 格式断言 + 启动回填；P1-9 `JobRunner` 自泵；P1-11 exit 监听跨实例守卫 + `setEnabled` 成功标志后置。
  - **M4 并发与资源**：P1-7 SDK 反向调用分级/动态超时 + 迟到响应幂等丢弃（`plugin.cancel` 降级后续项）；P1-10 `InferencePool` 创建锁/LRU 驱逐/按插件销毁 + 内存压力驱逐接线。
  - **M5 算法质量与测试补盲**：P2-13 upscale 量纲改全局 min/max（跳过非有限、全非有限报错）+ `realScale===scale` 断言 + 解码强制 sRGB；P2-14 matting 改绝对量纲 alpha；P2-15 张量视图 byteOffset + int64 + 尺寸校验；P2-16 删 `WorkerRpcRequest` 已移除 `inference.*` 示例；P2-17 右键菜单按 op 可用性过滤/置灰；P2-18 builtins 产物断言 + `models.directory` 运行期读取；后处理抽纯函数并补 29 例单测。全量 43 文件 393 用例绿、tsc 无错。
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
