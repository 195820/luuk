---
title: 开发路线图
description: 项目功能优化与开发任务总览 — 优先级、进度、执行顺序、技术选型建议
type: roadmap
status: current
updated: 2026-09-19
---

# 开发路线图

> 本文档是项目唯一的任务规划来源,汇总原「功能优化路线图」（08）与「项目后续任务分析」（10），按优先级重新组织。
> 每项标注当前进度。进度为 **2026-08-30 对照代码核实**，非从旧文档照抄。

## 📊 进度图例

| 标记 | 含义 |
|------|------|
| ✅ | 已完成 |
| 🟡 | 部分完成（注明缺口） |
| ⬜ | 未开始 |

---

## 一、高优先级任务 (P0)

### 0. 多媒体支持（视频 + 音频 + 图片统一管理）✅ 已完成

- **实施**：2026-06-22 完成，包括 `media://` 令牌流式加载、wavesurfer.js 音频波形、YARL 图片 lightbox、组件分离（ImageLightbox/AudioViewer/AudioPlayer）、收藏媒体筛选。
- **记录**：方案与验收见 [archive/多媒体模块重构方案.md](archive/多媒体模块重构方案.md)、[archive/多媒体模块重构测试计划.md](archive/多媒体模块重构测试计划.md)。

### 1. 高级搜索面板 ✅

**实施**：2026-08-30 完成，Phase 2 Task 1-3 落地。

顶部搜索入口，多维度组合搜索：文件名模糊、尺寸范围、文件大小、格式、拍摄日期范围、收藏状态/评分/标签。

- **预计工时**：1 天
- **涉及文件**：`database.ts`（加搜索方法）、`search-handlers.ts`（新）、`SearchPanel.tsx`（新）、`searchStore.ts`（新）

### 2. 设置壁纸 ✅

**实施**：2026-08-30 完成，12 Task 全部落地，60/60 测试通过。

一键将当前图片设为桌面壁纸（合并入 #3 文件操作统一实现，不单独建 service）。

- **预计工时**：含在 #3 中
- **新增依赖**：`wallpaper` ^7+（ESM，命名导出 `setWallpaper()`）
- **涉及文件**：`file-service.ts`（`setWallpaper` 方法）、右键菜单、查看器工具栏
- **备注**：仅支持系统默认填充模式；填充/适应/拉伸三种模式暂缓（需额外图片预处理）

### 3. 图片文件操作 ✅

**实施**：2026-08-30 完成，12 Task 全部落地，60/60 测试通过。

应用内复制/移动/重命名/删除图片、在资源管理器中显示、设置壁纸。删除走系统回收站（软删除）。

- **预计工时**：5 天（12 个 Task：级联机制 + 补偿逻辑 + 多选 + 3 个对话框/视图 + 安全校验）
- **新增依赖**：`trash` ^8+（回收站）、`wallpaper` ^7+（壁纸）、`electron-store` ^11+（配置持久化）
- **涉及文件**：`file-service.ts`（新）、`file-handlers.ts`（新）、`settings-service.ts`（新）、网格/查看器右键菜单、ImageGrid 多选机制、RecycleBinView、BatchRenameDialog
- **关键设计**：
  - 多库架构：FileService 无状态，按 `libraryId` 动态解析库根路径和对应 `thumbs.db`
  - 路径级联：文件操作后同步更新 `master.db`（favorites/favorite_folders）和 `thumbs.db`（images.relative_path）
  - 补偿式一致性：物理操作 → thumbs.db → master.db，每步失败有逆向补偿
  - 路径安全：所有操作校验路径在已注册库范围内
  - 回收站：仅记录删除历史（只读视图），不支持恢复（trash 库限制）
- **实施计划**：见 [archive/superpowers/plans/2026-08-22-phase1-file-operations.md](archive/superpowers/plans/2026-08-22-phase1-file-operations.md)

### 4. 增量扫描优化 ✅

**实施**：2026-09-12 完成，Task 5.1 收尾。

进度（2026-09-12 全部完成）：

- ✅ **「文件大小 + 修改时间」双条件跳过**未变动文件 + **批量预载已有记录**（单次查询 → Map，替代逐文件查询）— `scanner.ts`
- ✅ **扫描日志增强**：扫描完成时输出统计信息（总计/新增/更新/跳过/删除）
- ✅ **性能基线脚本**：`scripts/bench-scan.mjs` 支持冷启动和增量扫描性能测试
- ⬜ **文件夹级增量检测**（只扫描变动的子文件夹）— **暂缓**：目录 mtime 无法反映子目录内文件的就地修改，整树跳过会漏报改动；需 watch/归档位机制才安全，暂不实现以免引入数据不一致

- **涉及文件**：`src/main/services/scanner.ts`、`scripts/bench-scan.mjs`

### 5. 浏览历史 ✅ 已完成

进度（2026-08-16 完成）：

- ✅ `history` 表 + `addHistory()`/`getHistory()`/`clearHistory()`（容量上限 500）
- ✅ IPC 暴露 + preload 接口 + `historyStore.ts` + 侧边栏「最近浏览」（缩略图列表、点击跳转原图、清空）
- ✅ 查看器播放/翻页时自动记录（连续重复自动跳过）

> 📌 **当前进度**：第一轮（浏览历史 + 评分 + 增量扫描）于 2026-08-16 完成。第二轮（文件操作）于 2026-08-30 完成。技术债清理插入阶段（Phase 1.5）于 2026-08-30 完成 — 归档/小修/测试/性能优化/Store 拆分。第三轮（搜索与发现 Phase 2）于 2026-08-31 完成 — 高级搜索/最近视图/智能分组/pHash 相似图查找，9 Task 共 99 测试通过。第四轮（标签/统计/EXIF Phase 3）于 2026-08-31 完成 — 独立标签系统/库统计面板/EXIF 查看器，8 Task 共 124 测试通过。第五轮（查看器体验强化 Phase 4）于 2026-08-31 完成 — 图片对比模式/全屏沉浸式/相邻图预加载/缓存管理 UI，7 Task 共 135 测试通过。第六轮（搜索增强 + 主题/直方图 Phase 5-6）于 2026-09-12 完成 — 离线库检测/搜索历史与预设/React 节点高亮/主题皮肤系统/图片直方图。第七轮（导出功能 Phase 7）于 2026-09-12 完成 — archiver 依赖引入/ExportService/流式 ZIP 导出/格式转换/进度反馈/ExportDialog UI/幻灯片增强（过渡动画/随机播放/自定义列表/背景音乐）。

---

## 二、近期任务 (P1)

| # | 功能 | 进度 | 预计工时 | 说明 |
|---|------|------|----------|------|
| 7 | 批量重命名工具 | ✅ | 含在 #3 中 | 命名模板 `{日期}_{序号}` + 逐个编辑，实时预览（无撤销） |
| 8 | 回收站功能 | ✅ | 含在 #3 中 | 软删除 + 回收站只读视图（不支持恢复/彻底删除，受 trash 库限制） |
| 9 | 最近添加/最近修改视图 | ✅ | 0.5 天 | 按索引时间 / 文件修改时间排序的虚拟文件夹（Phase 2 Task 4） |
| 10 | 智能图片分类 | ✅ | 1 天 | 按拍摄日期/尺寸/格式/纵横比自动分组（Phase 2 Task 5） |
| 11 | 图片预加载优化 | ✅ | 1 天 | 查看器相邻图预加载 + 按滚动速度动态调整（Phase 4 Task 4） |
| 12 | 评分系统 | ✅ | 1 天 | `RatingStars` 接入查看器工具栏；评分隐含收藏；收藏视图按评分排序 |
| 13 | 离线库自动检测 | ✅ | 0.5 天 | `fs.access` 定时探测（5 秒间隔），复用 `libraries.status` 字段，离线库 UI 置灰并禁用操作（Task 5.2） |

---

## 三、中期任务 (P2)

| # | 功能 | 预计工时 |
|---|------|----------|
| 14 | 图片对比模式（并排/滑块，同步缩放平移）✅ 自研受控变换 + 双 <img> 同步（Phase 4 Task 1-2） | 1.5 天 |
| 15 | EXIF 信息查看器（拍摄时间/相机参数/GPS）✅ exifreader 惰性解析，信息面板扩展（Phase 3 Task 7） | 1 天 |
| 16 | 库统计面板（总数/大小/格式分布/时间线）✅ recharts 可视化（Phase 3 Task 5-6） | 1 天 |
| 17 | 相似/重复图片查找（pHash）✅ 自研 DCT pHash + 后台回填 + 右键查找相似图片（Phase 2 Task 6-8） | 2 天 |
| 18 | 标签系统（编辑/筛选/标签云）✅ 独立 tags/image_tags 表、路径级联扩展、标签云筛选（Phase 3 Task 1-4） | 2 天 |
| 19 | 缓存管理 UI（占用统计/一键清理/上限设置）✅ 内存 + 磁盘统计、滑块调上限、清空按钮（Phase 4 Task 5-6） | 0.5 天 |
| 20 | 全屏沉浸式模式（F11，自动隐藏 UI）✅ F11 切换 + 主进程事件转发 + 隐藏 chrome（Phase 4 Task 3） | 0.5 天 |
| 25 | 主题/皮肤系统（深色浅色/强调色/密度）✅ themeStore + SettingsPanel + data-theme + CSS 变量（Phase 6 Task 6.1） | 1 天 |
| 26 | 幻灯片增强（过渡动画/随机播放/自定义列表）✅ slideshowStore + 过渡动画（fade/slide/zoom）+ 随机播放（Ctrl+R）+ 自定义播放列表 + 背景音乐（SlideshowAudio）+ PlaylistEditor（Phase 7 Task 7.1） | 1 天 |
| 27 | 文件夹封面设置 ✅ folder_covers 表 + 路径级联 + 右键菜单 + 封面缩略图（Phase 6 Task 6.3） | 1 天 |
| 28 | 图片直方图（RGB/亮度/可选显示）✅ calculateHistogram + HistogramChart + 查看器信息面板标签页（Phase 6 Task 6.2） | 1 天 |
| 29 | 基础导出功能（单图/批量 ZIP/格式转换）✅ ExportService + archiver 流式 ZIP + 进度反馈 + 取消支持 + ExportDialog UI（Phase 7 Task 7.0/7.2） | 2 天 |

---

## 四、远期任务 (P3)

| # | 功能 | 预计工时 |
|---|------|----------|
| 25 | 批量格式转换（JPG ↔ PNG ↔ WEBP） | 2 天 |
| 26 | 隐藏/加密文件夹 | 2 天 |
| 27 | 图片联系表/拼图生成 | 2 天 |
| 28 | 时间线视图 | 待评估 |
| 29 | 地图模式（EXIF GPS） | 待评估 |
| 30 | 键盘快捷键自定义 | 待评估 |
| 31 | 多显示器支持（副屏幻灯片） | 待评估 |

---

## 五、Phase 3 — AI / 爬虫（需确认）

> **方向已定案**：架构方向、插件宿主、数据模型草案与风险验证清单见 [plans/ai-crawler-direction-2026-q4.md](plans/ai-crawler-direction-2026-q4.md)（`status: current`）。**Phase 8 已于 2026-09-18/19 交付**（实施计划归档于 [archive/superpowers/plans/2026-09-13-phase8-ai-plugin-system.md](archive/superpowers/plans/2026-09-13-phase8-ai-plugin-system.md)，缺陷修复 M1-M5 见 CHANGELOG「修复」节，人工验收进行中：[plans/Phase8人工验收清单](plans/Phase8人工验收清单-2026-09-19.md)）。下表工时为旧估算，Phase 9-11 仍以该设计文档的分期路线为准，工时留待 `implementation-plan-2027-q1.md`。

| # | 功能 | 预计工时 |
|---|------|----------|
| 32 | AI 标签自动生成（CLIP 模型） | 3-5 天 |
| 33 | 人脸识别分组 | 5-7 天 |
| 34 | 智能筛选最佳照片（构图/清晰度/曝光评分） | 3-5 天 |
| 35a | **AI 修图 D1 轻量修复类**（超分/抠图/去水印/调色/老照片修复，单次前向，**本地 CPU 可行**） | Phase 8-10 |
| 35b | **AI 修图 D2 扩散生成类**（生图/图生图/局部重绘/扩图，迭代去噪，**本地 CPU 不可行**，走可替换 provider 插件） | Phase 11，**前置 R6+R8** |
| 36 | 图片爬虫模块（`SiteAdapter` = `crawler-adapter` 插件） | Phase 9 |
| — | **图集缺图补全**（AI × 爬虫交叉能力，#35 与 #36 的衍生项） | Phase 10 |
| 37 | 云同步（收藏/标签） | 待确认 |
| 38 | **插件系统 —— 已升级为 Phase 8 主轴**，承载 #32-#36 全部能力（AI 索引/修图/生图/补图/站点适配均以插件形态交付，核心不写死模型与站点） | Phase 8 |

---

## 六、特色功能建议

### 39. 智能收藏推荐

根据浏览行为（停留时间长、放大查看、反复回看）自动标记"可能喜欢"的图片，提供一键收藏入口。纯行为分析，无需 AI 模型。

- **预计工时**：1-2 天

### 40. 自定义相册

用户可创建多个相册（类似播放列表），跨文件夹、跨库把相关图片归入逻辑分组，支持自定义排序、拖拽调整顺序、封面设置。与收藏的区别：收藏是"我喜欢"（扁平聚合），相册是"同主题归档"（可排序可命名）。

- **预计工时**：2-3 天
- **数据库设计**：

```sql
CREATE TABLE albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cover_image_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE album_items (
    album_id INTEGER NOT NULL,
    library_id INTEGER NOT NULL,
    image_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (album_id, library_id, image_id),
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);
```

---

## 七、工程化任务

### 测试完善

- [ ] 归档测试方案中的待测试用例：执行记录模板已创建（`archive/文件操作阶段测试执行记录.md`），9 个用例待手动执行
- [x] `scripts/` 目录：`generate-test-data.cjs` 已创建
- [x] 补充自动化单元测试：69 用例（含多选逻辑 + 文件操作边界）

### 性能优化

| 优化点 | 现状 | 预期提升 |
|--------|------|----------|
| 并行扫描（每次 10 张批量处理） | ✅ 已实现 | — |
| Hash 优化（1MB → 64KB） | ✅ 已完成 | 减少 90% 读取量 |
| 数据库批处理事务 | 现有 | 待优化 |
| 路径索引优化 | 现有 | 待优化 |

---

## 八、技术选型建议（第三方库）

| 功能 | 推荐库 | 说明 |
|------|--------|------|
| EXIF 解析 | `exifreader` | 读取图片 EXIF 信息 |
| 感知 Hash | `imghash` | 计算图片 pHash |
| 壁纸设置 | `wallpaper` | 跨平台设置壁纸 |
| 地图显示 | `leaflet` | 显示 GPS 位置 |
| 图表统计 | `recharts` | React 图表库 |
| 文件删除（回收站） | `trash` | 删除走系统回收站 |
| 文件监听 | `chokidar` | 离线库检测 |

> 性能基准约束：任何功能不应显著影响启动（<3s）、内存 <500MB、滚动 FPS ≥30。

---

## 九、架构分析与技术债（2026-08-22 评估）

> 第一轮重构完成后的架构健康度评估，识别面向未来需求时的隐患。

### 架构亮点

- **media:// 令牌协议**：小写 hex 令牌映射 + fs.promises 流式直读 + HTTP Range 支持，解决大文件 OOM 和视频 seek
- **三级缩略图缓存**：内存 LRU(200MB) → thumbs.db → Sharp 实时生成，扫描时预生成，实测 4.56ms/张
- **分库设计**：每库独立 `.ivlib/thumbs.db`，适合多硬盘可插拔场景

### 架构隐患

| 隐患 | 影响 | 状态 |
|------|------|------|
| 收藏/历史以 `image_path` 字符串为主键 | 文件重命名/移动后引用失效 | ✅ 已解决 — 路径级联更新机制（Phase 1） |
| `imageStore` 已成巨石 store | 承载库/图片/收藏/文件夹树/视图/排序 | 🟡 已大幅拆分 — 现共 12 个 store（selection/view/tag/search/history/similar/slideshow/theme/plugin/audio 独立），imageStore 仍为核心但职责收窄，后续按需继续拆分 |
| 无配置持久化层 | 主题/缓存/快捷键无法保存 | ✅ 已解决 — `electron-store` 已引入（Phase 1） |
| `media-registry` 令牌为内存态 | 重启后失效，无法做分享/书签 | 维持「远期需求时再持久化」结论；2026-09 媒体改造后 token 同会话内确定（HMAC），但密钥进程级随机，重启仍失效 |
| 文件夹级增量扫描被暂缓 | 超大库全量扫描成本高（10万张约 7.6 分钟） | 需 watch/归档位机制，暂不实现 |
| AI 推理内存峰值可能越性能红线 | Worker 熔断/系统卡死 | ✅ Phase 8 M1-M5 已治理 — 水位线双闸门（聚合 yellow=1500/red=2500MB 可配置 + Worker RSS 硬闸门 500MB）、InferencePool LRU 驱逐、upscale 像素预算 40M 上限；常量见 `plugin-manager.ts` |

### 工程化欠账

- [x] `scripts/` 目录：`generate-test-data.cjs` 已创建
- [ ] 归档测试方案中 `TC-THUMB-004/005`、`TC-GRID-001~004`、`TC-PERF-001~003` 未执行（模板已建，待手动执行）
- [ ] 单元测试（60+ 用例）可持续扩充

### 性能红线

任何新功能不得突破以下约束（来自 requirements.md）：

- 启动时间 < 3s
- 内存占用 < 500MB（**Phase 8 实测口径**：此红线按单插件 Worker 进程衡量，`memory.workerRedMB` 默认 500；全应用聚合水位线 `memory.yellowMB`/`memory.redMB` 默认 1500/2500，均为可配置设置项，常量见 `src/main/services/plugin-manager.ts`）
- 滚动帧率 ≥ 30 FPS（2026-09 媒体性能改造的验收目标：滚动 P95 帧时间 <16.7ms，待人工实测确认）

---

## 十、推荐执行顺序

**第一轮 (1-2 周)**：~~多媒体模块重构~~（已完成）→ ~~浏览历史~~ → ~~评分接入~~ → ~~增量扫描~~（2026-08-16 全部完成）

**第二轮 (1 周)**：~~图片文件操作 + 批量重命名 + 回收站 + 设置壁纸~~（2026-08-30 完成）

**第三轮 (3-4 周)**：~~高级搜索 → 相似图片查找 → 最近添加/修改 → 智能分类~~（2026-08-30 完成，Phase 2 共 9 Task，99 测试通过）

**第四轮 (4-6 周)**：~~标签系统 → 库统计 → EXIF 查看器~~（2026-08-31 完成，Phase 3 共 8 Task，124 测试通过）

**第五轮 (4 天)**：~~对比模式 → 全屏沉浸 → 预加载 → 缓存管理~~（2026-08-31 完成，Phase 4 共 7 Task，135 测试通过）

**第六轮 (2 天)**：~~增量扫描优化 → 离线库检测 → 搜索增强 → 主题/皮肤 → 直方图~~（2026-09-12 完成，Phase 5-6 Task 6.1-6.2 完成）

**第七轮 (2 天)**：~~archiver 依赖引入 → 导出服务 → 批量 ZIP → 格式转换 → ExportDialog UI → 幻灯片增强~~（2026-09-12 完成，Phase 7 Task 7.0/7.1/7.2 全部完成，135 测试通过）

**第八轮**：~~Phase 8 AI 插件系统~~（2026-09-18 骨架交付 `59c12e1`，遗留项回填 `932ca12`）→ ~~Phase 8 缺陷修复 M1-M5~~（2026-09-19，分支 `fix/phase8-defects`，`c885f4d`..`b1c83b7`，P0-1~P2-19 全部实施，43 文件 393 用例全绿）。代码已交付，**人工验收进行中**（[plans/Phase8人工验收清单](plans/Phase8人工验收清单-2026-09-19.md)）。

**穿插修复轮**：2026-09-13~18 两轮回归——`0db1c02` 7 项缺陷；`07c1c3d` 搜索 jpg 归一/浅色主题/密度/后台扫描/关闭卡顿（对应 [archive/defect-summary-2026-09-15.md](archive/defect-summary-2026-09-15.md) 的 R-1/R-2/R-3）；ABI 测试基建解耦 `9e7de8f`。

---

## 十一、已知遗留项（2026-09-19 汇总）

| # | 项 | 来源 | 状态/触发条件 |
|---|---|---|---|
| L1 | upscale 逐带（band）流式写盘——放宽 40M 像素预算上限 | Phase8 M1/P0-2 降级 | 需 `edit.write` SDK 契约变更，后续项 |
| L2 | `plugin.cancel` 协作式逐瓦片即时取消 | Phase8 M4/P1-7 降级 | 需 SDK 取消令牌契约变更；当前作业项跑完即停 |
| L3 | matting 真实含主体照片的抠图画质抽检 | CHANGELOG 遗留项 | test-library 为无主体生成图，需人工实拍验 |
| L4 | ai-crawler PoC R2/R4/R5/R6/R8/R9 实测回填；Q1/Q2/Q3/Q7 设计决策 | plans/ai-crawler-direction §15/§16 | Phase 9 开工前必须定案 |
| L5 | 安装包随 Phase8 M1-M5 与媒体性能改动重新打包；首启建库/升级路径人工验 | 回归计划 §6.4 | 09-18 已产 138.8MB Setup + CDP 冒烟 6/6；代码再次变更后需重打 |
| L6 | 回归计划 M0~M8 人工 UI 走查（DEF-2~9 在新构建上复验） | [plans/回归测试计划-2026-09-13.md](plans/回归测试计划-2026-09-13.md) §6.4 | 待人工 |
| L7 | 媒体性能人工 DevTools 项：memory cache 命中、P95 帧时间、大视频(>1GB) seek、退出 temp 终清 | archive/媒体加载性能提升方案 §三 | CDP 29/29 已验自动化可达项，余下需人工 |
| L8 | P2-2 缩略图生成迁 utilityProcess | 同上 | 数据不达标（扫描期主进程 >50ms 长任务）才做 |
| L9 | TC-THUMB-004/005、TC-GRID-001~004、TC-PERF-001~003 待手动执行 | archive/测试方案.md（工程化欠账） | 模板已建，待执行 |

## 十二、进行中（2026-09-19）

- **媒体加载性能提升**：P0-1/P0-2/P1-1/P1-2/P1-3/P2-1 已全部实施，`scripts/cdp-verify-media.mjs` 真机验证 29/29 通过；代码已提交至 `fix/phase8-defects`（`6df2c18`）。方案与基线详见 [archive/媒体加载性能提升方案-2026-09.md](archive/媒体加载性能提升方案-2026-09.md)。
- **Phase 8 人工验收**：☐ 项进行中，完成后本项与第八轮状态同步更新。
- **AI 修图批处理体验验证**：>20 张多选入队后台批处理（P0-1 交付）的真实场量验证随人工验收清单一并进行。

---

**文档创建日期**：2026-03-11（源）｜**合并重写**：2026-08-16｜**架构分析补充**：2026-08-22｜**Phase 8/回归/媒体性能回写**：2026-09-19