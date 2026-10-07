# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📦 项目概述

一个专为**大量高清写真图片和多媒体文件**（视频/音频）设计的本地图片查看器，基于 Electron + React + TypeScript。
支持通过 `media://` 自定义协议流式加载大媒体文件（令牌映射机制）。

## 🔧 开发命令

```bash
conda activate imageviewer  # 激活 Conda 环境（Node.js、Python 运行时依赖）
npm install            # 安装依赖
npm run dev            # 开发模式（自动打开 DevTools）
npm run build          # 构建前端 + Electron 打包
npm run build:dir      # 仅构建前端（不打包）
npm run preview        # 预览构建结果
npm run test           # vitest watch 模式
npm run test:run       # vitest 全量单次运行（当前基线 49 files / 552 tests）
npm run test:coverage  # 覆盖率报告
npx tsc --noEmit       # 类型检查（交付门禁：0 错误）
```

> **注意**：所有 `npm` 命令执行前，必须先激活 `imageviewer` Conda 环境，否则 Node.js / Python 版本可能不匹配。

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────┐
│           UI 层 (React 19)                       │
│  Tailwind CSS v4 + Liquid Glass                 │
│  shadcn/ui (Radix UI) 组件                      │
│  Motion (Framer Motion) 动画                     │
│  Lucide React 图标                              │
│  Geist Sans + Geist Mono 字体                   │
│  FolderTree │ ImageGrid (虚拟滚动)              │
│  ImageViewer (缩放/旋转/翻转/幻灯片/视频播放)   │
├─────────────────────────────────────────────────┤
│         状态管理 (Zustand)                       │
│  imageStore (核心) | audioStore | historyStore   │
│  searchStore | tagStore | themeStore |           │
│  selectionStore | viewStore | slideshowStore |   │
│  similarStore                                    │
├─────────────────────────────────────────────────┤
│         Agent 层 (Phase 9)                       │
│  PreferenceProfiler | DecisionRegistry           │
│  LocalRulesProvider | ProposalStore              │
│  FeedbackAggregator | AgentScheduler             │
│  RecommendScorer（采集 Agent 打分→提案闭环）     │
├─────────────────────────────────────────────────┤
│    插件宿主 (utilityProcess + MessagePort RPC)   │
│  PluginManager | PluginLoader | JobRunner        │
│  ModelManager | MemoryMonitor | EditsService     │
│  builtins: autotone / jev-decision /             │
│  rule-engine-adapter / bili-web / xhs-web /      │
│  tg-mtproto / tg-export-import                   │
├─────────────────────────────────────────────────┤
│         采集层 (crawler/)                        │
│  CrawlerService | RequestExecutor（per-host 闸门）│
│  BrowserSession（隐藏窗口） | Downloader |       │
│  Intake（url_hash→file_hash→pHash 三级去重）     │
├─────────────────────────────────────────────────┤
│         IPC 通信 (src/main/ipc/*-handlers.ts)    │
│  library | file | search | tag | job | plugin    │
│  agent（通道纯命名无前缀，如 getLibraries、      │
│  triggerCrawlDiscovery）                         │
│  getMediaUrl (media:// token, 统一用于图片/视频/音频) │
├─────────────────────────────────────────────────┤
│           数据层                                  │
│  MasterDB (master.db) - 库/收藏/标签/历史        │
│  ThumbnailsDB (thumbs.db) - 图片元数据/缩略图    │
│  迁移 v2: jobs/job_items/edits                   │
│  迁移 v3: preference_profile/proposals/          │
│           feedback_log/crawl_sources/crawl_items │
│  位置：%APPDATA%\luuk\master.db + {库}\.ivlib\  │
└─────────────────────────────────────────────────┘
```

## 📁 核心目录结构

```
e:\luuk\
├── electron/                   # Electron 主进程
│   ├── main.ts                 # 主入口，窗口创建，IPC 注册，media:// 协议
│   ├── preload.ts              # 预加载脚本，暴露 electronAPI
│   └── plugin-worker.ts        # 插件宿主进程（utilityProcess 入口，启动时静态登记内置插件 activator）
├── src/
│   ├── main/                   # 后端服务（注意：主进程入口在 electron/，此处是被 import 的服务层）
│   │   ├── services/
│   │   │   ├── database.ts      # MasterDB + ThumbnailsDB + 迁移 v1-v3
│   │   │   ├── image-service.ts # 统一服务接口（单例）
│   │   │   ├── scanner.ts       # 库扫描 + 增量更新（排除 _downloads/_edits）
│   │   │   ├── thumbnailer.ts   # 缩略图生成 (Sharp)
│   │   │   ├── media-registry.ts # media:// 协议令牌注册表
│   │   │   ├── cache.ts         # LRU 内存缓存 (200MB)
│   │   │   ├── file-service.ts  # 文件操作（复制/移动/重命名/删除/壁纸 + 路径级联）
│   │   │   ├── export-service.ts # 流式 ZIP 导出 (archiver)
│   │   │   ├── settings-service.ts # electron-store 配置持久化（feature flags/Agent 设置）
│   │   │   ├── library-monitor.ts # 离线库检测
│   │   │   ├── plugin-manager.ts # 插件系统统一入口（发现/加载/生命周期/executeOp）
│   │   │   ├── job-runner.ts    # 后台作业调度（持久化/断点续跑/优先级）
│   │   │   ├── model-manager.ts # 模型注册与 SHA256 完整性校验
│   │   │   ├── memory-monitor.ts # 三级内存水位线
│   │   │   ├── edits-service.ts # 编辑版本链（非破坏性编辑输出）
│   │   │   ├── agent/           # Phase 9 Agent 基座
│   │   │   │   ├── preference-profiler.ts  # 偏好画像（冷启动加权+增量重算）
│   │   │   │   ├── proposal-store.ts       # 提案状态机（pending→accepted/skipped/rejected）
│   │   │   │   ├── feedback-aggregator.ts  # 反馈强化（+0.1/-0.02/-0.2，排除项晋级）
│   │   │   │   ├── agent-scheduler.ts      # 调度循环（复用 JobRunner，定时/手动/新来源三触发）
│   │   │   │   ├── recommend-scorer.ts     # 采集候选打分→提案生成
│   │   │   │   └── decision/              # 决策层（DecisionProvider 体系）
│   │   │   │       ├── decision-registry.ts        # provider 注册 + 置信度门控升级链
│   │   │   │       ├── local-rules-provider.ts     # 本地规则（choice/score/noul）
│   │   │   │       ├── plugin-decision-adapter.ts  # Jev 插件适配层
│   │   │   │       ├── jev-bootstrap.ts            # 纯 DI 装配（可单测，不 import electron）
│   │   │   │       └── privacy-guard.ts            # 出站文本元数据白名单过滤
│   │   │   └── crawler/           # Phase 9 M3 采集层
│   │   │       ├── crawler-service.ts      # 宿主编排（web 主道 + pc-app 例外）
│   │   │       ├── crawler-bootstrap.ts    # 纯 DI 装配（crawler.enabled 双闸）
│   │   │       ├── request-executor.ts     # per-host 闸门 + 频控退让
│   │   │       ├── browser-session.ts      # 隐藏窗口（navigate+pageHint / inPageFetch）
│   │   │       ├── robots.ts               # 爬虫协议合规
│   │   │       ├── downloader.ts           # 流式下载（.part 原子落盘/Range 续传/SHA256）
│   │   │       ├── intake.ts               # 三级去重 + 落地入库 + sidecar
│   │   │       ├── source-store.ts         # 信息源 CRUD
│   │   │       └── crawl-item-store.ts     # 采集团条目存储
│   │   ├── plugins/
│   │   │   ├── plugin-loader.ts    # 插件清单解析 + 生命周期（kind 白名单校验）
│   │   │   ├── plugin-registry.ts  # Worker 侧双路径登记（内置静态/第三方动态 import）
│   │   │   ├── plugin-host-process.ts # 宿主侧 RPC 封装
│   │   │   └── builtins/           # 内置插件（autotone/jev-decision/rule-engine-adapter/bili-web/xhs-web/tg-mtproto/tg-export-import）
│   │   └── ipc/
│   │       ├── library-handlers.ts # 库/图片/收藏/历史/缩略图
│   │       ├── file-handlers.ts    # 文件操作
│   │       ├── search-handlers.ts  # 高级搜索/相似图
│   │       ├── tag-handlers.ts     # 标签/统计/EXIF
│   │       ├── job-handlers.ts     # 后台作业
│   │       ├── plugin-handlers.ts  # 插件管理
│   │       └── agent-handlers.ts   # Agent/爬虫/Jev 开关（生产接线层）
│   ├── components/             # React 组件
│   │   ├── ImageViewer.tsx / ImageLightbox.tsx  # 查看器（图片/GIF/视频）
│   │   ├── ImageGrid.tsx / ImageGridItem.tsx / MasonryGrid.tsx  # 网格/瀑布流
│   │   ├── AudioViewer.tsx / AudioPlayer.tsx / AudioCard.tsx    # 音频链路
│   │   ├── SearchPanel.tsx / SimilarImagesPanel.tsx / TagCloudPanel.tsx / StatsPanel.tsx
│   │   ├── CompareViewer.tsx / HistogramChart.tsx / CachePanel.tsx / SettingsPanel.tsx
│   │   ├── PlaylistEditor.tsx / SlideshowAudio.tsx / RatingStars.tsx
│   │   ├── FolderTree.tsx / SortControl.tsx / RecentHistory.tsx / ScanProgress.tsx
│   │   ├── file-ops/           # 回收站/批量重命名等文件操作对话框
│   │   ├── ui/ + layout/ + library/ + hooks/  # shadcn 基础件/布局/逻辑 hook
│   ├── stores/                 # Zustand 状态管理
│   │   ├── imageStore.ts       # 核心 store（库/图片/收藏/文件夹树）
│   │   ├── audioStore.ts / historyStore.ts / searchStore.ts / tagStore.ts
│   │   ├── themeStore.ts / selectionStore.ts / viewStore.ts
│   │   ├── slideshowStore.ts / similarStore.ts
│   │   └── index.ts            # 统一导出
│   ├── types/
│   │   ├── index.ts            # 类型定义 + electronAPI 接口声明
│   │   ├── agent.ts            # Agent 类型（PreferenceProfile/Proposal/DecisionProvider/CrawlProvenance）
│   │   └── plugin.ts           # 插件类型（PluginKind/JobManifest/爬虫连接器契约 RequestPlan/CandidateDraft）
│   ├── utils/                  # 前端工具（sort/media/format/exif/compare-transform 等）
│   ├── __tests__/              # 工具层单测
│   ├── global.d.ts             # 全局类型声明
│   └── index.css               # 全局样式 (Tailwind v4 + Liquid Glass + shadcn/ui)
├── scripts/                    # 性能基准（bench-scan/bench-hash-window）/CDP 验证/测试数据生成
├── tests/                      # Playwright E2E（tests/playwright/ + playwright.config.ts）
├── docs/                       # 文档（roadmap/plans/reference/guides/archive，索引见 docs/README.md）
├── dist/                       # Vite 构建输出
├── dist-electron/              # Electron 构建输出
└── release/                    # 安装包输出
```

## 🔑 关键设计

### 前端技术栈
- **样式方案**：Tailwind CSS v4 + Liquid Glass（`@theme` 统一管理设计 token，三级玻璃深度 `glass-l1/l2/l3`）
- **组件库**：shadcn/ui (基于 Radix UI 的无头组件)
- **动画库**：Motion (Framer Motion)，核心交互动画（FolderTree 展开/折叠、ImageViewer 信息面板、按钮微交互）
- **图标库**：Lucide React（替换所有手写 SVG）
- **字体**：Geist Sans + Geist Mono（通过 `@fontsource-variable` 引入可变字体）
- **残留 CSS**：仅保留 `src/components/ImageLightbox.css`（YARL 查看器覆盖样式）和 `src/index.css`（Tailwind + 全局自定义样式）

### 多媒体支持
- **统一加载**：所有媒体类型（图片/视频/音频）统一使用 `getMediaUrl` IPC 返回 `media://TOKEN` URL，避免 base64 全量加载导致 OOM
- **流式协议**：`media://` 自定义协议在 `app.whenReady()` 之前通过 `protocol.registerSchemesAsPrivileged` 注册为 standard/secure/supportFetchAPI。协议处理器使用 `fs.promises` 直读文件，支持 HTTP Range 请求。URL 中的令牌为纯小写 hex，不受浏览器 authority 小写化影响
- **媒体类型判断**：`getMediaTypeFromPath()` 基于文件扩展名判断（比数据库更可靠）
- **安全检查**：IPC 处理器限制访问范围在已注册库路径内
- **数据库路径清理**：`mapLibrary` 中使用 `.trim().replace(/\r/g, '')` 清理库路径中的不可见字符

### 数据库架构
- **master.db**: 主数据库，存储所有库信息、收藏、标签、浏览历史、作业（jobs/job_items/edits）、Agent 体系（preference_profile/proposals/feedback_log/crawl_sources/crawl_items）
- **thumbs.db**: 每个库独立的分库，存储图片元数据、缩略图缓存（WebP 格式）
- 库路径使用 `.ivlib` 隐藏目录存储数据库文件
- 迁移只增不改：已发布迁移的主 SQL 禁止修改，补列一律用 `tolerant`（duplicate column 容忍）机制

### 插件系统（Phase 8）
- **宿主分离**：插件跑在 `utilityProcess`（`electron/plugin-worker.ts`）内，经 MessagePort RPC 与主进程通信；崩溃隔离、可强制终止
- **PluginKind**：`ai-model` / `crawler-adapter` / `decision-provider` 等，`plugin-loader.ts` 维护 kind 白名单，新增类型须同步 `src/types/plugin.ts` 的 `VALID_PLUGIN_KINDS` 与白名单
- **内置插件装载契约（M2 确立）**：内置插件由 `plugin-worker.ts` 启动时 `registerBuiltinPlugin(id, activate)` 静态登记（随宿主打包，运行时无独立可 import 产物）；第三方插件按清单 entry 动态 import；约定入口导出 `activate(): Record<opId, handler>`
- **内置插件清单 `entry` 必须写磁盘真实存在的文件名**（如 `index.ts`），否则 PluginLoader 存在性校验判 invalid
- **JobRunner**：持久化作业（jobs/job_items 表）+ 断点续跑 + 优先级；Agent 发现作业复用其调度（`job_items.imageId` 约定=sourceId）
- **Feature Flags**：`plugins.enabled` / `ai.enabled` / `crawler.enabled` / `agent.enabled` / `jev.enabled` 默认全部关闭；关闭时零对象构造零网络

### Agent 体系（Phase 9）
- **不是 LLM Agent**：本地规则 + 统计学习 + 可选 Jev 判断的推荐/决策引擎；所有判断统一走 `DecisionProvider` 接口，经 `DecisionRegistry` 置信度门控升级链（回落语义：**链尾优先**）
- **人在回路**：Agent 只产生 `Proposal`（pending），用户在 UI 确认/跳过/拒绝后才触发下载入库；反馈经 `FeedbackAggregator` 强化画像（+0.1/-0.02/-0.2）
- **画像学习闭环**：`PreferenceProfile.learnedDeltas` 与统计基权重叠加不覆盖；脏检查用**水位线**（`source_watermark`，同时钟域秒级串比较）；不得绕过 `profiler.getProfile()` 直读写画像
- **隐私护栏**：Jev 为可选增强默认关闭，`privacy-guard.ts` 在出站前按文本元数据白名单逐个字段过滤并留痕；API Key 经 IPC 只回 `hasKey`，明文不下渲染进程
- **生产接线分层**：装配层（`jev-bootstrap.ts`/`crawler-bootstrap.ts`）纯 DI 可单测、不 import electron；electron 依赖（net/session/ipcMain）集中在 `src/main/ipc/agent-handlers.ts`

### 采集层（Phase 9 M3）
- **连接器二分**：`web-http`/`web-browser`（网站，主道）与 `pc-app`（D10 例外，如 MTProto/本地导入）；`app-bridge` 仅类型占位
- **适配器契约**：`adapter.buildRequests`/`adapter.parseResponse` 为纯函数禁网络（Telegram pc-app 例外）；媒体字节绝不进 RPC
- **三级去重**：url_hash → file_hash → pHash；sidecar（`CrawlProvenance`）随文件迁移仍存在；`file://` 前缀承载 pc-app 本地产物免下载入库
- **合规红线**：per-host 闸门 + 频控退让 + robots 检查；禁止 App 抓包/解签名（小红书走网页版 `inPageFetch` 零逆向）
- **默认全关双闸**：调度侧看 `agent.enabled`，执行侧看 `crawler.enabled`，任一关闭都不出流；`@mtcute/node` 未安装，TgClient 接口注入 + 工厂位，未注入时 discover 明确拒跑

### 索引与语义搜索（Phase 9 M5）
- **C1 零原生加载**：`ai-handlers.ts` 被 `main.ts` 静态引入，**绝不同态** import `ai-wiring`/`usearch`/`onnxruntime-node`；仅 `ai.enabled` 时经 `loadAiModules()` 动态载入。关闭态启动零 usearch/零 ort/零模型/零网络
- **R2 会话分时**：索引与查询各自 `load→工作→unload`；`OnnxClipEngine`/`OnnxClipTextEncoder` 顶层零原生依赖（ort 全在方法内 `await import()`），C2 用 in-flight Promise 去重并发 `load()`
- **查询/索引互斥铁律**：`runSemanticQuery` 对目标库 ANN **只 load 不夺卸载所有权**——空闲 TTL(60s)/自加载卸载前必判 `!librarySessions.has(libId)`，绝不把正在写入的共享单例挤出；文本编码会话独立引用计数归零才 unload
- **模型绑定（§9.7）**：文本塔与图像塔同 checkpoint（Xenova/clip-vit-base-patch32）→ 同 512 维投影空间；检索空间键始终是图像 `model_id`（`clip-vit-b32-int8`），文本塔 id 仅资产标识
- **分词器**：`clip-tokenizer.ts` 纯 JS byte-level BPE，正确性以 transformers.js 黄金 fixture 逐位对齐为准（HF 截断=后处理后按 77 保头截断，超长尾 EOT 被切）；此 CLIP 变体 `pre_tokenizer` invert 丢弃空白 → 词无空格前缀、无 `Ġ` token
- **开发期资产口径**：模型/tokenizer 直连 `cache/poc-r2`（gitignore），`verifyModel(..., {deleteOnMismatch:false})` 只读校验避免误删唯一本地副本；生产打包/下载不在 M5 范围

### 缩略图缓存链路
```
内存 LRU 缓存 (200MB) → thumbs.db 数据库缓存 → 原图实时生成 (Sharp)
```
扫描阶段预生成：`scanner.ts` 在扫描完成后自动批量生成缩略图并存入数据库，避免首次打开时实时生成的延迟
缓存 Key 格式：`${libraryId}-${imageId}`，确保跨库隔离

### 文件夹树实现
- 使用路径分隔符 `/` 统一存储（兼容 Windows/Unix）
- 递归构建：从图片相对路径提取文件夹层级
- 支持展开/折叠，点击筛选图片

### 收藏系统
- 虚拟收藏库 ID: `FAVORITE_LIBRARY_ID = -1`
- 单图收藏：单独标记的图片
- 文件夹收藏：整个文件夹标记为收藏
- 收藏数据存储在 master.db，图片详情从原库获取

### 收藏视图模式
- `favoriteViewMode: 'folder' | 'single'`
- **文件夹收藏模式** (`'folder'`): 显示收藏文件夹树和其中的图片
- **单图收藏模式** (`'single'`): 显示不属于任何收藏文件夹的单图收藏
- 视图切换时会自动重置索引为 0，并清除选中的文件夹状态
- 查看器中按 `F` 键收藏图片后，会自动切换到单图收藏视图模式

## 📝 开发注意事项

1. **Electron 下载**: 使用镜像源（项目已配置 `.npmrc`）
2. **路径处理**: 使用 `path.normalize()` 处理跨平台路径
3. **IPC 通信**: 前端通过 `window.electronAPI` 调用后端功能；通道命名采用**纯命名无前缀**风格（如 `getLibraries`、`triggerCrawlDiscovery`）
4. **状态管理**: `imageStore.ts` 是核心 store，其余按职责拆分（见目录结构），新增状态优先建独立 store 而非塞进 imageStore
5. **虚拟滚动**: 使用 `@tanstack/react-virtual`，只渲染可见区域
6. **数据库清理**: 应用退出时调用 `closeAllDatabases()` 释放资源
7. **自定义协议**: `media://` 在 `app.whenReady()` 之前通过 `protocol.registerSchemesAsPrivileged` 注册。URL 中的路径编码采用令牌映射（`src/main/services/media-registry.ts`），避免浏览器对 URL authority 强制小写化破坏编码
8. **Native 模块**: 使用 `electron-rebuild` 重建 better-sqlite3 和 sharp 等原生模块
9. **媒体类型**: 优先使用文件扩展名判断（`getMediaTypeFromPath`），数据库中 `media_type` 可能不准确
10. **样式开发**: 项目已全面迁移到 Tailwind CSS v4 + shadcn/ui，禁止新建 `.css` / `.module.css` 文件（ImageLightbox.css 除外）。设计 token 通过 `@theme` 块在 `src/index.css` 中统一定义
11. **ESM-only 依赖**: `trash` / `wallpaper` / `electron-store` 等为 ESM-only，需命名导入并加入 Vite 构建 externals（`vite.config.ts`）
12. **排序白名单**: 排序字段在三处联合类型须同步修改（types、store、后端校验）
13. **vitest 动态 import 限制**: jsdom/vm runner 无法对绝对路径文件执行原生 dynamic import，插件类单测需用项目根目录内的 fixtures
14. **交付门禁**: `npx tsc --noEmit` 零错误 + 全量 vitest 通过（当前基线 552 用例）；涉及网络的模块（crawler/jev）单测必须零真实网络

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `←/→` | 上一张/下一张 |
| `Home/End` | 第一张/最后一张 |
| `0` | 适应窗口 |
| `1` | 实际大小 |
| `R` | 重置缩放/旋转/翻转 |
| `H/V` | 水平/垂直翻转 |
| `I` | 显示图片信息 |
| `F` | 收藏/取消收藏 |
| `Esc` | 关闭查看器 |
| `Space` | 幻灯片播放 |
| `F5` | 切换视图模式 |
| `F6` | 切换文件夹侧边栏 |
| `F11` | 全屏沉浸式模式 |
