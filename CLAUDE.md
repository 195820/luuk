# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📦 项目概述

一个专为**大量高清写真图片和多媒体文件**（视频/音频）设计的本地查看器，基于 Electron + React + TypeScript。支持通过 `media://` 自定义协议（HMAC 确定性令牌 + 流式响应 + HTTP 缓存）加载大媒体文件，并内置 **Phase 8 AI 插件系统**（超分/抠图/自动色调，ONNX 本地推理 + 后台作业）。

功能主线（Phase 1-8）已全部交付；当前状态与遗留项以 [docs/roadmap.md](docs/roadmap.md) 为准，变更历史以 [CHANGELOG.md](CHANGELOG.md) 为准。

## 🔧 开发命令

```bash
conda activate imageviewer  # 激活 Conda 环境（Node.js、Python 运行时依赖）
npm install            # 安装依赖
npm run dev            # Vite 开发服务器（自动开 DevTools；设 NO_AUTO_DEVTOOLS=1 禁用）
npm run test           # Vitest watch
npm run test:run       # Vitest 单次运行（当前基线：43 文件 / 393 用例全绿）
npm run test:coverage  # 覆盖率报告
npm run build:builtins # 仅编译内置插件（predev/build 会自动执行）
npm run build          # tsc --noEmit → vite build → build:builtins → electron-builder（nsis 安装包）
npm run build:dir      # 同上但 electron-builder --dir（win-unpacked，不产安装包，调试用）
npm run preview        # 预览构建结果
```

> **注意**：所有 `npm` 命令执行前，必须先激活 `imageviewer` Conda 环境，否则 Node.js / Python 版本可能不匹配。
> 提交前必过 `npx tsc --noEmit` + `npm run test:run`。

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────┐
│  UI 层 (React 19 + Tailwind v4 + shadcn/ui     │
│  + Liquid Glass)：网格/瀑布流/查看器/对比/搜索  │
│  /标签/统计/直方图/导出/幻灯片/设置三 Tab        │
├─────────────────────────────────────────────────┤
│  状态管理 (Zustand，11 个 store)：imageStore    │
│  (核心) + selection/view/tag/search/history/    │
│  similar/slideshow/theme/plugin/audio           │
├─────────────────────────────────────────────────┤
│  IPC 层（src/main/ipc/ 7 个 handler 文件）      │
│  library │ file │ search │ tag │ settings │     │
│  job │ plugin                                   │
├─────────────────────────────────────────────────┤
│  media:// 协议层（electron/main.ts）            │
│  HMAC 确定性 token │ file/thumb 双 kind │      │
│  流式 + Range + ETag/304 + Cache-Control        │
├─────────────────────────────────────────────────┤
│  AI 插件子系统（Phase 8，懒启动，默认关闭）     │
│  PluginManager ↔ utilityProcess Worker          │
│  （MessagePort 双向 RPC / luuk.* SDK /          │
│   InferencePool / JobRunner / ModelManager）    │
├─────────────────────────────────────────────────┤
│  数据层：MasterDB（库/收藏/标签/历史/jobs/edits │
│  /folder_covers…）+ 分库 thumbs.db（元数据/     │
│  WebP 缩略图/pHash）+ LRU 200MB + sharp         │
└─────────────────────────────────────────────────┘
```

详细架构参考 [docs/reference/架构设计.md](docs/reference/架构设计.md)。

## 📁 核心目录结构

```
D:\luuk\
├── electron/                   # Electron 进程入口
│   ├── main.ts                 # 主进程：窗口、IPC 注册、media:// 协议（流式/Range/ETag）、关机编排
│   ├── preload.ts              # 暴露 window.electronAPI（含 plugins/jobs/models/settings）
│   └── plugin-worker.ts        # 插件 utilityProcess Worker（SDK 代理 + RPC）
├── src/
│   ├── main/                   # 主进程后端（非渲染代码）
│   │   ├── ipc/                # 7 个 handler：library/file/search/tag/settings/job/plugin
│   │   ├── services/           # 15 个服务：database、image-service、scanner、thumbnailer、
│   │   │                       #   cache、media-registry、file-service、export-service、
│   │   │                       #   settings-service、library-monitor、plugin-manager、
│   │   │                       #   job-runner、memory-monitor、model-manager、edits-service
│   │   ├── plugins/            # 插件子系统：plugin-loader、plugin-host-process、
│   │   │   │                   #   plugin-sdk-host、worker-sdk、inference-pool
│   │   │   └── builtins/       # 内置插件：autotone / matting / upscale（后处理抽 post.ts 纯函数）
│   │   └── utils/              # exif、histogram、phash、media、path-safe
│   ├── components/             # React 组件
│   │   ├── ImageGrid / ImageGridItem / MasonryGrid   # 网格（虚拟滚动+多选）/ 瀑布流（窗口化）
│   │   ├── ImageViewer / ImageLightbox / CompareViewer  # 查看器（YARL，preview 渐进）/ 对比
│   │   ├── AudioViewer / AudioPlayer / AudioCard / SlideshowAudio / PlaylistEditor
│   │   ├── SearchPanel / TagCloudPanel / SimilarImagesPanel / StatsPanel / HistogramChart
│   │   ├── SettingsPanel（主题/插件/模型三 Tab）/ CachePanel / JobProgressBar
│   │   ├── FolderTree / RecentHistory / ScanProgress / MediaFilter / SortControl / RatingStars / TagDialog
│   │   ├── file-ops/           # FileContextMenu、BatchRenameDialog、ExportDialog、
│   │   │                       #   RecycleBinView、PluginSettings、ModelSettings
│   │   ├── layout/SlideshowBar │ ui/（shadcn 基础件）│ hooks/useDebugLog
│   │   └── App.tsx             # 应用壳：头部/侧栏/布局/全局快捷键（无独立 AppHeader 等）
│   ├── hooks/useAdjacentPreload.ts   # 方向感知 ±3 预加载 + 视频首 1MB Range 预热
│   ├── stores/                 # 12 个 Zustand store（见架构图）
│   ├── utils/                  # 渲染端工具：sort/group/media/format/compare-transform/highlight
│   ├── types/                  # index.ts（Domain 类型）+ plugin.ts（插件 SDK 契约）
│   └── index.css               # Tailwind v4 @theme 设计 token + Liquid Glass
├── scripts/                    # build-builtins.mjs（esbuild 编译内置插件 + 产物断言）、
│                               #   bench-scan / bench-hash-window / bench-media-memory、
│                               #   cdp-verify-*（CDP 真机验证）、generate-test-data、
│                               #   ensure-test-native（vitest 原生模块 ABI）、smoke-archiver
├── tests/playwright/           # Playwright E2E（连 CDP 9222）
├── test-library/               # 生成式测试图库（set01~set10，每库 .ivlib/thumbs.db）
├── docs/                       # 文档中心（索引见 docs/README.md；plans/ 存活跃计划，历史过程稿见 archive/）
├── dist/ · dist-electron/ · release/   # 构建输出（dist-electron/plugins/builtins 为插件产物）
└── .qoder/                     # IDE 缓存目录（不受 git 跟踪）；原过程稿已并入 docs/archive/
```

## 🔑 关键设计

### 媒体加载链路（media://，2026-09 性能改造）
- **统一 URL 通道**：图片/视频/音频/缩略图/preview 全部走 `media://TOKEN`，不再有 base64/data URL；`getThumbnail(s)` 返回 URL 字符串（无缩略图返回 **空串 `''`** 且不注册 token——前端占位判定依赖此 falsy 契约）；`loadFullImage` 已下线
- **确定性令牌**（`media-registry.ts`）：`HMAC-SHA1(sessionSecret, 资源标识)` 前 32 位 hex，密钥每次启动随机 → 同会话内同一资源同一 URL（命中 HTTP 缓存），对外不可预测；条目 `kind: 'file' | 'thumb'`，访问驱动 LRU，容量 50000 / TTL 2h
- **协议响应**（`main.ts`）：特权含 `stream: true`；file 分支 `createReadStream → Readable.toWeb()` 流式 + `ETag`/304 + Range（含 suffix）→ 206，200 手动带 `Content-Length`；thumb 分支 `Cache-Control: immutable`；错误拆分 404/500
- **缩略图三级缓存**：内存 LRU（值统一 `Uint8Array`，默认 200MB 可调 100-1000）→ thumbs.db（WebP BLOB，含 `preview` 1200px 档）→ sharp 实时生成（`sharp.concurrency` 限流核数-2；ffmpeg 并发信号量 ≤2）
- **Lightbox 渐进加载**：preview 图层先上屏，原图 `img.decode()` 预热后双图层交叉淡入（`src`/`key` 不变，避免 YARL 子树重挂载）
- 媒体类型判断一律以 `getMediaTypeFromPath()`（扩展名）为准，数据库 `media_type` 可能不准确

### AI 插件子系统（Phase 8）
- **进程模型**：主进程 `PluginManager` 装配一切；插件跑在 `utilityProcess` Worker，MessagePort 双向 RPC（`channel` 分域、requestId 命名空间隔离）；崩溃熔断 `MAX_CRASHES=3`，exit 监听带实例守卫、崩溃后自愈重载
- **SDK**：插件只允许用 `luuk.*`（`worker-sdk.ts` → `plugin-sdk-host.ts`），权限比对 `plugin.json` 的 `permissions[]`；每次调用显式携带自身 pluginId（禁止全局"当前插件"态，防并发串位）；`edit.write`/`fs` 强制 `assertWithinLibrary` 路径守卫
- **推理**：`InferencePool` 会话池——同名创建锁、交互式插队、EP 回退 CPU（**必须关 CPU mem-arena 保留内存，否则 4K 推理超 500MB 红线**）、LRU 驱逐、按插件销毁
- **内存闸门**：双口径——全应用聚合 RSS（yellow=1500/red=2500MB，可配置 `memory.*`）与 Worker RSS（`memory.workerRedMB` 默认 500）任一 red 即拒绝 executeOp；red 事件触发 `memory.evict`；阈值常量在 `plugin-manager.ts`
- **作业**：`JobRunner` 持久化 jobs/job_items（迁移 v2），优先级/暂停/取消/断点续跑（重启 running→paused）；收尾/取消/暂停三处统一 `pump()` 自泵。渲染层多选 >20 张走 `jobsEnqueue` 后台批处理，单项交互走 `pluginsExecute`；handler 必须收到解析好的绝对 `paths`，插件返回 `skipped:true` 归为 failed（杜绝假成功）
- **模型**：`ModelManager` 流式 SHA256 校验 + 断点续传 + `url→mirrorUrls` 回退；`verifyModel` 空 sha256 只校存在性**不删文件**；启动回填下载状态
- **内置插件**：autotone（零模型）、matting（u2netp）、upscale（RealESRGAN-x4plus 分块，输出像素预算 40M 上限）；后处理为 `post.ts` 纯函数（可单测）；TypeScript 源码经 `scripts/build-builtins.mjs`（esbuild）编译到 `dist-electron/plugins/builtins/<name>/index.js`，构建后有产物断言
- Feature flag `plugins.enabled` 默认 false，设置面板开启

### 数据与文件操作
- **双库**：`master.db`（`<userData>/data/`——dev 为 `%APPDATA%\image-viewer\`、安装包为 `%APPDATA%\Image Viewer\`，经 `app.getPath('userData')` 解析）存库注册/收藏/标签/历史/folder_covers/jobs/edits/deleted_files；每库 `.ivlib/thumbs.db` 存图片元数据 + WebP 缩略图 + pHash。`removeLibrary` 先清依赖行再删（FK）
- **文件操作**：复制/移动/重命名/删除走系统回收站（trash），操作后路径级联同步 master.db + thumbs.db，每步失败有逆向补偿；所有路径必须校验在已注册库根内
- **非破坏性编辑**：AI 编辑输出到库内 `_edits/` 版本链（edits 表），不改原图
- **扫描**：增量（大小+mtime 双条件跳过）、批量预载记录、后台非阻塞（`library-scan-finished` 广播）；pHash 回填驱动相似图查找

### 前端
- 样式：Tailwind CSS v4 + shadcn/ui (Radix) + Motion + Lucide，`@theme` 设计 token（`index.css`）；**禁止新建 `.css`/`.module.css`**（ImageLightbox.css 除外）
- 主题：`themeStore`（persist）同步写 `document.documentElement` 的 `data-theme`/密度 class + CSS 变量，深浅色/强调色/密度实时切换
- 虚拟滚动 `@tanstack/react-virtual`；瀑布流按视口窗口化渲染；缩略图 `<img decoding="async">` + 方向感知预热
- 快捷键统一在 `App.tsx`（捕获阶段监听，绕过 YARL stopPropagation）+ `ImageViewer.tsx` 局部

## 🧪 测试规范

- **单测**：Vitest，与被测文件同目录 `__tests__/`；当前基线 **43 文件 / 393 用例**（以实跑为准）；`npm run test:run` 必须全绿
- **better-sqlite3 ABI**：Electron 与系统 Node ABI 不同，vitest 通过 `scripts/ensure-test-native.mjs` + `vitest.config.ts` nativeBinding 解耦（勿回退）
- **真机验证**：`scripts/cdp-verify-*.mjs` 通过 Playwright `connectOverCDP` 连开发中 Electron（9222），不占用鼠标键盘；`npm run dev` 后用 `NO_AUTO_DEVTOOLS=1` 可免 DevTools 干扰
- **E2E**：`tests/playwright/`（配置 `tests/playwright.config.ts`）
- 性能基线：`scripts/bench-scan.mjs` / `bench-media-memory.mjs`；测试数据 `scripts/generate-test-data.cjs` → `test-library/`
- 新功能不得突破性能红线：启动 <3s、单插件 Worker 内存 <500MB、滚动 ≥30FPS

## 📝 开发注意事项

1. **路径处理**：Windows 路径注意 `.trim().replace(/\r/g,'')` 清理（库路径入库前）；比较路径统一分隔符 `/`
2. **IPC 返回值**：`Map` 经 IPC 序列化为空对象——批量接口返回 `Record`（如 `getThumbnails`）；`getImages` 直接返回数组
3. **media:// URL 规范化**：Chromium 会把 `media://TOKEN` 规范化为 `media://TOKEN/`，CDP/字符串匹配按 token 子串匹配
4. **URL authority 小写化**：令牌必须全小写 hex（HMAC hex 天然满足）
5. **sharp rotate**：无参 `.rotate()`（auto-orient）保留 JPEG shrink-on-load；带角度的 `.rotate(angle)` 会禁用，需重评估
6. **Native 模块**：better-sqlite3 / sharp / onnxruntime-node 经 `electron-rebuild`；`npmRebuild:false` + asarUnpack `.node`；Electron 下载用镜像源（`.npmrc`）
7. **退出编排**：`shutdownApp()` 顺序 stop→kill ffmpeg→pluginManager→jobRunner→关库，窗口关闭走 `destroy()`（有超时兜底），勿新增未清理的 `setInterval`
8. **数据库**：应用退出释放 `closeAllDatabases()`；批量写用 `db.transaction`（better-sqlite3 事务必须同步执行，异步生成→攒结果→同步提交两段式）
9. **插件开发**：manifest 声明 `permissions`/`contributes.menuItems`/`requires.models`（sha256 为 64 位 hex）；Worker 内禁止直接 require onnxruntime——推理必须走 `luuk.inference`（宿主集中管控内存是全部治理成立的前提）
10. **状态管理**：新跨页状态优先落独立 store 或扩展现有 store，勿再膨胀 imageStore；store 间引用用 `useXStore.getState()`

## ⌨️ 快捷键

| 快捷键 | 功能 | 快捷键 | 功能 |
|--------|------|--------|------|
| `←/→` | 上一张/下一张 | `0` / `1` | 适应窗口 / 实际大小 |
| `Home/End` | 第一张/最后一张 | `R` | 重置缩放/旋转/翻转 |
| `H` / `V` | 水平 / 垂直翻转 | `I` | 显示图片信息（EXIF/直方图） |
| `F` | 收藏/取消收藏 | `Esc` | 关闭查看器 |
| `Space` | 幻灯片播放 | `Ctrl+R` | 幻灯片顺序/随机切换 |
| `Ctrl+Space` | 音频播放/暂停 | `Ctrl+F` | 搜索面板开合 |
| `F5` | 切换视图模式 | `F6` | 切换文件夹侧边栏 |
| `F11` | 全屏沉浸式模式 | | |

（以 `src/App.tsx` / `src/components/ImageViewer.tsx` 实际绑定为准；`docs/README.md` 同步维护）

## 📚 文档索引

| 想了解 | 看哪里 |
|--------|--------|
| 项目现状 / 遗留项 / 进行中 | [docs/roadmap.md](docs/roadmap.md)（唯一任务规划来源）|
| 变更历史 | [CHANGELOG.md](CHANGELOG.md) |
| 详细架构（AI 插件/媒体链路/DB/服务） | [docs/reference/架构设计.md](docs/reference/架构设计.md) |
| 文档分层与归档规范 | [docs/README.md](docs/README.md) |
| Phase 8+ AI/爬虫方向设计（Phase 9-11） | [docs/plans/ai-crawler-direction-2026-q4.md](docs/plans/ai-crawler-direction-2026-q4.md) |
| 当前待办人工验证 | [docs/plans/Phase8人工验收清单](docs/plans/Phase8人工验收清单-2026-09-19.md) · [docs/plans/回归测试计划](docs/plans/回归测试计划-2026-09-13.md) |
| 媒体性能改造（已提交 `6df2c18`） | [docs/archive/媒体加载性能提升方案-2026-09.md](docs/archive/媒体加载性能提升方案-2026-09.md) |
| 用户指南 / 部署 / 排障 | [docs/guides/](docs/guides/) |

**文档纪律**：完成一个 Phase/方案后，回写 `roadmap.md` + `CHANGELOG.md`，实施计划移入 `docs/archive/`（`status: archived`）——本仓库曾因"实施快于文档"发生漂移，勿再犯。
