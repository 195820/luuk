---
title: 实施计划 Phase 9 — Agent 体系与智能采集
description: Phase 9 Agent 统一基座、采集 Agent（爬虫推荐）闭环、Jev 决策层与索引能力的任务级实施路线 — 时间线、依赖、验收标准
type: plan
status: draft
created: 2026-09-25
revised: 2026-09-25
related_plan: ai-crawler-direction-2026-q4.md
---

# 实施计划 Phase 9 — Agent 体系与智能采集

> 本文把 [ai-crawler-direction-2026-q4.md](./ai-crawler-direction-2026-q4.md) 的方向（§9 向量存储 / §12 爬虫 / §14 分期）落成任务级拆解，并新增贯穿全项目的 **Agent 决策层**。
> **需求来源**：[requirements.md](../../requirements.md) 第二阶段 5/6 节 · [docs/roadmap.md](../roadmap.md) 第五节 #32-#36、#38、#39
> **前序文档**：[implementation-plan-2026-q3-q4.md](./implementation-plan-2026-q3-q4.md)（Phase 5-7 已完成）· Phase 8 插件系统（已交付，见 `.superpowers/sdd/phase8-ai-plugin-system/progress.md`）
> **预估总工时**：核心闭环（M0-M4）**25 天**；索引能力（M5，受 PoC 门禁）**7 天**；JobRunner 收编（M6）**2 天**。合计 **34 天**，加 20% 风险缓冲 ≈ **41 天**（单人全职）。

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
| **M3 采集 Agent 爬虫执行** | B | 6 | 9.5 天 | — |
| **M4 UI 交互层** | B | 4 | 4.5 天 | — |
| **M5 索引能力** | C | 4 | 7 天 | PoC R2/R5 |
| **M6 JobRunner 收编** | D | 1 | 2 天 | — |
| **总计** | — | **25** | **34 天** | — |

> **核心闭环 = M0-M4（25 天）**，可独立交付"关键词匹配版"采集 Agent，不依赖 M5。M5 是视觉匹配升级与 Phase 9 §14a 的索引义务，受 PoC 门禁；M6 是 §14 收尾的技术债统一。

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
M3  T11(CrawlerService) ─► T12(adapter接口+规则引擎) ─► T13(首个适配插件)
     T14(下载子系统) ─► T15(三级去重+落地入库) ─► T16(RecommendScorer+主循环)
                                                     │
M4  T16 ─► T17(DiscoverPanel) ─► T18(确认/跳过/拒绝 ─► FeedbackAggregator)
     T19(CrawlSourceManager) / T20(AgentSettings)  ← 独立并行
                                                     │
M5  T21(CLIP索引流水线) ─► T22(语义搜索) / T23(AI标签+IQA) / T24(视觉匹配升级)
     (gated by PoC R2/R5；T24 增强 T16，非闭环必需)

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
