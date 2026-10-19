# 变更日志

本文档记录项目的所有重要变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [未发布]

---

## [1.1.0] - 2026-10-19

> 首个正式打 tag 的发布版本（Phase 1-9 + Tier 1 累计交付）。上一段 `[1.0.0] - 2026-03-01` 为 MVP 基线记录（未打 tag）。
> 发版门禁实测：`tsc --noEmit` 0 错 · vitest **98 files / 1017 passed / 2 skipped / 2 expected-fail** · Playwright Electron E2E **全组绿**（含本版本新修的 PH8-18）· `npm run build` 产出 `release/Image Viewer-1.1.0-Setup.exe`。

### 修复
- **作业自泵排队饿死（DEF-PUMP-01，2026-10-19，v1.1.0 发版门禁由 E2E PH8-18 暴露）**：`JobRunner.pump()` 原只取 `maxConcurrent * 4` 行（默认并发 1 → 窗口 4）pending 作业，按 `priority DESC, created_at ASC` 排序。当窗口被「kind 无注册 handler 而永久 pending」的陈旧作业（插件关闭期入队后从未启用）占满时，循环逐个 `continue` 后窗口耗尽，真正可跑的排队作业永远轮不到——实测现象：队头作业 done、先入队作业永久 pending、后入队作业反而被 IPC 直起路径救活。修复：**分页穿越**（`PUMP_PAGE=50` 逐页直到槽位填满或 pending 遍历完），`MasterDB.getPendingJobs` 新增向后兼容的 `offset` 形参。新增回归单测（失败先行）
- **退出期自泵复活（N1，2026-10-19 收编）**：`shutdown()` 置 abort/paused + `runningJobs.clear()` 后，被 abort 的 `executeJob` 收尾无条件调 `pump()`，此时槽位已空 → 复活其它 pending 作业并与 `app.exit(0)` 抢写 DB（原登记于《全面测试方案》附「仅登记不修」，因本轮拓宽了自泵扫描范围必须同时收口）。修复：`shuttingDown` 标志位，`pump()` 入口早退；新增回归单测
- **E2E 可诊断性**：`m-c-v5-worker.spec.ts` 的 `waitJob` 超时消息补齐「本作业最后状态 + 全量作业简表」（本次得以从单次失败直接定位到饿死根因）

### 文档
- **文档漂移机械修复轮（2026-10-19）**：CLAUDE.md 环境口径修正——全量 vitest **不再需要** imageviewer conda 环境（`scripts/ensure-test-native.mjs` 已自动准备 Node-ABI 的 better-sqlite3 副本并还原 Electron-ABI，系统 Node v24 实测全绿），基线数字刷至 98 files / 1017；`docs/roadmap.md` 中 M4-M6「待做」/向量检索「⬜ 待解」/552 用例等陈旧表述回写为实际交付态，新增第十轮（Phase 10）条目；`docs/README.md` 索引树重建（plans/ 实有 13 份，旧树中 3 个已归档件为断链）；plans/ 下 5 份缺 YAML front matter 的文档补齐；`tier1` 计划 §0/§5.1 与自身「交付状态」节的矛盾环境口径归一

### 已知遗留（本版本不阻放，均已登记）
- **HNSW 召回裁决悬空（R11）**：200K×512 **随机** int8 向量下 recall 崩塌（f32 对照 recall=1.0 证脚本无 bug），**不可据此触发 D14 回退**；`--from-db` 真实向量复测仍「待实现」，sqlite-vec 回退为「已裁决待实施」
- **`perHost` 闸门（A-5）**：采计划写死的回退方案 (b)，标 `@deprecated` 且实现恒串行（比声明更保守）；计数信号量改造因与 first-visit 频控退让深度耦合，留独立任务
- 人工用例 `TC-THUMB-004/005`、`TC-PERF-001~003` 待执行；`imageStore` 巨石 store（541 行）仅部分拆分；文件夹级增量扫描暂缓

### 修复
- **AI 接线并发正确性（Tier1-A，2026-10-11，`fix/phase8-defects`）**：修复 6 项经三路只读审计 + 源码逐行复核确认的竞态/泄漏（A-1~A-6），另经代码评审加固 5 处（A-7/A-8 按实测口径登记不单独修）；共 +14 例确定性测试，五 suite 全绿：
  - A-1（P0 内存泄漏）`OnnxClipEngine`/`OnnxClipTextEncoder` 补 `disposedDuringLoad` 三件套：load 在飞期 unload → 新会话建成即释放；评审加固：`load()` 在无会话态显式抛错（不静默 resolve 骗过并发等待者）
  - A-2（P1 查询静默失败）`runSemanticQuery` 与标签 handler 在 `await enc.load()` 与 `encode` 之间加换链守卫 `if (enc !== queryTextEncoder)`：旧链在飞被拆则查询作废（标签项抛错可重跑）；评审加固：早退补 `logger.warn` 留痕
  - A-3（P1 磁盘竞态）`getVectorIndexService` 换模型时删除旧 dim/modelId 的 stale sidecar + `VectorIndexService` 落 `{dim,modelId}` 元数据并在 load 前校验（评审加固：覆盖进程重启换模型绕过工厂 rm 的 §9.7 跨模型污染），新会话从 vectors.db 全量重建
  - A-4（P1 重复作业）`AgentScheduler.triggerNow` 引入 `pendingSources` 同步占位临界区：消灭「快照→await enqueue→登记」间隙的 dedup 竞态，同来源并发只入队一次；enqueue 失败 finally 回滚
  - A-5/A-6（P2/P3）`RequestExecutor.HostGate` 删除 `hostWaiters` 泄漏字段（递增后无读取/递减/删除路径）；`perHost` 标注为保留字段（`@deprecated`，当前实现恒串行）——采计划回退方案 (b)，因 tail 链与 first-visit-skip-delay 频控退让深度耦合，信号量改造留独立任务
  - A-7（P3）`enqueueIndexForLibrary` 的 `engine.load()` 纳入 try、异常回滚 `librarySessions` 占位（评审加固），引用计数“只对成功 load 计数”由结构保证；A-8（P3）评审发现 stop() 退订会使“stop 时刻在飞”作业终态事件永久丢失→来源饥饿，故不撤订阅（单例内良性），仅停定时器

### 新增
- **媒体加载性能提升（2026-09-19，`fix/phase8-defects` `6df2c18`，未发版）**：缩略图/preview 出口由 base64 data URL 改稳定 `media://` URL（HMAC-SHA1 确定性 token + 进程级随机密钥）；协议层流式响应（`stream:true`）+ ETag/304 + Range（含 suffix）+ Cache-Control；`loadFullImage` 下线；sharp/ffmpeg 限流与临时文件泄漏治理；扫描批量事务化；Lightbox preview→原图双图层渐进；Masonry 视口窗口化；方向感知预取。CDP 真机验证 29/29（`scripts/cdp-verify-media.mjs`）；方案与基线见 `docs/archive/媒体加载性能提升方案-2026-09.md`
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
- **AI 标签 / IQA / 视觉匹配 / JobRunner 收编**（Phase 9 M5-M6，T23-T25，2026-10-08）：
  - T23 AI 标签 + 质量分：数据库迁移 v4（`tags.source` manual/ai 词表 + `image_tags.confidence`）；零模型启发式 IQA `quality-scorer.ts`（`heuristic-v1`，分数落库不接筛选）；CLIP 零样本 `tag-suggester.ts`（本库已有标签 ∪ 内置约 40 英文类，阈值 0.15）；标签走提案「人在回路」（采纳才落库），新建 `AiLabelPanel` 管理 UI（预览/采纳/忽略/移除 AI 标签，首次启用作业进度事件流订阅）；新增 IPC：`triggerAiTagging` / `triggerAiQuality` / `listTagSuggestions` / `adoptTagSuggestion` / `dismissTagSuggestion` / `removeAiTag`
  - T24 视觉匹配升级：`RecommendScorer` 可选 `getVisualSimilarity` provider（权重 0.25，缺省与 T16 完全等价）；`runVisualSimilarity` 图像-图像 int8 余弦（仅本地媒体出信号、纯远端 URL 不打分期拉网络，只读 vectors.db 含 §9.7 跨模型拦截，异常静默回退纯规则分）；`ai.enabled` 条下 `agent-handlers` 动态注入
  - T25 JobRunner 收编（D-3：仅 phash+export，scanner 不动）：pHash 回填删全局单槽改库级作业（项级持久化可断点续跑，失败不再写空串污染 phash，保留 `phashProgress` 兼容事件名）；批量导出改 `export.batch` 复合作业（入队即返不阻塞 IPC，台账可观察/可取消，内存参数表重启不承诺续跑；单张导出保持交互式直连，`export-progress` 与 ExportDialog 零改动）
  - 门禁：tsc 0 错，全量 807 passed / 2 skipped（新增 T23/T24/T25 单测 56 例，旧测不改即绿）
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
