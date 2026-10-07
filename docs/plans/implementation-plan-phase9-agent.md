---
title: 实施计划 Phase 9 — Agent 体系与智能采集
description: Phase 9 Agent 统一基座、采集 Agent（爬虫推荐）闭环、Jev 决策层与索引能力的任务级实施路线 — 时间线、依赖、验收标准
type: plan
status: approved   # M3 三端接入细则已经用户确认（2026-09-26：小红书网页版先行、Telegram MTProto+导出双通道、按 T11→T16 开工）
created: 2026-09-25
revised: 2026-09-26
related_plan: ai-crawler-direction-2026-q4.md
---

# 实施计划 Phase 9 — Agent 体系与智能采集

> 本文把 [ai-crawler-direction-2026-q4.md](./ai-crawler-direction-2026-q4.md) 的方向（§9 向量存储 / §12 爬虫 / §14 分期）落成任务级拆解，并新增贯穿全项目的 **Agent 决策层**。
> **需求来源**：[requirements.md](../../requirements.md) 第二阶段 5/6 节 · [docs/roadmap.md](../roadmap.md) 第五节 #32-#36、#38、#39
> **前序文档**：[implementation-plan-2026-q3-q4.md](./implementation-plan-2026-q3-q4.md)（Phase 5-7 已完成）· Phase 8 插件系统（已交付，见 `.superpowers/sdd/phase8-ai-plugin-system/progress.md`）
> **预估总工时**：核心闭环（M0-M4）**28 天**（M0-M2 已按原口径交付；M3 因接入范围从「1 个适配插件」扩充为「网站/App/PC 应用三端」调整为 ≈13 天）；索引能力（M5，PoC 已开门）**≈10 天**（原 7 天，R5 改道引入 vectors.db/HNSW +3 天）；JobRunner 收编（M6）**2 天**。合计 **≈40.5 天**，加 20% 风险缓冲 ≈ **48 天**（单人全职）。

---

## 摘要

Phase 8 已交付插件宿主（`utilityProcess` + MessagePort RPC）、JobRunner、插件类型系统与三个内置插件。Phase 9 在其上落地两条主线与一层新增能力：

1. **Agent 决策层（新增，本方案核心）**——把"需要用户反复手动判断的决策循环"抽象为 `Agent 提案 → 人确认` 的半自动循环。所有 Agent 判断统一走 `DecisionProvider` 接口：默认 `LocalRulesProvider`（本地规则 + 统计学习，零联网零成本），可选 `JevProvider`（TypeSafe Jev 云端决策模型，封装为 `decision-provider` 插件）。
2. **采集 Agent（爬虫推荐闭环）**——Agent 基于用户画像自动从信息源发现候选、评分、生成提案，用户在 DiscoverPanel 确认后才下载入库（人在回路）。
3. **索引能力全量（Phase 9 §14a）**——CLIP/SigLIP 语义索引、语义搜索、AI 标签、IQA 质量分，为 Agent 的视觉匹配提供升级路径。

**Agent 不是 LLM Agent**：不引入自主规划/工具调用的通用 Agent 框架。这里的 Agent 是"本地规则 + 统计学习 + 可选 Jev 判断"的推荐/决策引擎，隐私安全、零延迟、可控。

**Jev 的定位（关键）**：Jev 是 TypeSafe AI 的 System One 决策模型，输入 `state`（文本/JSON）+ `questions`，返回类型化答案（Choice/Score/Noul + 概率/置信度），不生成文本。它天然契合 Agent 循环里"只要判断、不要散文"的高频小决策。但它是**云端 API**，与硬约束 C4（写真内容、本地优先、原图不可上传）存在张力——因此本方案将 Jev 定为**可选增强**，默认关闭，且只发送文本元数据白名单（见 D9）。

---

## 📋 任务总览

| 里程碑 | Track | 任务数 | 预计工时 | 门禁 |
|--------|-------|--------|----------|------|
| **M0 数据与类型层** | A | 2 | 1.5 天 | — |
| **M1 Agent 统一基座** | A | 5 | 5.5 天 | — |
| **M2 Jev 决策插件** | A | 3 | 3.5 天 | — |
| **M3 采集 Agent 爬虫执行（三端接入）** | B | 9 | ≈13 天 | — |
| **M4 UI 交互层** | B | 4 | 4.5 天 | — |
| **M5 索引能力** | C | 4 | ≈10 天（原 7 天，R5 改道 +3） | PoC R2/R5/R7 已实测开门 |
| **M6 JobRunner 收编** | D | 1 | 2 天 | — |
| **总计** | — | **28** | **≈40.5 天** | — |

> **核心闭环 = M0-M4（28 天）**，可独立交付"关键词匹配版"采集 Agent，不依赖 M5。M5 是视觉匹配升级与 Phase 9 §14a 的索引义务（PoC R2/R5/R7 已于 2026-09-29 实测开门，方案按实测改道，见 D14）；M6 是 §14 收尾的技术债统一。

### 🔗 任务依赖图

```
M0  T1(迁移v3) ──► T2(类型定义)
                      │
M1  T2 ──► T3(PreferenceProfiler) ─┐
       └─► T4(DecisionProvider+LocalRules) ─┤
       └─► T5(ProposalStore) ───────────────┤
       └─► T6(FeedbackAggregator) ──────────┼─► T7(AgentScheduler) ─► T16
                                             │
M2  T4 ──► T8(宿主 decision-provider) ─► T9(builtin.jev-decision) ─► T10(隐私护栏+升级链)
                                             │                    (可选增强，回落 T4)
M3  T11(CrawlerService+浏览器层) ─► T12(adapter契约+规则引擎) ─┐
     T14(下载子系统) ─► T15(三级去重+落地入库) ────────────────┼─► T13a(bili) / T13b(xhs) /
                                                                 ├─► T13c(telegram 双通道)
                                                                 └─► T16(RecommendScorer+主循环)
     T13d(app-bridge 形态占位，0 天，另立评审)
                                                     │
M4  T16 ─► T17(DiscoverPanel) ─► T18(确认/跳过/拒绝 ─► FeedbackAggregator)
     T19(CrawlSourceManager) / T20(AgentSettings)  ← 独立并行
                                                     │
M5  T21(CLIP索引+vectors.db/HNSW基座) ─► T22(语义搜索) / T23(AI标签+IQA) / T24(视觉匹配升级)
    (R2/R5/R7 已开门；HNSW 自 Phase 10 提前至 T21；T24 增强 T16，非闭环必需)

M6  T25(scanner/phash/export 收编 JobRunner)  ← 独立
```

---

## 📌 M0+M1 代码审查与修复记录（2026-09-26）

T1-T7 交付后经 Ultra Review 发现 **2 Critical / 6 Warning / 6 Suggestion**，已全部修复（全量 365/365、tsc 零错误）。后续里程碑实施时须遵从以下修正后的语义：

| 修正点 | 对后续 Task 的约束 |
|---|---|
| 画像学习闭环：`PreferenceProfile` 新增 `learnedDeltas`（+表列 `learned_deltas`），重建时 `weight = 统计基权重 + learned` 叠加不覆盖 | T16 RecommendScorer / T18 反馈链路不得绕过 `profiler.getProfile()` 直读写画像 |
| 脏检查改**水位线**方案（`source_watermark`，同时钟域秒级串比较）；`rebuildThrottleMs` 生产接线建议 5 分钟 | T16 接线时传入节流值；不得用 JS 毫秒钟与 SQL 秒级钟直接比较 |
| `favorites.updated_at` 新列，`setFavoriteRating` 刷该列标脏 | 任何新增画像信号源都要同步纳入 `getPreferenceLastActivityAt` |
| v3 迁移新增 `tolerant` 补列机制（duplicate column 容忍），旧开发库重跑安全 | 后续迁移补列一律用 `tolerant`，禁改已发布迁移的主 SQL |
| DecisionRegistry 回落语义：**链尾优先**（未达门控时取升级链最深一层），`decisionSrc` 归因保持真实 | M2 JevProvider 接入时不自定义回落候选挑选规则 |
| 单选项 choice 置信封顶 `SINGLE_OPTION_CAP=0.4` | T16 构造问题时避免单选项（无鉴别力） |
| AgentScheduler：`start()` 失败回滚在途登记并 cancel 残留作业；进度订阅不随 `stop()` 拆除；`MIN_INTERVAL_MS=60s` 钳制 + `reschedule()` | T19/T20 设置页改间隔后调 `reschedule()` |
| ProposalStore 连接改为每次调用取（MasterDB 重开安全）；单例检测 db 实例变更自动重建 | T16 主循环不缓存裸连接 |
| `src/types/index.ts` 已 re-export 全部 agent 类型；新增 `CrawlProvenance` 契约占位（补齐 T1 验收项 4） | M3 sidecar 实现按 `CrawlProvenance` 结构落地 |

---

## 🎯 新增顶层决策记录（接续方向文档 D1-D5）

体例沿用方向文档 §3：**决策 / 理由 / 被否决的替代方案 / 失效条件**。

### D6 决策层抽象：DecisionProvider + 本地默认 + Jev 可选

| 要素 | 内容 |
|---|---|
| **决策** | Agent 的所有判断统一走 `DecisionProvider` 接口。默认实现 `LocalRulesProvider`（本地规则 + 统计学习）；`JevProvider` 作为可选云端实现，封装为 `kind: 'decision-provider'` 插件。二者经"置信度门控 + 升级链"协同 |
| **理由** | 判断逻辑与判断实现解耦：无网/无 Key 时本地规则即可跑通闭环；有 Key 时 Jev 提供更高质量的语义判断。升级链 `Jev 高置信 → 本地规则回落 → 人工` 保证任一环节失效都不阻断 |
| **被否决** | ① Jev 作为唯一决策核心（违反 C4 本地优先，强依赖联网+付费）② 纯本地不接 Jev（未满足引入 Jev 的诉求，放弃语义判断增益）③ 用通用 LLM 作 Agent 大脑（重、慢、贵，且 Agent 循环多数是"只要判断"的小决策，杀鸡用牛刀） |
| **失效条件** | 若 Jev 在真实元数据上的判断准确率不显著优于本地规则（T10 实测），则 Jev 降级为纯实验特性，默认不推荐开启 |

### D7 Agent 范围：统一基座 + 采集 Agent 单点跑通

| 要素 | 内容 |
|---|---|
| **决策** | Phase 9 落地统一基座四件套（PreferenceProfile / ProposalStore / FeedbackAggregator / AgentScheduler）+ 采集 Agent 完整闭环；整理/质量/发现/补全/清理/创作六大 Agent 只定义 `Proposal` 协议与接口占位，不实现业务逻辑 |
| **理由** | 七大 Agent 共享同一基座。先用采集 Agent 把基座跑通验证，其余 Agent 后续 Phase 复用基座逐个填充，避免一次性铺开导致基座设计被返工 |
| **被否决** | ① 七大 Agent 全部落地（工时巨大，且整理/补全/创作依赖 Phase 10-11 的蒙版/扩散能力尚未就绪）② 只做采集 Agent 不抽基座（后续每个 Agent 各造一套，重演 scanner/phash/export 三套各自为政的覆辙） |
| **失效条件** | 若采集 Agent 闭环暴露出基座抽象无法容纳其余 Agent 的提案形态，需回头重构 `Proposal` 协议 |

### D8 人在回路：Agent 只产 Proposal

| 要素 | 内容 |
|---|---|
| **决策** | Agent 只生成 `Proposal`（提案），绝不自动入库、绝不自动改文件。用户 accept 才触发下载入库，skip/reject 作为反馈信号回写画像 |
| **理由** | 与项目一贯的"原图绝对不修改 + 软删除 + 补偿式一致性"底线一脉相承；用户对写真库有强控制诉求，自动写入不可接受 |
| **被否决** | 高置信自动入库（违反用户明确表述的"我确认后才入库"场景） |
| **失效条件** | 无（这是产品底线，不因技术变化而失效） |

### D9 Jev 隐私边界（对齐硬约束 C4）

| 要素 | 内容 |
|---|---|
| **决策** | 发往 Jev 的 `state` 只含**文本元数据白名单字段**（标签、文件名 stem、候选项文本描述、结构化选项），绝不包含原图字节、图片绝对路径内容、embedding 向量。Jev 插件默认关闭，需用户显式开启并填 API Key，UI 明示数据出境范围 |
| **理由** | Jev 是云端 API（`api.typesafe.ai`），C4 要求本地优先、原图不可上传。Jev 的输入本就是文本 state 而非图片，只发元数据可在获得语义判断能力的同时守住隐私底线 |
| **被否决** | ① 发送图片让 Jev 判断（Jev 不接受图片，且直接违反 C4）② 发送完整路径与全部 EXIF（含地理位置等敏感信息，超出判断所需） |
| **失效条件** | 若 TypeSafe 提供本地部署/私有化 Jev 端点，则隐私边界可放宽，D9 白名单约束可重新评估 |

### D10 爬虫网络出口二分：HTTP 走宿主、协议级连接器为声明式例外

| 要素 | 内容 |
|---|---|
| **决策** | `web-http` / `web-browser` 形态的 `crawler-adapter` 插件**不发任何网络请求**，只声明请求计划（`RequestPlan[]`）并解析响应（纯函数）；HTTP 执行、Cookie 注入、限速、反爬退让全部由宿主 `CrawlerService` 集中完成。**例外**：`pc-app` 形态（Telegram）允许插件 Worker 内直连 MTProto——该协议非 HTTP、无法由宿主代理执行，作为显式声明权限 `crawler.protocol`（启用时向用户明示） |
| **理由** | 站点改版高频变化隔离在插件（§12.1 插件化核心论据）；登录凭据/Cookie/流量/robots 合规集中治理；与 §5.4「插件不直接依赖 onnxruntime-node」、§12.3「重资源宿主集中管控」同一设计哲学。RSSHub（HTTP 优先、浏览器兜底）与 MediaCrawler（浏览器上下文出签名）两个 60k★ 级项目共同验证了该分层 |
| **被否决** | ① 插件 Worker 内自由 fetch 作默认出口（凭据与限速失控，退化为无管控爬虫）② 给 Worker 建宿主反向 RPC 再代理 MTProto（复杂度无收益） |
| **失效条件** | 若 RequestPlan 表达力不足以覆盖真实站点（如必须多步 JS 链式交互），再评审宿主反向通道 |

### D11 浏览器层：宿主隐藏 BrowserWindow 充当 `luuk.browser` 最小集

| 要素 | 内容 |
|---|---|
| **决策** | 主进程提供浏览器级抓取最小能力：`session.fromPartition('persist:luuk-crawler')` + 隐藏窗口，两个原语——① `navigate + waitForState`（渲染后取 DOM/`__INITIAL_STATE__`）② `inPageFetch`（把 URL 注入**页面上下文**执行 fetch，x-s/wbi 类签名由站点自身 JS 完成）。登录辅助：`showLoginWindow` 打开可见窗口供用户**本人扫码**，会话留在 persist 分区；凭据经 Electron `safeStorage` 加密落盘，不下发渲染进程明文。**不做**：指纹伪装、stealth 补丁、验证码求解 |
| **理由** | §12.3 已否决 Playwright（+300MB），Electron 自带能力覆盖 JS 渲染/登录态/防盗链三需求；「页面自身 JS 出签名」是 MediaCrawler 验证过的免逆向路线，不碰 §12.10「不绕过」红线 |
| **被否决** | ① 签名算法逆向（违 §12.10）② 复用用户日常 Chrome 的 CDP（MediaCrawler CDP 模式；跨进程耦合用户浏览器，与桌面应用形态不符） |
| **失效条件** | 若页面上下文 fetch 也被目标站点风控识别，该来源按 §12.10 标 `degraded` 退让，不升级对抗 |

### D12 连接器形态是枚举不是框架

| 要素 | 内容 |
|---|---|
| **决策** | `connectorType: 'web-http' \| 'web-browser' \| 'pc-app' \| 'app-bridge'` 写入 `crawl_sources.config` JSON（**不做 schema 迁移**），三端形态共用同一条「调度→执行→去重→入库→提案」流水线，差异只在出流方式；`app-bridge`（移动端设备桥）仅类型占位，M3 无实现 |
| **理由** | 网站/App/PC 应用三端接入是用户明确诉求，但流水线其余环节无形态差异；遵 M1 修正纪律「能进 config JSON 不进列、补列一律 tolerant」 |
| **被否决** | 每端形态一条独立流水线（调度/去重/入库逻辑三份拷贝） |
| **失效条件** | `app-bridge` 立项时若设备态（串号/授权）超出 config 承载能力，做 tolerant 补列迁移 |

### D13 Telegram 双通道：MTProto 连接器为主，tdesktop 导出导入为辅

| 要素 | 内容 |
|---|---|
| **决策** | 主通道 `builtin.tg-mtproto`：Node 生态 MIT 许可的 **mtcute**（`@mtcute/node`，TS 原生 MTProto 2.0，运行时 <50MB）以用户**自有账号**凭据（api_id/api_hash + 手机验证码 + 2FA）连接，增量枚举频道/群媒体，游标=message_id；辅通道 `builtin.tg-export-import`：解析 Telegram Desktop 官方「导出聊天历史」产物（result.json + media 目录）直接走 T15 入库链，**零网络零 ToS 风险**，作为 M3 内保底交付 |
| **理由** | Telegram 不存在「接入桌面客户端本体」的正规通道（无本机 IPC/API）；MTProto 账号级 API 正是官方给「PC 端第三方客户端」开放的能力，是业界成熟做法（Telethon/Pyrogram/telegram_media_downloader 同路线）。UI 自动化驱动 tdesktop 极脆弱且无官方接口 |
| **被否决** | ① Python sidecar 跑 Telethon（违 D2）② 读取 tdesktop 本地加密数据库（格式私有）③ Bot API（无法读取非bot管理的既有聊天历史） |
| **失效条件** | 账号风控收紧致 MTProto 不可用时，退化为仅导出导入通道；mtcute 停维护则评估 gramjs（同为 TS MIT） |

### D14 M5 向量存储改道：vectors.db + HNSW 一期引入 + int8-only + 128px 分块

| 要素 | 内容 |
|---|---|
| **决策** | M5 向量存储独立为每库 `.ivlib/vectors.db`，一期即引入 HNSW（原列 Phase 10）；索引作业 int8-only + 会话分时 load/unload；大图统一 128px 分块 + 逐带流式合成 + 单次分辨率 ≤4K |
| **理由** | PoC 实测（2026-09-29，附录 A）：R5 暴力扫描 P95 4.6s 超 §9.4 目标且 EQP 全表 SCAN；R2 fp32 478MB 入内存红线、int8 235MB 且无 VNNI 不提速；R7 naive 4K+ OOM |
| **被否决** | ① 维持「一期暴力扫描、二期再 HNSW」（被 R5 实测直接否）② 向量内联 thumbs.db（被 R5 全表 SCAN + 拖累缩略图链路否）③ fp32 常驻（违反 C3） |
| **失效条件** | 若目标机普遍带 VNNI/独显，int8-only 的内存妥协可重估；若 HNSW 召回不达标回退 sqlite-vec 精确扫描 |

---

## 🎯 M0：数据与类型层（Track A 前置，1.5 天）

### Task T1：数据库迁移 v3

**状态**：✅ 已完成（2026-09-25）  **工时**：1 天  **优先级**：P0  **前置**：无

**需求**：在 `src/main/services/database.ts` 的 `MIGRATIONS` 数组新增 `version: 3`，master.db 建五张表；thumbs.db 侧的 `image_embeddings` / `quality_scores` 随 M5 启动时再迁移（本 Task 不建）。

**Schema 草案**：

```sql
-- 用户偏好画像（单行或多行按 library 分）
CREATE TABLE preference_profile (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id    INTEGER,                 -- NULL 表示全局画像
  keywords      TEXT NOT NULL,           -- JSON: WeightedKeyword[]
  visual_traits TEXT,                    -- JSON: 视觉特征（M5 后由 embedding 填充）
  source_affinity TEXT,                  -- JSON: { sourceId: trustScore }
  exclusions    TEXT,                    -- JSON: 排除词/排除来源
  updated_at    TEXT NOT NULL
);

-- Agent 提案（人在回路的核心表）
CREATE TABLE proposals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_kind    TEXT NOT NULL,           -- 'crawler' | 'organize' | ... （D7 占位）
  library_id    INTEGER,
  payload       TEXT NOT NULL,           -- JSON: 提案内容（候选项元数据）
  score         REAL,                    -- 匹配度评分
  decision_src  TEXT,                    -- 'local' | 'jev' | 'human'
  confidence    REAL,                    -- 决策置信度
  state         TEXT NOT NULL DEFAULT 'pending',  -- pending|accepted|skipped|rejected
  created_at    TEXT NOT NULL,
  resolved_at   TEXT
);
CREATE INDEX idx_proposals_state ON proposals(state);
CREATE INDEX idx_proposals_agent ON proposals(agent_kind);

-- 反馈日志（强化学习数据源）
CREATE TABLE feedback_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id   INTEGER NOT NULL,
  action        TEXT NOT NULL,           -- 'accept' | 'skip' | 'reject'
  delta         REAL,                    -- 本次反馈对画像权重的调整量
  created_at    TEXT NOT NULL
);

-- 信息源（= crawler-adapter 插件实例配置）
CREATE TABLE crawl_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id     TEXT NOT NULL,           -- 对应的 crawler-adapter 插件
  name          TEXT NOT NULL,
  config        TEXT,                    -- JSON: 站点参数/规则包引用
  enabled       INTEGER NOT NULL DEFAULT 1,
  health        TEXT DEFAULT 'ok',       -- ok|degraded（§12.10 健康度）
  success_rate  REAL,
  last_crawl_at TEXT,
  created_at    TEXT NOT NULL
);

-- 采集条目溯源留档（对齐方向文档 §12.8）
CREATE TABLE crawl_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL,
  source_url    TEXT NOT NULL,
  page_title    TEXT,
  author        TEXT,
  url_hash      TEXT NOT NULL,           -- URL 去重（三级去重第一级）
  file_hash     TEXT,                    -- SHA256（第二级），下载后填
  phash         TEXT,                    -- 感知哈希（第三级），入库后填
  image_path    TEXT,                    -- 落地路径，入库后填
  error         TEXT,                    -- 反爬退让记录（§12.10）
  crawled_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_crawl_items_url_hash ON crawl_items(url_hash);
```

**验收标准**：
- [ ] `MIGRATIONS` 新增 version 3，幂等（重复运行不报错、不重复建表）
- [ ] 老库（v2）升级到 v3 无异常，`schema_version` 正确写入
- [ ] 五张表 + 索引创建成功，可用 sqlite3 CLI 验证
- [ ] sidecar JSON 溯源写入逻辑预留（§12.8：即使 DB 损坏溯源仍随文件存在）

**涉及文件**：
- `src/main/services/database.ts`（`MIGRATIONS` 新增 v3 + 建表 SQL）

---

### Task T2：Agent 类型定义

**状态**：✅ 已完成（2026-09-25）  **工时**：0.5 天  **优先级**：P0  **前置**：T1

**需求**：新建 `src/types/agent.ts`，定义 Agent 体系的核心类型；扩展 `src/types/plugin.ts` 的 `PluginKind`。

**类型草案**：

```typescript
// src/types/agent.ts（新建）
export interface WeightedKeyword {
  term: string;
  weight: number;        // 由 FeedbackAggregator 动态调整
}

export interface PreferenceProfile {
  libraryId: number | null;
  keywords: WeightedKeyword[];
  visualTraits?: number[];       // M5 后由 embedding 质心填充
  sourceAffinity: Record<string, number>;
  exclusions: { terms: string[]; sourceIds: number[] };
  updatedAt: string;
}

export type AgentKind =
  | 'crawler'      // 采集（Phase 9 落地）
  | 'organize' | 'quality' | 'discover'
  | 'complete' | 'cleanup' | 'create';  // D7 占位，Phase 9 不实现

export type ProposalState = 'pending' | 'accepted' | 'skipped' | 'rejected';

export interface Proposal<T = unknown> {
  id: number;
  agentKind: AgentKind;
  libraryId: number | null;
  payload: T;               // 采集 Agent: CandidateItem
  score: number;
  decisionSrc: 'local' | 'jev' | 'human';
  confidence: number;
  state: ProposalState;
  createdAt: string;
}

// 决策层抽象（D6）
export type DecisionQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };

export interface DecisionAnswer {
  choice?: string;
  score?: number;
  noul?: number;
  probabilities?: Record<string, number>;
  confidence: number;
}

export interface DecisionContext {
  state: Record<string, unknown>;   // 仅文本元数据白名单（D9）
  questions: Record<string, DecisionQuestion>;
}

export interface DecisionProvider {
  readonly id: string;              // 'local-rules' | 'jev'
  readonly isRemote: boolean;
  isAvailable(): Promise<boolean>;
  judge(ctx: DecisionContext): Promise<Record<string, DecisionAnswer>>;
}
```

```typescript
// src/types/plugin.ts —— 扩展 PluginKind
export type PluginKind =
  | 'ai-index' | 'ai-transform' | 'diffusion-provider'
  | 'crawler-adapter' | 'ui-panel'
  | 'decision-provider';   // 新增（D6）
```

**验收标准**：
- [ ] `src/types/agent.ts` 编译通过，导出上述全部类型
- [ ] `PluginKind` 增加 `'decision-provider'`，不破坏现有插件类型引用
- [ ] `DecisionProvider` 接口可同时被本地实现与插件实现满足

**涉及文件**：
- `src/types/agent.ts`（新建）
- `src/types/plugin.ts`（扩展 `PluginKind`）

---

## 🎯 M1：Agent 统一基座（Track A 核心，5.5 天）

### Task T3：PreferenceProfiler（偏好画像构建）

**状态**：✅ 已完成（2026-09-25）  **工时**：1.5 天  **优先级**：P0  **前置**：T2

**需求**：从现有 favorites / ratings / tags / history 冷启动构建 `PreferenceProfile`，无需用户额外输入。

**技术方案要点**：
- 关键词来源：收藏与高评分图片的标签（`image_tags`）、文件名 stem 分词，按 `评分 × 收藏权重 × 出现频次` 累加为 `WeightedKeyword.weight`。
- 来源亲和度 `sourceAffinity`：初值为空，随采集反馈（T6）填充。
- 排除项：低评分/被 reject 的标签进入 `exclusions.terms`。
- 增量更新：画像缓存于 `preference_profile` 表，行为数据变动时标脏重算（复用 scanner 的 size+mtime 思路，避免全量重扫）。

**验收标准**：
- [ ] 空库/无行为数据时返回中性画像（不报错，keywords 为空）
- [ ] 有收藏+评分+标签数据时，高频高评分标签权重显著高于低频低评分标签
- [ ] 画像持久化到 `preference_profile` 并可跨重启读取
- [ ] 单测覆盖：权重累加、排除项提取、增量标脏

**涉及文件**：
- `src/main/services/agent/preference-profiler.ts`（新建）
- `src/main/services/database.ts`（新增画像读写方法）

---

### Task T4：DecisionProvider 抽象 + LocalRulesProvider

**状态**：✅ 已完成（2026-09-25）  **工时**：1 天  **优先级**：P0  **前置**：T2

**需求**：实现默认决策提供者 `LocalRulesProvider`（零联网、零成本）。

**技术方案要点**：
- `judge()` 对 `choice/score/noul` 三类问题给出基于规则的判断：
  - choice：按 `criteria` 各选项与画像关键词的匹配度打分取最高。
  - score：按匹配命中数映射到有序等级。
  - noul：命中排除词/正向词返回接近 0/1 的概率。
- `confidence` 由选项分布的尖锐度导出（命中越集中置信越高）。
- 与 Jev 实现同一 `DecisionProvider` 接口，供 T16 主循环无差别调用。

**验收标准**：
- [ ] `LocalRulesProvider.isAvailable()` 恒为 true（无外部依赖）
- [ ] 三类问题均返回结构合法的 `DecisionAnswer`，答案不超出给定选项
- [ ] 单测：关键词命中→高置信；命中排除词→noul 接近 0；无命中→低置信

**涉及文件**：
- `src/main/services/agent/decision/local-rules-provider.ts`（新建）
- `src/main/services/agent/decision/decision-registry.ts`（新建，provider 注册与选择）

---

### Task T5：ProposalStore（提案持久化）

**状态**：✅ 已完成（2026-09-25）  **工时**：1 天  **优先级**：P0  **前置**：T1、T2

**需求**：提案的增删改查与状态机管理。

**技术方案要点**：
- 状态机：`pending → {accepted | skipped | rejected}`，终态不可逆。
- 查询：按 `agent_kind` / `state` / `score` 排序分页（DiscoverPanel 消费）。
- accept 时才触发下游动作（采集 Agent 触发下载入库），skip/reject 仅记状态 + 反馈。

**验收标准**：
- [ ] 提案创建默认 `pending`，状态流转受约束（非法流转抛错）
- [ ] 按评分降序分页查询正确
- [ ] accept/skip/reject 写入 `resolved_at` 并联动 `feedback_log`
- [ ] 单测覆盖状态机与查询

**涉及文件**：
- `src/main/services/agent/proposal-store.ts`（新建）

---

### Task T6：FeedbackAggregator（反馈强化）

**状态**：✅ 已完成（2026-09-25）  **工时**：1 天  **优先级**：P0  **前置**：T3、T5

**需求**：把用户对提案的反馈回写为画像权重调整，形成学习闭环。

**技术方案要点**：
- 反馈强度：`accept +0.1` / `skip -0.02` / `reject -0.2`（可调超参，集中定义）。
- 调整对象：提案命中的关键词权重、来源亲和度 `sourceAffinity`。
- 每次调整写 `feedback_log`（`delta` 字段留痕，便于回溯与调参）。
- 边界：权重设上下限，避免单次反馈过度放大。

**验收标准**：
- [ ] accept 后相关关键词权重上升、来源亲和度上升
- [ ] reject 后相关关键词权重下降，累计 reject 后进入排除项
- [ ] 每次反馈在 `feedback_log` 留痕
- [ ] 单测：反馈强度、权重边界、排除项晋级

**涉及文件**：
- `src/main/services/agent/feedback-aggregator.ts`（新建）

---

### Task T7：AgentScheduler（调度循环）

**状态**：✅ 已完成（2026-09-25）  **工时**：1 天  **优先级**：P0  **前置**：T3-T6

**需求**：调度 Agent 作业，复用 Phase 8 JobRunner，不新造调度器。

**技术方案要点**：
- 通过 `getJobRunner()`（[job-runner.ts](../../src/main/services/job-runner.ts)）把 Agent 的发现循环入队为 job。
- 触发时机：定时（可配置间隔）+ 手动（UI 触发）+ 新信息源加入。
- 尊重 feature flag `agent.enabled`；关闭时不调度。
- 与 JobRunner 的批处理/取消/续跑能力天然对齐（重启续跑不丢进度）。

**验收标准**：
- [ ] Agent 作业以 job 形态出现在 jobs 列表，可暂停/取消/续跑
- [ ] `agent.enabled=false` 时完全不调度
- [ ] 定时与手动触发均生效，并发受 JobRunner 约束

**涉及文件**：
- `src/main/services/agent/agent-scheduler.ts`（新建）

---

## 🎯 M2：Jev 决策插件（Track A 可选增强，3.5 天）

> **定位（D6）**：Jev 是可选云端决策增强，**默认关闭**；任一环节失效（无 Key/无网/低置信/插件崩溃）都回落 `LocalRulesProvider`，不阻断闭环。
> **API 事实（2026-09 调研）**：`POST https://api.typesafe.ai/v1/systemone`，`Authorization: Bearer <key>`；请求体必填 `state` / `model`（`jev-latest`）/ `questions`；响应按问题返回 `choice`（选中项+全选项概率+confidence）/ `score`（分数+档位概率+confidence）/ `noul`（0-1 概率，**无 confidence 字段**）。401=Key 无效，422=校验失败，429/529=限流/过载（应退避）。与 `DecisionProvider.judge()` 的三问三答形态一一对应。

### Task T8：宿主 decision-provider 插件挂载点

**状态**：✅ 已完成（2026-09-26）  **工时**：1.5 天  **优先级**：P1  **前置**：T4

**需求**：让 `kind: 'decision-provider'` 插件（T9 的 Jev）能被宿主加载、经 RPC 调用，并以 `DecisionProvider` 适配器注册进 `DecisionRegistry`。

**技术方案要点**：
- **Worker 实执行补齐（最小集）**：`plugin-worker.ts` 的 `plugin.execute` 目前是占位实现——用 `await import(pathToFileURL(entryPath))` 动态加载插件入口，约定导出 `activate(): Record<opId, handler>` 注册表；`plugin.load` 时注册、`plugin.unload` 时移除。**只为 Jev 这一形态补齐**，ONNX/推理类插件的真实沙箱仍属 Phase 10 范围，不在此扩散。
- **宿主适配层**：新建 `src/main/services/agent/decision/plugin-decision-adapter.ts` —— 实现 `DecisionProvider` 接口，`judge()` 内部经 `getPluginManager().executeOp(pluginId, 'jev.judge', ctx)` 转发；`isRemote=true`；`isAvailable()` = 插件已启用 && feature flag `jev.enabled` && Key 非空。
- **注册时机**：新建 `src/main/services/agent/decision/jev-bootstrap.ts`，Agent 初始化时按旗标尝试 `setEnabled('builtin.jev-decision', true)` 并 `registry.register({provider: adapter, source: 'jev', gate: DECISION_GATE.MIN_CONFIDENCE})`；Registry 排序保证 local-rules 恒为链尾（既有语义，不改）。
- **插件权限**：`fetch` 权限已在 `PluginPermission` 集合中，无需扩展类型。
- **失败路径**：RPC 超时/Worker 崩溃 → adapter `judge()` 抛错 → Registry 捕获并 warn 回落（既有 W7 链尾优先语义，**不得自定义回落候选挑选规则**）。

**验收标准**：
- [ ] `plugin.execute` 对 decision-provider 类插件可真实调用（单测用假插件入口验证注册表约定）
- [ ] 未启用插件 / flag 关闭 / 无 Key 三种情况下 `isAvailable()=false`，升级链直接走本地规则，无网络请求
- [ ] 插件抛错时 `registry.judge()` 正常回落 local，`decisionSrc='local'` 归因正确
- [ ] 单测：adapter 转发、三开关组合可用性、错误回落

**涉及文件**：
- `electron/plugin-worker.ts`（`plugin.load/execute/unload` 实执行最小集）
- `src/main/services/agent/decision/plugin-decision-adapter.ts`（新建）
- `src/main/services/agent/decision/jev-bootstrap.ts`（新建）
- 实际落地补充：`src/main/plugins/plugin-registry.ts`（Worker 侧注册表，从 worker 入口抽以便单测覆盖）、`src/main/services/plugin-manager.ts`（`isPluginEnabled/resolveEntryPath/loadPlugin`、启用即装载、执行前重装载自愈）

---

### Task T9：builtin.jev-decision 插件

**状态**：✅ 已完成（2026-09-26）  **工时**：1 天  **优先级**：P1  **前置**：T8

**需求**：内置插件 `src/main/plugins/builtins/jev-decision/`，把 `DecisionContext` 翻译成 Jev System One 请求并把响应规范化回 `DecisionAnswer`。

**技术方案要点**：
- **manifest**：`id: builtin.jev-decision`，`kind: decision-provider`，`capabilities: ["decision.jev"]`，`permissions: ["fetch"]`，`contributes.ops: [{id: "jev.judge", capability: "decision.jev"}]`，`requires.runtime: none`。
- **请求构造**：`DecisionQuestion` 三类型 → Jev 的问题形态一一映射（choice→Choice、score→Score、noul→Noul）；`model: 'jev-latest'`；state 直接透传（白名单过滤在 T10 宿主侧完成，插件不重复实现）。
- **响应规范化**：choice/score 取 `confidence`；**noul 无 confidence 字段** → 以 `confidence = |noul - 0.5| × 2` 折算（0.5 最不确定→0，0/1 最确定→1），保证与本地 provider 同尺度参与门控。
- **重试与预算**：429/529 指数退避（1s/2s/4s，最多 3 次）；401/422 不重试直接抛错（配置问题，重试无意义）。单次 `judge()` 总超时 5s（AbortController），超时算失败走回落。
- **Key 注入**：宿主经 `executeOp` 的 input 附带（插件不落盘 Key）；插件内无持久化。
- **测试**：fetch 注入假响应（mock globalThis.fetch），覆盖三类型解析、noul 置信折算、429 退避、401 快速失败、超时。

**验收标准**：
- [ ] 三类问题的 mock 响应均能规范化为合法 `DecisionAnswer`（答案不超出给定选项/档位）
- [ ] noul 折算公式单测验证（0.5→0 置信、0.95→0.9 置信）
- [ ] 429 重试后成功、401 立即失败、5s 超时失败三条路径单测
- [ ] 插件目录 `plugin.json` + `index.ts` 通过 `PluginLoader.validateManifest`（kind 白名单已在 T2 放行 `decision-provider`）

**涉及文件**：
- `src/main/plugins/builtins/jev-decision/plugin.json`（新建）
- `src/main/plugins/builtins/jev-decision/index.ts`（新建）

---

### Task T10：隐私护栏 + 升级链完善（D9 落地）

**状态**：✅ 已完成（2026-09-26）  **工时**：1 天  **优先级**：P1  **前置**：T9

**需求**：把 D9 的隐私白名单约束做成**宿主侧强制代码护栏**（不依赖插件自觉），并完善 Jev 上线后的升级链行为与 UI 可观测性。

**技术方案要点**：
- **出站过滤器**：新建 `src/main/services/agent/decision/privacy-guard.ts`：`filterStateForRemote(state)` 递归检查——只允许 string/number/boolean/字符串数组/嵌套对象；拒绝疑似绝对路径（`[A-Za-z]:\\`、`\\\\`、`/^\//` 开头且含路径分隔）、疑似 base64/嵌入向量（单字符串 >1024 字符、number 数组 >64 元素）、字段名黑名单（`embedding`/`phash`/`filePath`/`absolutePath`/`gps`/`exif` 大小写不敏感）。
- **接入点**：`plugin-decision-adapter.judge()` 在 `executeOp` 前调用过滤器；被拒绝字段**剔除并 warn**（不阻断整个请求），若过滤后 state 为空则直接判定不可用走回落。
- **升级链复核**：确认 W7「链尾优先」与 S9「单选项封顶 0.4」语义下 Jev 结果不冒领——Jev 低置信时 `decisionSrc` 必须归 `local`；**不新增回落挑选规则**，仅补测试用例锁定
- **门控共享**：`registry.register` 的 gate 沿用 `DECISION_GATE.MIN_CONFIDENCE=0.5`（Jev 实测若明显优于本地，调参属后续超参工作，本期不动）。
- **可观测性**：新增 settings 键 `jev.enabled`（默认 false）、`jev.apiKey`（electron-store 本地保存，**不下发渲染进程明文**，IPC 只返回 `hasKey: boolean`）；`agent-stats` 风格的内存计数（调用次数/回落次数）留给 T20 设置页展示接口。

**验收标准**：
- [ ] 含绝对路径/长 base64/嵌入向量数组/黑名单字段名的 state，过滤后不残留任何敏感内容（单测逐类断言）
- [ ] 过滤不影响正常白名单字段（标签、文件名 stem、候选描述）透传
- [ ] Jev 低于门控时 `decisionSrc='local'` 的回归用例（对齐 W7，不改既有实现）
- [ ] `jev.enabled=false`（默认）时全链路零网络请求；渲染进程任何 IPC 响应不含 API Key 明文
- [ ] 全量 vitest + tsc 零回归

**涉及文件**：
- `src/main/services/agent/decision/privacy-guard.ts`（新建）
- `src/main/services/agent/decision/plugin-decision-adapter.ts`（接入过滤器）
- `src/main/services/settings-service.ts`（`jev.enabled` / `jev.apiKey`）
- `src/main/ipc/plugin-handlers.ts` 或 `agent-handlers.ts`（Key 读写 IPC，只回 `hasKey`）

---

## 📦 M2 交付记录（2026-09-26）

**验证结果**：全量 vitest **431/431 通过**（36 个文件，M1 基线 365 → +66）；`tsc --noEmit` **0 错误**。

**新增/改动文件**：

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/main/plugins/plugin-registry.ts` | 新建 | Worker 侧 op 注册表：内置静态 activator + 第三方入口动态 import，装载幂等、卸载、未知 op 抛错 |
| `electron/plugin-worker.ts` | 改动 | `plugin.load/unload/execute` 由占位改为真实执行；登记 `builtin.jev-decision` activator |
| `src/main/services/plugin-manager.ts` | 改动 | `isPluginEnabled/resolveEntryPath/loadPlugin`；`setEnabled(true)` 先启动 Worker + 装载再置 `activated`；`executeOp` 前重复装载（Worker 崩溃重启自愈） |
| `src/main/plugins/builtins/jev-decision/{plugin.json,index.ts}` | 新建 | 清单 + Jev 客户端（`buildRequestBody/normalizeAnswers/callSystemOne/judge/activate`） |
| `src/main/services/agent/decision/plugin-decision-adapter.ts` | 新建 | `JevDecisionAdapter`（三重开关 `isAvailable`、出站前过滤、RPC 结构兜底、可观测计数） |
| `src/main/services/agent/decision/privacy-guard.ts` | 新建 | D9 强制代码护栏：字段名黑名单 + 路径/base64/向量形态识别 + 逐项剔除留痕 |
| `src/main/services/agent/decision/jev-bootstrap.ts` | 新建 | 升级链装配（纯依赖注入，不触 electron，便于单测） |
| `src/main/ipc/agent-handlers.ts` | 新建 | `getJevStatus/setJevEnabled/setJevApiKey` + 启动装配 `ensureAgentDecisionLayer`（生产接线，Key 只写不读） |
| `electron/{main,preload}.ts`、`src/types/{agent,index}.ts`、`src/main/services/settings-service.ts` | 改动 | 注册/注销 + 启动装配、3 个 preload 方法、`JevStatus/JevStatsSnapshot/JevToggleResult`、`jev.enabled=false` / `jev.apiKey=''` |
| `src/main/plugins/__tests__/{plugin-registry,jev-decision}.test.ts`、`src/main/services/agent/decision/__tests__/{privacy-guard,plugin-decision-adapter,jev-bootstrap}.test.ts`、`src/main/ipc/__tests__/agent-handlers.test.ts`、`src/main/plugins/__tests__/fixtures/*.mjs` | 新建 | 6 个测试文件共 66 例 + 3 个第三方入口夹具 |

**与计划的偏差与补充决策**：
1. **Worker 侧逻辑抽到 `src/main/plugins/plugin-registry.ts`**：`electron/` 目录不在 vitest include 范围内，抽出后可直接用单测覆盖注册表约定（计划 T8 验收项要求"单测用假插件入口验证"）。
2. **内置插件走静态 activator**：内置插件随宿主一起被 Vite 打包，运行时无独立可 import 的产物；故 Worker 启动时显式登记 `activate`，`entryPath` 仅作装载幂等键。第三方插件仍按清单 entry 动态 import。
3. **Jev 清单 `entry: "index.ts"`**：`PluginLoader` 会校验 entry 文件存在，内置目录磁盘上只有 `.ts`，写 `index.js` 会被判 `invalid`。
4. **`jev-bootstrap.ts` 不含生产依赖**：真实 `PluginManager`/settings 的装配函数移到 `agent-handlers.ts`，保持 bootstrap 为可测的 DI 边界；回落逻辑零改动（仍由 `DecisionRegistry` 按 W7 链尾优先持有）。
5. **IPC 命名**：沿用记忆中的纯命名规范（`getJevStatus`），与 Phase 8 的 `plugins:list` 风格并存。

**遗留观察项（不属 M2 范围，待排期）**：
- `builtin.autotone` 清单声明 `entry: "index.js"`，但仓库只有 `index.ts` → dev/打包下均被 `PluginLoader` 判 `invalid`（Phase 8 潜在缺陷）；且它未导出 `activate()`，即使改 entry 也无法被新 Worker 装载。需要"内置插件装载契约"统一（要么补 activator 约定，要么为内置插件建独立构建产物）。
- Jev 真实 Key 的端到端联通验证、以及 T20 设置页接入 `getJevStatus/setJev*`（当前仅有主进程与 preload 能力，无 UI 入口）。
- `plugin-decision-adapter` 的 `stats` 为内存态，重启归零；持久化到 `agent-stats` 待 T20 一并考虑。

---

## 🎯 M3：采集 Agent 爬虫执行（Track B，≈13 天，三端接入版）

> **定位（D7）**：采集 Agent 是 Phase 9 唯一跑通的业务 Agent；M3 交付「发现→下载→入库→提案」的上游半环，提案 UI（DiscoverPanel）属 M4。
> **接入范围扩充（2026-09-26 用户指令）**：爬虫需支持**网站 / App / PC 端应用**三端形态，首批接入 **Telegram PC 端、bilibili 网站、小红书 App**；原口径 9.5 天（1 个适配插件）调整为 ≈13 天（3 适配 + 保底导入通道）。
> **合规基线**：全程受方向文档 §12.9（robots/UA/速率/仅本地使用）与 §12.10（**只识别与退让、不绕过**：不求解 challenge、不打码平台、不代理池、不伪造指纹）约束；默认全关零网络（`crawler.enabled=false`）。

### 🔍 开源调研编排结论（2026-09-26 联网核实）

| 参考项目 | 采纳要点 | 明确不采纳 |
|---|---|---|
| **NanmiCoder/MediaCrawler**（≈60k★） | 真实浏览器上下文生成签名（x-s/x-t 免 JS 逆向）；登录态持久化复用；按站点目录隔离的适配器结构 | Playwright 依赖（§12.3 已否决）；**NCL 1.1 非商业许可 → 零代码搬运，只借鉴思路** |
| **DIYgod/RSSHub**（30k★，MIT） | 每站点一路由的适配插件粒度；HTTP 优先、浏览器兜底两级取数；filter/limit 通用参数下沉宿主 | 服务端部署形态（本项目单机本地） |
| **Dineshkarthik/telegram_media_downloader**（Telethon 系） | MTProto 凭据模型（api_id/api_hash + 验证码 + 2FA）；`last_message_id` 断点续传游标；按 chat 枚举媒体的作业形态 | Python 运行时（违 D2）；换 mtcute 在 Worker 内实现 |
| **SocialSisterYi/bilibili-API-collect / MoyuScript/bilibili-api** | B 站动态/相册/专栏公开 web 端点与分页参数的事实来源 | 前者收过律师函→只引用公开 API 事实；后者 GPLv3 禁搬代码 |
| **yt-dlp**（191k★） | 下载子系统重试/退避/`.part` 原子改名/文件名模板设计惯例 | 视频下载整体不进 M3（图片库场景）；未来如需按「用户自装外部二进制」评估 |
| **XiaohongshuSpider（Appium+mitm 系）** | 无（负面清单） | 模拟器 Root + SSL unpinning + 签名逆向，违 §12.10，**小红书 App 本体直采 M3 不做**（见 T13d） |
| **apify/crawlee**（MIT，Node） | per-host 并发闸与请求队列状态机的接口形状 | 框架整体不引入（JobRunner 已覆盖持久化队列） |

**三端接入总览**：

| 端 | 目标 | connectorType | 技术路线 | 任务 |
|---|---|---|---|---|
| PC 端应用 | Telegram | `pc-app` | mtcute 官方 MTProto 账号级连接（非 UI 自动化）+ tdesktop 导出导入保底 | T13c |
| 网站 | bilibili | `web-http`（`web-browser` 降级） | 宿主会话携用户自有 Cookie 调 web API；wbi 风控时隐藏窗口页面上下文重试一次 | T13a |
| App | 小红书 | `web-browser` | 网页版与 App 同账号同内容池；`inPageFetch` 由站点自身 JS 出签名；用户扫码登录 | T13b |
| App（设备桥） | 小红书 App 本体 | `app-bridge` | **仅类型占位**；未来若做只允许 UI 层自动化（ADB/UIAutomator），禁抓包禁解签名 | T13d（0 天） |

### Task T11：CrawlerService 骨架（宿主侧）

**状态**：✅ 已完成（2026-09-26）  **工时**：2 天  **优先级**：P0  **前置**：T7（已完成）

**需求**：新建 `src/main/services/crawler/`，交付发现作业的宿主编排层与两种出流通道（HTTP / 浏览器），默认全关零网络。

**技术方案要点**：
- `crawler-service.ts`：注册 JobRunner handler（kind 复用 T7 的 `AGENT_DISCOVERY_KIND='agent.crawler-discovery'`，`job_items.imageId` 约定=sourceId，见 `agent-scheduler.ts` L138-140）；每 source 流程：读 `crawl_sources.config` → `pluginManager.executeOp(pluginId,'adapter.buildRequests',{sourceConfig,watermark})` → 宿主执行 plans → `adapter.parseResponse` → 候选交 T16。
- `request-executor.ts`：宿主 HTTP 执行器。Cookie 从 persist 分区注入；per-host 并发 2-4 + 全局上限 + 随机延时 4-8s；robots.txt 可配置尊重；**§12.10 退让状态机**：403/429/503/重定向验证页/challenge 特征/连续 N 页零抽取 → 暂停该主机作业、写 `crawl_items.error`、source `health='degraded'`，退避后最多重试一轮。
- `browser-session.ts`（D11）：隐藏 `BrowserWindow` + `session.fromPartition('persist:luuk-crawler')`；原语 `navigateAndWait(stateSelector)` 取渲染后 DOM/`__INITIAL_STATE__`、`inPageFetch(plan)` 页面上下文执行；`showLoginWindow(sourceId)` 可见扫码窗口；凭据/会话文件存 `%APPDATA%/luuk/crawler/`（safeStorage 加密）。
- `source-store.ts`：`crawl_sources` CRUD；`config` JSON 约定 `{ connectorType, pluginId, params, watermark }`（游标进 JSON 不进列，D12）；水位比较用同时钟域串比较（遵 M1 修正）。
- 装配：`ensureCrawlerLayer(deps)` 纯 DI 函数（仿 `jev-bootstrap.ts`），生产接线进 `agent-handlers.ts`；flag `crawler.enabled` 默认 false。
- **Telegram 例外口（D10）**：`pc-app` source 的发现作业不调 request-executor，直接 `executeOp(pluginId,'adapter.discover',{sourceConfig,watermark})` 由插件自跑（权限声明式管控）。

**验收标准**：
- [ ] flag 关闭时全链路零网络、零窗口创建（沿 agent-handlers.test 的 mock 断言风格）
- [ ] 反爬信号 fixture（403/429/验证页重定向）触发 degraded 且不再发下一页；退避重试 ≤1 轮
- [ ] per-host 并发与随机延时有单测（注入时钟）；游标推进幂等
- [ ] `showLoginWindow` 关闭后会话可被后续请求复用（手工验，不入 CI）

**涉及文件**：`src/main/services/crawler/{crawler-service,request-executor,browser-session,source-store}.ts`（新建）、`src/main/ipc/agent-handlers.ts`（装配接线）、`src/main/services/settings-service.ts`（`crawler.enabled`）、`electron/main.ts`（窗口装配如需）

---

### Task T12：adapter 契约 + 通用规则引擎

**状态**：✅ 已完成（2026-09-26）  **工时**：1.5 天  **优先级**：P0  **前置**：T11

**需求**：定义 `crawler-adapter` 插件的 op 契约与类型；交付 §12.2 第②层——数据驱动的通用规则引擎适配插件。

**技术方案要点**：
- `src/types/agent.ts` 追加：`RequestPlan { url; method?; headers?; needsBrowser?; pageHint?; context? }`、`CandidateDraft { sourceUrl; pageTitle?; author?; description?; tags; mediaUrls; publishedAt? }`（`src/types/index.ts` 同步 re-export）。
- op 契约：每适配器导出 `{plugin}.buildRequests({sourceConfig,watermark}) → { plans, nextWatermark }` 与 `{plugin}.parseResponse({plan,response:{status,url,body},ctx}) → CandidateDraft[]`；**纯函数、禁网络**（Telegram 例外见 D10/T13c）。`response.body` 只传文本，媒体字节绝不进 RPC。
- `builtin.rule-engine-adapter`（§12.2②）：规则 JSON（列表页/详情页 CSS 选择器 + URL 模板 + 图片提取规则），Worker 内用 `linkedom`（MIT，纯 JS）解析；规则包可导入导出（即方向文档「规则包也是插件产物」）。新增依赖入 package.json，纯 JS 不需 externals 处理。
- 权限枚举扩展：`src/types/plugin.ts` `PluginPermission` 增加 `'crawler.fetch' | 'crawler.protocol' | 'crawler.write.media'`，`plugin-loader.ts` 白名单同步；`crawler.protocol` 启用时 UI 需二次确认（M4 落地，M3 在 setEnabled 日志留痕）。

**验收标准**：
- [ ] 契约类型编译通过，`CandidateDraft` 与既有 `CandidateItem` 字段对齐（T16 可直转）
- [ ] 规则引擎对 fixture HTML（列表页+详情页）抽取正确；非法选择器 → parse 抛错不崩宿主（未知 op/异常处理沿用 plugin-registry 既有约定）
- [ ] `PluginLoader.validateManifest` 对 `kind:'crawler-adapter'` + 新权限组合通过

**涉及文件**：`src/types/agent.ts`、`src/types/plugin.ts`、`src/main/plugins/plugin-loader.ts`、`src/main/plugins/builtins/rule-engine-adapter/{plugin.json,index.ts}`（新建）

---

### Task T14：下载子系统（宿主侧）

**状态**：✅ 已完成（2026-09-26）  **工时**：1.5 天  **优先级**：P0  **前置**：T11（可与 T12 并行）

**需求**：宿主集中下载器，复用 `export-service.ts` 成熟模式（§12.4）。

**技术方案要点**：流式写 `{库根}/_downloads/{site}/{album}/`；`.part` + 完成 rename 原子落盘；HTTP Range 断点续传；防盗链 Referer 按 source 配置注入；AbortController Map + 单项失败不中断；per-host 并发与 T11 request-executor 共用同一闸门；下载即算 SHA256（交 T15）；文件名清洗（去非法字符 + url_hash 短后缀防碰撞）。图片/图集为主，**视频下载不在本期**。

**验收标准**：
- [ ] 中断续传后字节一致（本地 http 服务 fixture，零外网）
- [ ] 404/403 单项失败不阻断批次且零重试风暴；`.part` 残留可续
- [ ] 取消（AbortController）后无半文件误入 intake

**涉及文件**：`src/main/services/crawler/downloader.ts`（新建）

---

### Task T15：三级去重 + 落地入库 + sidecar

**状态**：✅ 已完成（2026-09-26）  **工时**：1 天  **优先级**：P0  **前置**：T14

**需求**：§12.5/12.6/12.8 落地：下载前 URL→下载后 SHA256→入库前 pHash；写 `crawl_items` + sidecar；触发增量扫描入库。

**技术方案要点**：`intake.ts`——url_hash（`idx_crawl_items_url_hash` 唯一索引）→ file_hash 比对 → 复用 `src/utils/phash.ts` 汉明距近重排除（阈值沿用现有相似图参数）；sidecar JSON 结构 = `CrawlProvenance`（`{jobId?,proposalId?,crawledAt,sourceId}`）写媒体文件旁；入库后回填 `crawl_items.image_path/phash/file_hash`；确认/补齐 `scanner.ts` 对 `_downloads`/`_edits` 前缀目录排除（§8.3 待确认改动点，若已存在则零改动）。

**验收标准**：
- [ ] 同 URL 二次下载直接跳过；改 URL 同字节 → file_hash 命中；同图不同压缩 → phash 命中（三级各自单测 + 组合矩阵）
- [ ] sidecar 随文件迁移仍存在；DB 损坏场景不丢溯源（手工抽验）
- [ ] 下载目录被主库扫描时零自我递归入库

**涉及文件**：`src/main/services/crawler/intake.ts`（新建）、`src/main/services/database.ts`（`crawl_items` 读写方法）、`src/main/services/scanner.ts`（如需排除补丁）

---

### Task T13：三端适配器插件（T13a/b/c/d）

**状态**：✅ 已完成（2026-09-26，T13d 仅类型占位随 T12 交付）  **工时**：4.5 天  **优先级**：P0  **前置**：T12（T13c 另需 T15）

**需求**：首批三个站点适配器（+1 占位），验证 T12 契约能同时容纳三端形态；统一放 `src/main/plugins/builtins/`，装载走 M2 双路径（内置静态 activator 登记于 `plugin-worker.ts`；`entry` 写 `index.ts` 且磁盘真实存在——M2 交付记录契约）。

**技术方案要点**：
- **T13a `builtin.bili-web`（1.5 天）**：UP 主动态/相册/专栏图集；`web-http` 为主（api.bilibili.com web 端点 + wbi 签名，仅用公开文档化算法）；412 风控 → `needsBrowser` 降级隐藏窗口页面上下文重试一次；匿名可浏览公开动态，关注流需扫码（D11 登录窗口）。
- **T13b `builtin.xhs-web`（1.5 天）**：`web-browser` 专属；搜索/用户笔记列表全部走 `inPageFetch`（站点自身 JS 出 x-s/x-t 签名，**零逆向**）；首轮必须扫码登录；图片取 `url_size_large` 字段；频控保守（单关键词单次 ≤2 页，间隔随机 4-8s）；小红书 App 同账号同内容池——此即 App 端接入的合规形态。
- **T13c `builtin.tg-mtproto` + `builtin.tg-export-import`（1+0.5 天）**：mtcute 在 Worker 内 `iterMessages` 增量枚举（游标=message_id 进 config.watermark）、媒体经 mtcute 直落 `_downloads/telegram/{chat}/`（权限 `crawler.protocol`+`crawler.write.media`）；凭据（api_id/api_hash/手机号）经 settings + safeStorage，**只写不读**沿 M2 Key 模式；验证码输入走一次性 IPC challenge 通道；新增依赖 `@mtcute/node`（MIT；需验证在 utilityProcess 下 crypto/网络可用性，风险登记 PoC R10）。export-import：选库目录解析 `result.json`+media 子树→直接走 T15 入库链，零网络。
- **T13d `app-bridge` 形态（0 天）**：仅类型枚举占位 + 本文档记录边界（UI 层可以，抓包/解签名不行）；真立项另开里程碑评审。

**验收标准**：
- [ ] 三适配器各建离线 fixture（脱敏真实响应快照），`buildRequests/parseResponse` 纯函数全覆盖（各 ≥5 例）
- [ ] tg-mtproto 用注入 `tgClient` 替身测游标推进/媒体落盘/凭据缺失时拒跑；export-import 用自制导出目录 fixture 测全链
- [ ] 默认全关时三适配器零网络；单测全程不触网（CI 约定期）
- [ ] 真机冒烟（用户在场）：B 站匿名动态 3 条→下载→入库→提案可见；Telegram 自有小号 1 频道增量

**涉及文件**：`src/main/plugins/builtins/{bili-web,xhs-web,tg-mtproto,tg-export-import}/{plugin.json,index.ts}`（新建）、`electron/plugin-worker.ts`（4 个 activator 登记）、`package.json`（`@mtcute/node`、`linkedom`）、`src/main/plugins/__tests__/`（新测试 + fixtures）

---

### Task T16：RecommendScorer + 采集主循环闭环

**状态**：✅ 已完成（2026-09-26）  **工时**：1.5 天  **优先级**：P0  **前置**：T13a/b/c、T7

**需求**：候选评分→决策→提案入库→调度器接线，M3 收尾即获得「打开应用→空闲自动发现→生成待确认提案」的完整上游。

**技术方案要点**：`src/main/services/agent/recommend-scorer.ts`：`CandidateDraft + PreferenceProfile → score`，信号=关键词权重命中（含 `learnedDeltas`，**不得绕过 `profiler.getProfile()`**）、`sourceAffinity`、排除词一票否决、发布时间衰减；决策经 `DecisionRegistry.decide()` 统一入口（LocalRules 默认，Jev 开启且达门控才升级；**避免单选项问题** S9；回落不改规则 W7）；候选转 `CandidateItem` 写 `proposals`（`agentKind:'crawler'`）；同 url_hash 已在 `crawl_items`/pending 提案中的不重复提案；注册 `AgentPlanner`（读 enabled 来源出计划）+ 接线 `reschedule()`；`rebuildThrottleMs` 按 M1 修正传入 5 分钟；不缓存裸 DB 连接。

**验收标准**：
- [ ] 全链路集成测试（fixture 响应→提案入库，零真实网络）；flag 关链路整体静默
- [ ] 排除词命中候选 `score≈0` 且不进提案；重复 url_hash 零重复提案
- [ ] Jev 开启且低置信时 `decisionSrc` 归因保持真实（沿 M2 升级链用例模式）
- [ ] 全量 vitest（基线 431）+ `tsc --noEmit` 零回归

**涉及文件**：`src/main/services/agent/recommend-scorer.ts`（新建）、`src/main/services/crawler/crawler-service.ts`（接线）、`src/main/ipc/agent-handlers.ts`（Planner 注册 + 新增 IPC：`triggerCrawlDiscovery`/`getSourceLoginStatus`/`startSourceLogin`，纯命名风格；不新增渲染层 UI，DiscoverPanel 属 M4/T17）

### M3 工时小计

T11 2d + T12 1.5d + T13 4.5d + T14 1.5d + T15 1d + T16 1.5d + 登录辅助/杂项 0.5d ≈ **12.5 天**（风险缓冲后 ≈13 天）。可并行项：T14/T15 与 T11/T12 双轨前置；T13c 不依赖 T11 的 HTTP/浏览器层。

**新增依赖许可清单**：`@mtcute/node`（MIT）、`linkedom`（MIT）；纪律：MediaCrawler（NCL 1.1）、bilibili-api（GPLv3）、yt-dlp（Unlicense，本期仅借鉴设计）均**零代码搬运**。

**风险登记（补入 §15 PoC 精神）**：R10 mtcute 在 Electron utilityProcess 下的 crypto/长连接可用性待验；R11 小红书风控烈度待真机实测（失败仅影响 T13b 可用性，不破架构）。

---

## 📦 M3 交付记录（2026-09-26）

**验证结果**：全量 vitest **546/546 通过**（49 个文件，M2 基线 431 → +115）；`tsc --noEmit` **0 错误**；单测全程零真实网络零窗口（纯 DI）；默认 `crawler.enabled=false` 零对象构造零出流。

**新增/改动文件**：

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/main/services/crawler/{source-store,request-executor,browser-session,robots,crawler-service,crawler-bootstrap}.ts` | 新建 | T11：宿主编排（web 主道 + pc-app D10 例外）、per-host 闸门 + §12.10 退让状态机、persist:luuk-crawler 隐藏窗口层（navigate+pageHint / inPageFetch）、登录窗口；装配纯 DI 幂等 |
| `src/types/{agent,plugin}.ts`、`src/main/plugins/plugin-loader.ts`、`src/main/plugins/builtins/rule-engine-adapter/` | 改动/新建 | T12：`ConnectorType`（含 app-bridge 占位）/`RequestPlan`/`CandidateDraft`+`draftToCandidateBase` 直转、`crawler-adapter` kind + `crawler.fetch/protocol/write.media` 白名单、选择器规则包引擎插件 |
| `src/main/services/crawler/downloader.ts` | 新建 | T14：流式 `.part`+rename 原子落盘、Range 续传、防盗链 Referer、AbortController Map、下载即 SHA256、文件名清洗 |
| `src/main/services/crawler/{crawl-item-store,intake}.ts`、`database.ts`、`scanner.ts` | 新建/改动 | T15：url_hash→file_hash→phash(≤10) 三级去重写 `crawl_items`；sidecar=`CrawlProvenance` 随文件迁移仍存在；scanner 排除 `_downloads`/`_edits`（零自我递归入库）；intake 支持 `file://` 本地路径免下载入库（T13c 接缝） |
| `src/main/plugins/builtins/{bili-web,xhs-web,tg-mtproto,tg-export-import}/{plugin.json,index.ts}` | 新建 | T13a/b/c：wbi 纯函数签名 + 动态/相册分页、小红书 SSR `__INITIAL_STATE__` 读取（零逆向）、Telegram 双通道（MTProto 接口注入 + tdesktop 导出纯本地）；`electron/plugin-worker.ts` 登记 4 个 activator |
| `src/main/services/agent/recommend-scorer.ts` | 新建 | T16：命中/亲和/衰减确定性信号 + 排除一票否决，noul 决策走 `DecisionRegistry.judge` 统一入口（S9 规避/W7 不改规则/provider 全缺→human），写 `proposals`（payload=CandidateItem 直转） |
| `src/main/services/crawler/crawler-service.ts`（`CrawlerPipelineSink`）、`crawler-bootstrap.ts`、`proposal-store.ts`、`ipc/agent-handlers.ts`、`electron/preload.ts` | 改动 | T16 接线：轮初快照→入库→提案流水线（提案段失败不阻断入库）；`hasPendingForSourceUrl` 防重；AgentScheduler 单例 + planner 注册 + `reschedule()`；IPC `triggerCrawlDiscovery/getSourceLoginStatus/startSourceLogin`（含 preload 暴露） |
| `src/main/{services/crawler,services/agent,plugins}/__tests__/`（9 个新测试文件） | 新建 | 115 例：编排/退让/水位/去重矩阵/三级组合/sidecar/四适配器离线 fixture/评分决策/真库全链路（fixture 响应→提案入库） |

**与计划的偏差与补充决策**（均经用户确认或属口径内取舍）：
1. **`@mtcute/node` 未安装**（T13c，用户拍板）：接口注入 + `configureTgClientFactory` 生产工厂位，未注入时 discover 明确拒跑（宁拒勿假成功）；真实客户端入链待 PoC R10 验证后只在 `package.json` 补依赖，不破架构不触 CI 网络。同理 `linkedom` 未引入（规则引擎用轻量解析已达标）。
2. **Telegram 凭据面（safeStorage/验证码 challenge）未实现**：与 mtcute 工厂同属 R10 后接线；`tg-export-import` 保底通道全功能可用（零网络零凭据）。
3. **小红书走 `navigateAndWait` 读 SSR `__INITIAL_STATE__`**而非计划点名的 `inPageFetch`：服务端已签好首屏数据，更忠实零逆向；频控（单关键词≤2 页）在 buildRequests 内硬性封顶。
4. **水位语义统一**：`watermark`=已完成末页（lastConsumed），续跑从 +1 页；失败轮不推进（crawler-service 保证，宁重跑勿漏抓，重复由 url_hash 幂等消化）。
5. **本地文件入库接缝**（T13c，用户拍板）：pc-app 产物以 `file://` 承载，intake 识别后免下载直接进 file_hash/phash 去重与 sidecar 链，两通道共用同一条收尾。
6. **轮初快照防重提案**（T16）：url_hash 已见判定必须在 intake 写入 `crawl_items` 之前取快照，否则本轮新入库候选会被自己判成重复（零提案）；pending 防重用 SQLite JSON1 `json_extract(payload,'$.sourceUrl')`。
7. **`tg-export-import` 清单 `permissions: []`**：纯本地读文件不碰网络不写媒体（落库由宿主 intake 完成），最小权限面；`tg-mtproto` 按计划声明 `crawler.protocol`+`crawler.write.media`。
8. **决策问题用 noul 型**（T16）：非单选项，S9 封顶问题天然规避；`rebuildThrottleMs=5min` 沿 M1 修正口径由 `PROFILE_REBUILD_THROTTLE_MS` 传入，打分与本地规则共用同一 profiler 实例（不绕过 `getProfile()`）。

**遗留观察项（不属 M3 范围）**：
- 真机冒烟（用户在场）：B 站匿名动态 3 条→下载→入库→提案可见；Telegram 自有小号 1 频道增量；小红书风控烈度实测（R11）。
- R10：mtcute 在 utilityProcess 下 crypto/长连接验证后补生产客户端工厂与凭据链（safeStorage 只写不读 + 验证码一次性 IPC challenge）。
- 三个新 IPC 已具 preload 能力但无 UI 入口，消费方在 M4（T17 DiscoverPanel / T19 CrawlSourceManager）。
- sidecar→DB 损坏恢复的磁盘扫描导入器（roadmap #37）未立项，属 M4+。

---

## 🔧 M3 审核修复（2026-09-26，ultra-review 后）

对 M3 交付内容做三视角审查（完整性/正确性/影响面），修复 **1 Critical + 9 Warning + 7 Suggestion**，回归 `tsc 0 错` + 全量 `49 files / 552 tests` 通过（+6 例）。

| 级别 | 发现 | 修复 | 落点 |
|---|---|---|---|
| Critical | `downloadAll` 以实例级 `this.active` 作完成判据，多来源并发同轮抓取永久死锁（JobRunner 批内并发 + 全层共用一个 downloader） | 完成判据改用本次调用局部 `localActive`，`this.active` 仅作全局观测；补跨调用并发回归测试 | `downloader.ts` |
| Warning | 部分页失败（如 500）的轮次仍推进水位 → 永久跳页漏抓 | `canAdvance` 增加 `errors.length===0` 判定；补"500 不推进"测试 | `crawler-service.ts` |
| Warning | §12.10 退让未写 `crawl_items.error`（列成死代码） | `markDegraded` 经新增 `recordError` dep 写诊断行（url_hash 用 nonce 不污染媒体去重/不撞唯一索引）；bootstrap 用 `CrawlItemStore.insertProvenanceError` 实现；补测试 | `crawler-service.ts`/`crawl-item-store.ts`/`crawler-bootstrap.ts` |
| Warning | `inPageFetch` 返回体字段 `url` 被强转成 `finalUrl`→恒 undefined（潜伏） | JSON.parse 后归一化 `finalUrl: p.url ?? url`；超时兜底同处理 | `browser-session.ts` |
| Warning | `hasCookiesFor` 仅判 cookie 数量 → 匿名 cookie 误报已登录 | 增 `loginCookieNames` 参按站点登录特征 cookie（bili SESSDATA/DedeUserID、xhs web_session）判定；agent-handlers `SITE_LOGIN_COOKIES` 传入 | `browser-session.ts`/`agent-handlers.ts` |
| Warning | degraded 来源仍被调度且重启后不持久退让 | planner 过滤 `health==='ok'`；干净重跑（triggerNow 绕 planner）后 `finishRound` 擦回 ok（恢复路径） | `agent-handlers.ts`/`crawler-service.ts` |
| Warning | 适配器插件未启用→发现作业整批抛"插件未启用"静默拉低 successRate | planner 增加 `pm.isPluginEnabled(s.pluginId)` 过滤 | `agent-handlers.ts` |
| Warning | preload 已暴露 3 采集 API 未进 `ElectronAPI`；`setCrawlerEnabled` 全链未暴露 | types 补 4 个签名；preload 暴露 `setCrawlerEnabled`（M4 UI 前置契约） | `types/index.ts`/`preload.ts` |
| Warning | sidecar 非原子写（直写目标名，崩溃留半截 JSON 失去兜底价值） | 先写 `.tmp` 再同卷 `rename` | `intake.ts` |
| Warning | 反爬未覆盖 bili 实际风控码（412/461、JSON code -352/-412） | `ANTIBOT_STATUSES` 补 412/461；`classify` 对 json 体解析 `code` 命中即 `json-risk-code` 退让；持续 4xx/5xx 也喂 `noteExtraction(0)`；补 3 例测试 | `request-executor.ts`/`crawler-service.ts` |
| Suggestion | 空轮（水位耗尽）记 successRate=0 拉低健康度 | `commitRound` successRate 可选，undefined=不采样；`finishRound` total=0 传 undefined | `source-store.ts`/`crawler-service.ts` |
| Suggestion | provider 回 `noul=NaN` 时 `clamp01` 不挡 → score=NaN 污染排序 | 融合前 `Number.isFinite(noul)` 校验，非法回退纯规则分 | `recommend-scorer.ts` |
| Suggestion | tg-mtproto `downloadDir` 宿主未注入→媒体误落盘根（R10 前潜伏） | 新增 `getPcAppDownloadDir` dep，bootstrap 注入 `{库根}/_downloads`（插件自配优先） | `crawler-service.ts`/`crawler-bootstrap.ts` |
| Suggestion | `showLoginWindow` 窗口未跟踪，关层后残留/叠窗 | `loginWindows` Map 按 URL 去重聚焦，`dispose()` 统一销毁 | `browser-session.ts` |
| Suggestion | `hintToEval` 对 `window.*` 原样插值（CSS 分支已收口，不对称） | `window.` 提示走 `/^window(\.[A-Za-z_$][\w$]*)+$/` 白名单，不匹配抛错拒评 | `browser-session.ts` |
| Suggestion | `unregisterAgentHandlers` 未复位 scheduler/profiler 单例 | 注销置 null，热重启重建全新实例（handler 经 Map.set 覆盖天然安全） | `agent-handlers.ts` |
| Suggestion | downloader 注释"流式边下边算"与实际全量读算不符 | 纠正注释口径（落盘完成后全量读算，续传需重算完整文件） | `downloader.ts` |

**未处理（按审查建议登记为技术债，非缺陷）**：
- `findPhashDuplicate` 全表线性扫描（`crawl-item-store.ts`）：M3 规模可暂容忍；大库前需引入 BK-tree/分段索引或限比对窗口。

> 上述修复不改变 M3 已确立的架构与硬约束（双闸零网络、D8 人在回路、D9 隐私白名单、轮初快照时序、三级去重），仅加固并发安全、退让 enforcement、契约完整性与故障隔离。

---

## 🎯 M5：索引能力（Track C，≈10 天，PoC 已开门 · 方案按实测改道）

> **门禁状态**：PoC R2/R5/R7 已于 2026-09-29 实测（附录 A），原「受 PoC 门禁」已解除。
> **改道要点（据实测推翻原 M5 方案，见 D14）**：
> ① R5 → 向量存储独立 `.ivlib/vectors.db` + **HNSW 一期引入**（从 Phase 10 提前）；
> ② R2 → 索引作业 **int8-only + 会话分时 load/unload**（fp32 入 §7.4 红线）；
> ③ R7 → 大图 **128px 分块 + 逐带流式合成 + 单次分辨率 ≤4K**（T21/T23 预处理与 Phase 10 共用同一约束）。

### Task T21：CLIP 索引流水线 + 向量存储基座（≈4 天，原口径 +3 天）
- **状态**：✅ 已完成（2026-10-07，含 Ultra Review 修复，见下方 M5 代码审查与修复记录）
- **交付**：`vectors.db` 独立分库（迁移建 `image_embeddings`，quant 固定 int8）+ HNSW 图索引；`ai-index` 内置插件走 `model-manager` 会话，作业级 **load→批量推理→unload**（R2 会话分时）；预处理按 R7 分块/分辨率上限，lanczos3 降采样到模型输入尺寸。
- **验收**：1M 库冷索引 ETA ≤ R2 实测口径（≈20.5h）；单库体积对齐 §9.3/R5（≈578MB）；**零 fp32 常驻**；作业可断点续跑（复用 JobRunner，4.6 批处理通道）。
- **门禁**：`ai.enabled` + `plugins.enabled` 双闸，默认关。
- **交付边界**：本任务交付「嵌入生成 + 向量持久化 + HNSW 索引 + 扫描后增量索引 + UI 开关」；`VectorIndexService.search()` 已实现并有端到端自检索冒烟覆盖，但**尚无生产调用方**（搜索 UI/查询向量化未接入），该消费侧由 T22 语义搜索承接。

### Task T22：语义搜索（≈2 天）
- **交付**：查询文本→embedding（同 model_id）→ **HNSW ANN** 召回；结果并入 searchStore 高级搜索维度。
- **验收**：1M 库语义查询 **P95 < 1-3s（§9.4 目标，靠 HNSW 达成，非暴力扫描）**；模型绑定 §9.7（换模型拒绝跨 model_id 比较）。

### Task T23：AI 标签 + IQA 质量分（≈2 天）
- **交付**：AI 标签复用 `tags.source='ai'`+`image_tags.confidence`（Q7 人在回路，不自动写库）；IQA 写 `quality_scores`。**大图推理前按 R7 resize/分块，禁止整图常驻。**
- **验收**：标签可一键采纳/撤销；IQA 内存峰值对齐 §7.4（≤黄区）。

### Task T24：视觉匹配升级（增强 T16，非闭环必需，≈2 天）
- **交付**：`RecommendScorer` 增视觉相似信号（采集团候选 vs 用户收藏向量），经 vectors.db ANN。
- **约束**：仅在 `ai.enabled` 开启时挂载，关闭时 T16 原关键词版零依赖、不受影响。

### M5 工时小计：≈10 天（原 7 天 + R5 改道引入 HNSW/vectors.db +3 天）

---

## 📌 M5·T21 代码审查与修复记录（2026-10-07）

T21 交付后经 Code Review 发现 **4 Critical / 9 Warning / 3 Suggestion**，已全部修复（tsc 零错误、门控 e2e + 新增 ai-wiring 生命周期单测、全量 vitest 绿）。核心修正语义如下，后续里程碑须遵从：

| 级别 | 问题 | 修复 | 落点 |
|---|---|---|---|
| Critical | 关闭态主进程每次启动仍静态加载 usearch 原生链（违反「零原生加载」） | `ai-handlers` 不再静态 import ai-wiring/vector-index-service；仅在 `ai.enabled` 为真或用户显式开关时动态 import，模块句柄缓存供退出同步清理 | `ipc/ai-handlers.ts` |
| Critical | 多库并发 `engine.load()` 竞态创建多个 88MB 会话致先建者泄漏 | `load()` 复用 in-flight Promise（`loading` 字段），会话幂等 | `ai/onnx-clip-engine.ts` |
| Critical | `enqueueIndexForLibrary` load→enqueue→start 任一步抛错会外泄引擎会话/引用计数/订阅 | 全程分段 try + 统一 `finish()`（幂等）释放：ANN 落盘、引用计数归零卸载引擎、解订阅 | `ai/ai-wiring.ts` |
| Critical | 共享 ANN 单例被先结束会话 unload 挤出写入 | 引擎全局引用计数 + 每库活跃作业守卫（同库串行，重复触发直接返回 null） | `ai/ai-wiring.ts` |
| Warning | pause 弃用/退出等不会自然 done 的路径不释放会话 | `finish` 纳入活跃闭包集，`disposeAiLayer` 对存活会话统一补 finish | `ai/ai-wiring.ts` |
| Warning | `listAllEmbeddings` 未过滤 dirty=0/模型，占位零向量与旧模型向量被误召回 | 只取 `dirty=0` 且按 `model_id` 过滤；新增 `countIndexed` 供陈旧判定 | `database.ts` |
| Warning | sidecar 与 vectors.db 干净行数不一致（崩溃/未落盘）时误用陈旧索引 | `load()` 校验 `ann.size()` 与 `countIndexed` 不符即全量重建；退出 `closeAll` 先落盘 | `vectors/vector-index-service.ts` |
| Warning | 换维度/换模型 sidecar 不可复用 | dim 不一致 → 丢弃重建（工厂层 `getDim` 判定） | `vectors/vector-index-service.ts` |
| Warning | 库感知 handler 依赖缺失时假成功 | 引擎/层/库/会话依赖任一缺失显式抛错记 failed（可续跑） | `ai/ai-wiring.ts` |
| Warning | 生产 `verifyModel` 校验失败会 unlink 删除唯一 cache 原件 | 新增 `deleteOnMismatch?:boolean`，开发期直连 cache 走只读校验 | `model-manager.ts`、`ai/ai-wiring.ts` |
| Warning | `getAiStatus` 关闭态仍 getVectorsDB 触发建库文件 | 关闭态短路返回 `{enabled:false,indexed:0,pending:0}` | `ipc/ai-handlers.ts` |
| Warning | `removeLibrary` 泄漏 VectorsDB 与 ANN 单例 | 补 `closeVectorsDB`；动态 import `closeVectorIndexService`（不破坏关闭态零加载） | `image-service.ts` |
| Suggestion | embed 单条失败被吞、无根因 | `embedAndPersistOne` catch 内 `logger.warn` 记 image/path/err | `ai/index-session.ts` |
| Suggestion | UI 开关失败静默回滚 | 失败展示 `aiError` 文案 | `AgentSettings.tsx` |

**交付边界（技术债登记）**：`VectorIndexService.search()` 及 HNSW 检索尚无生产调用方，随 T22 语义搜索接入。


