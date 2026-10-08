# Phase 9 · M5/M6 · T23 + T24 + T25 合并实施方案

> **范围**：T23（AI 标签 + IQA 质量分）· T24（视觉匹配升级，增强 T16）· T25（JobRunner 收编 phash + export）
> **状态**：🔨 已确认，实施中（按 T23 → T24 → T25 顺序）
> **前序**：T21（CLIP 索引 + vectors.db/HNSW）✅、T22（语义搜索）✅、M4 UI（T17–T20：DiscoverPanel/CrawlSourceManager/AgentSettings）✅、T16 RecommendScorer ✅
> **口径**：Phase 9 = AI + 采集（爬虫）Agent 统一体系；采集主体含 Telegram（tg-mtproto）已在 M3 交付。本轮为 M5 索引能力的收尾（T23/T24）+ M6 技术债统一（T25）。
> **预估工时**：T23 ≈ 2 天 · T24 ≈ 2 天 · T25 ≈ 2 天（合计 ≈ 6 天，单人）
> **门禁不变**：`tsc --noEmit` 0 错 + 全量 vitest 绿（conda Node25/ABI141）；IPC 命名沿用现状；不 push、提交待显式授权。

---

## 0. 三项已锁定决策（本轮与用户对齐）

| # | 岔路 | 选定 | 关键影响 |
|---|---|---|---|
| D-1 | IQA 实现 | **零模型启发式**（复用 `histogram.ts` + `sharp`） | 不新增模型资产/下载链；`quality_scores.model_id` 落 `'heuristic-v1'`；深度审美分留后续切片 |
| D-2 | AI 标签词表 | **本库已有标签 ∪ 内置通用视觉类别**，CLIP 零样本 | 不新造标签体系；文本塔 embed 候选 prompt（**非对称精度：文本 fp32 / 图像 int8**，见记忆「非对称精度策略」） |
| D-3 | T25 收编范围 | **phash + export** 收编 JobRunner；**scanner 目录遍历不动** | phash 获真正断点续跑（文档点名的反面教材清偿）；export 统一状态/进度/取消（单复合项，不主张 ZIP 续跑）；scanner 核心路径风险高、收益低 → 登记后续 |

---

## 1. 生产硬约束（三项全部继承，不得违反）

- **C1 零原生静态加载**：`ai-handlers.ts` 被 `main.ts` 静态引入，绝不静态 `import` `ai-wiring`/`usearch`/`ort`；仅 `ai.enabled` 为真时经 `loadAiModules()` 动态拉起。T23 的新作业、T24 的视觉 provider 同守此线（agent 路径不静态链入 usearch）。
- **R2 会话分时**：AI 作业 **load → 批量推理 → unload**；引擎全局引用计数（`engineSessions`）归零才 `engine.unload()`；每库活跃作业守卫（`librarySessions`）同库串行。
- **C2 in-flight load 去重**：`engine.load()` / `TextEncoder.load()` 复用 in-flight Promise。
- **§9.7 模型绑定 / 跨模型拒绝比较**：任何按 `model_id` 读 ANN/vectors 的路径先断言 `ann.getModelId() === layer.modelId`，不符直接空返回并记 error。
- **查询/索引互斥铁律**：标签作业（持引擎写侧）与语义查询（读侧）共享 ANN 时的卸载所有权规则沿用 T22 修复口径（`queryEpoch` 代际 + 「自加载 + 最后离开 + 索引未接管」才卸载）。
- **verifyModel 只读**：新增模型常量若走 ModelManager 校验一律 `deleteOnMismatch:false`。
- **门禁**：新 AI 作业沿用 `ai.enabled` 单闸（boot 期装配 + IPC 触发处校验），关闭态零会话零原生。

---

## 2. T23 · AI 标签 + IQA 质量分

### 2.1 Schema 迁移

**(a) master.db — `MIGRATIONS` 追加 `version: 4`**
```sql
-- tags 增来源列（区分人工/AI 词表），默认 manual 兼容存量
ALTER TABLE tags ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
-- image_tags 增置信度列（AI 采纳时写入，人工为 NULL）
ALTER TABLE image_tags ADD COLUMN confidence REAL;
```
- `tolerant: ['ALTER TABLE tags ADD COLUMN source TEXT NOT NULL DEFAULT \'manual\'', 'ALTER TABLE image_tags ADD COLUMN confidence REAL']`（duplicate-column 报错容忍，重跑安全，仿 v3）。
- 语义：AI **不自动写 `image_tags`**（Q7 人在回路）；`source='ai'` 标记由 AI 触发创建的词表项；`confidence` 仅在用户采纳标签建议时写入。

**(b) thumbs.db — `ThumbnailsDB.createTables()` 追加 `quality_scores`**（非向量元数据留 thumbs.db，对齐方向文档 §9.1 改道）
```sql
CREATE TABLE IF NOT EXISTS quality_scores (
  image_id    INTEGER PRIMARY KEY,
  total       REAL,
  sharpness   REAL,
  exposure    REAL,
  composition REAL,
  model_id    TEXT NOT NULL,        -- 'heuristic-v1'
  created_at  TEXT NOT NULL
);
```
- 新增方法：`upsertQualityScore(input)`、`getQualityScore(imageId)`、`countQualityScored()`。

### 2.2 IQA 零模型启发式（新文件 `src/main/services/ai/quality-scorer.ts`）

纯函数、可注入、无模型：`scoreQuality(absPath: string): Promise<QualityScores>`
- 解码一次到**受限尺寸**（沿用 `histogram.ts` 的 `MAX_PIXELS=2_000_000` 降采样口径；禁止整图原始像素常驻，R7 内存 ≤ 黄区）。
- **sharpness**：降采样灰度缓冲上的 Laplacian 方差（3×3 卷积，边界钳位），归一。
- **exposure**：复用 `histogram.ts` 通道 → 亮度均值偏离理想中位 + 高光/暗部截断比例，归一。
- **composition**：三分法九宫/交点处的边缘能量对比（简化：四交点窗口梯度能量 vs 全图均值），归一。
- **total**：加权和 `0.4*sharp + 0.35*exposure + 0.25*composition`，夹 [0,100]，`round`。
- 权重集中为 `QUALITY_PARAMS`（仿 `SCORER_PARAMS` 风格，便于调参）。

### 2.3 AI 标签零样本（新文件 `src/main/services/ai/tag-suggester.ts`）

`suggestTags(imageVec: Int8Array, candidates: TagCandidate[], promptVecs): Suggestion[]`（纯 DI，零模型可测）
- 候选词表 = 本库 `tags`（`getAllTags` 名）∪ 内置通用类别 `BUILTIN_LABELS`（约 40 项英文：portrait/landscape/food/architecture/animal/plant/artwork/screenshot/document/night/urban/nature/vehicle/interior/water/sky/macro/…；prompt 模板 `"a photo of a {label}"`）。
- 对每个候选 prompt 经 **TextEncoder fp32** 编码（D-2 非对称精度；见 §2.5 TextEncoder 扩展 `encodeBatch`），与图像 int8 向量算余弦 → softmax（温度 τ 可调，`TAG_PARAMS.TEMPERATURE`）→ 取 `confidence ≥ TAG_PARAMS.MIN_CONFIDENCE`（默认 0.15）的 top-N（默认 ≤5）。
- 输出不含 image_tags 写入，仅候选 `{tagName, confidence}`。

### 2.4 作业编排（复用 `ai.clip-index` 同款会话机器）

新文件 `src/main/services/ai/label-quality-session.ts` + `ai-wiring.ts` 扩展：

- **kind `ai.label`**（需引擎图像塔 + 文本塔会话）：
  - `enqueueLabelForLibrary(libraryId, runner)`：仿 `enqueueIndexForLibrary`——`ai.enabled` 且本库 `countIndexed(modelId)>0` 才建作业；items = 已索引（dirty=0）图像；库级活跃守卫（`librarySessions` 复用，同库串行）。
  - 会话：`engine.load()` + `acquireEngine()` + `ann`（只读，标签不需 ANN 检索——直接读 vectors.db 图像向量 + TextEncoder encodeBatch prompt 向量，**不 load ANN**，规避与查询互斥的复杂度）→ 逐条 `getEmbedding(imageId)`（缺/脏→skip）→ `suggestTags` → 有建议则写 **proposal**（见 2.6）→ finally 释放引擎。
- **kind `ai.quality`**（纯 sharp，无模型、无引擎会话）：
  - `enqueueQualityForLibrary`：items = `countQualityScored()` 未覆盖的图像（或全量重算，payload 传 `{force}`）；单条 `scoreQuality(absPath)` → `upsertQualityScore`。**不触碰引擎/ANN**（可与任意作业并行，但仍走 `ai.enabled` 闸以统一门禁）。
- 注册库感知处理器（幂等覆盖，仿 `registerLibraryAwareIndexHandler`）：依赖缺失/库离线 → 抛错记 failed（不假成功，可 resume）。

### 2.5 TextEncoder 扩展

`text-encoder.ts`：接口加 `encodeBatch(texts: string[]): Promise<Uint8Array[]>`；`OnnxClipTextEncoder` 实现复用单次 `load()`（C2）循环 `encode`（prompt 数量 ≤ ~60，无 60 次会话churn）。空输入短路返回 `[]`。

### 2.6 采纳链（复用 ProposalStore + 人在回路，Q7）

- 标签建议写 `proposals`：`agentKind='quality'`（AgentKind 已含 'quality'，无需扩枚举），`payload = { imageId, imageRelativePath, suggestions: [{tagName, confidence}] }`，`score/confidence` 取最高建议置信。
- 新 IPC（camelCase，`ai.enabled` 门控，仿 `semanticSearchImages`）：
  - `triggerAiTagging(libraryId)` → 动态拉起 wiring → `enqueueLabelForLibrary`，返回 `{success,data:{jobId}}`（无待处理/未启用 → `{success:false,error}`）。
  - `triggerAiQuality(libraryId, force?)` → `enqueueQualityForLibrary`。
  - `listTagSuggestions(libraryId)` → 复用 `listProposals({agentKind:'quality'})` 薄封装（含缩略图所需的 image 映射）。
  - `adoptTagSuggestion(proposalId)` → accept 分支：对每条 suggestion `getOrCreateTag(name, source='ai')` + `insertImageTag(tagId, libraryId, image_path, confidence)`；`resolveProposal(id,'accept')`。
  - `dismissTagSuggestion(proposalId)` → `resolveProposal(id,'rejected')`。
- **撤销（已采纳后回退）**：`removeAiTagFromImage(libraryId, imageId, tagName)` → 删该 `image_tags` 行（仅 `source='ai'` 命中的 tag）。

### 2.7 UI（`src/components/agent/AiLabelPanel.tsx`，新）

- 入口挂到既有 Agent/AI 区（AgentSettings 或 DiscoverPanel 邻近），列出 pending `quality` 提案：缩略图 + 建议标签 chips（显示 confidence）+「采纳/忽略」；顶部两个动作按钮「生成 AI 标签建议」「计算质量分」触发作业，进度走 `onJobProgress` 事件（`jobs:*` 已具暂停/继续/取消）。
- 关闭态（`aiOn=false`，复用 `getAiStatus` 探针）隐藏整块。

### 2.8 验收
- 标签：典型库触发后产 pending 建议；一键采纳写入 `image_tags(source='ai', confidence)`，可撤销；未启用零会话/零 proposal。
- IQA：内存峰值对齐 §7.4（≤ 黄区，降采样处理）；`quality_scores` 可查；模糊/欠曝样本分显著低于清晰/正常样本（回归序断言）。

---

## 3. T24 · 视觉匹配升级（增强 T16，非闭环必需）

### 3.1 RecommendScorer 扩依赖（向后兼容，零依赖铁律）

`recommend-scorer.ts`：
- `SCORER_PARAMS` 增 `VISUAL_WEIGHT`（默认 0.25）。
- `RecommendScorerDeps` 增**可选** `getVisualSimilarity?: (draft: CandidateDraft, libraryId: number|null) => Promise<number | null>`。
- `propose` 内：provider 存在 → 取 `sim = await getVisualSimilarity(draft, libraryId)`；`Number.isFinite(sim)` 才融合：`base = (1-VISUAL_WEIGHT)*base + VISUAL_WEIGHT*sim`；null/NaN → 原样回退。
- **provider 缺省（AI 关）→ 完全等价今日 T16**：`scoreDraft` 签名不变，现有 22 项单测须保持全绿（回归护栏）。

### 3.2 视觉 provider（仅 `ai.enabled` 注入）

`ai-wiring.ts` 新导出 `runVisualSimilarity(libraryId, localMediaPath): Promise<number|null>`：
- **仅图像-图像**（候选本地图 vs 收藏图像向量，两侧皆 int8 CLIP 图像塔，同一投影空间 → **无需文本塔、无非对称问题**）。
- 前置：`ai.enabled` + `ann.getModelId()===layer.modelId`（§9.7）+ 本库有收藏且已索引；否则 null。
- 流程：`engine.load()`+`acquireEngine()`（C2，共享索引/查询同引擎）→ `embed(localMediaPath)` → 读该库**收藏图**的 image_ids（`favorites` → `getEmbedding`）→ 逐条反量化 int8→归一（等比缩放保方向）算余弦 → 取 top-k（默认 k=8）均值夹 [0,1]（`(1+cos)/2` 映射）→ finally 按引用计数释放（复用 §1 互斥口径）。
- **候选必须是本地路径**：仅对已具本介质（如 `tg-export-import`、`app-bridge` 即时产本地文件）的候选出信号；纯远端 URL 候选 → null（不在打分期拉网络，守「关闭态零网络」与低延迟）。后续切片可加「下载后二次评分」升级。

`agent-handlers.ts` 构建 `RecommendScorer` 处：`if (getSetting('ai.enabled')) { const wiring = await loadAiModules(); deps.getVisualSimilarity = (draft, libId) => firstLocalMedia(draft) ? wiring.runVisualSimilarity(libId, firstLocalMedia(draft)!) : Promise.resolve(null) }`（动态 import，不破 C1）。

### 3.3 验收
- AI 关：T16 打分/提案行为与序完全不变（现有测不改即证）。
- AI 开：候选带本地媒体且库有已索引收藏时，`score` 含视觉分量（可注入 fake provider 断言融合公式；e2e 门控下真实路径冒烟）。

---

## 4. T25 · JobRunner 收编（phash + export）

### 4.1 pHash 回填 → 真·项级断点续跑

- 新 kind `image.phash-backfill`，`src/main/services/image-service.ts` 重构 `startPhashBackfill`/`stopPhashBackfill`：
  - `startPhashBackfill(libraryId)`：改为——查全部无 phash 图（`getImagesWithoutPhash` 全量或分页收集 imageIds）→ `runner.enqueue('image.phash-backfill', {libraryId}, {items})` → `runner.start(jobId)`，返回 `{success,data:{jobId}}`。**删除单槽 `backfillRunning`**，改「库级活跃作业守卫」map（同库重复触发 → 返回既有 jobId，不并行）。
  - 注册单条处理器：`computePhash(absPath)` → `db.updatePhash(imageId, hash)`；失败抛错记 failed（可 resume）。
  - `stopPhashBackfill()` → 对活跃 `jobId` 调 `runner.cancel`（或 `jobs:cancel`）。
- **进度**：废弃自定义 `sendToRenderer('phashProgress', …)` 手撒，统一走 `runner.subscribeProgress` → 既有 `job-progress` 事件（`JobProgress{total,done,failed}`）。`onPhashProgress` preload 面保留但改为转发 `job-progress`（或前端改订阅 `onJobProgress`——本方案：保留 `phashProgress` 兼容名，主进程内由 job 进度映射发出，减少前端改动）。
- 收益：进程重启后 `job_items` 落库续跑，清偿「百万库 pHash 无持久化」反面教材（方向文档 §147）。

### 4.2 批量导出 → 状态/进度/取消统一（复合项）

- ZIP 是单流不可增量续跑，故 `export.batch` 用**单复合作业项**建模（非每文件一项）：
  - `exportBatch` 外层包一个 `runner.enqueue('export.batch', opts, {items:[{libraryId, imageId:null}]})` + 复合处理器内跑**现有流式 `ExportService.exportBatch`**，`onProgress(done,total)` → 手动 `db.updateJobState(jobId,'running',done,failed)` 映射进度；`ac.abort` 由 `runner.cancel`→handler 观察 abort 桥接 `ExportService.cancel(taskId)`。
  - 目的：导出纳入统一作业台账（历史/并发可见/取消），**不主张断点续跑**（文档已述 ZIP 语义限制）；`ExportService` 内部流式逻辑不改，仅生命周期挂到 JobRunner。
- `exportSingle`（交互式单图）不入队（对齐 JobRunner「双通道：交互式不进队列」设计原则）。

### 4.3 scanner 明确不收编（本轮）
- 目录遍历的 items 集在遍历中才涌现，与 JobRunner 预知项集模型冲突；scanner 是核心能力（非插件），改造风险高、收益低。登记技术债于方案末尾，留后续切片评估「遍历产 pending 元数据/thumbnail 项」的可行子集。

### 4.4 验收
- phash：中断→重启→`jobs:get` 见 done 保留、pending 续跑；cancel 生效；既有 phash 相关测迁移后全绿。
- export：批量导出可被 `jobs:list` 观察、`jobs:cancel` 取消、进度实时；单文件失败不中断（沿用既有导出健壮性）；`export-service.test.ts` 全绿。

---

## 5. 涉及文件一览

**T23**
- 改：`src/main/services/database.ts`（MIGRATIONS v4 + ThumbnailsDB.quality_scores + 方法 + tags source/insertImageTag confidence）、`ai/text-encoder.ts`（encodeBatch）、`ai/ai-wiring.ts`（label/quality 入队 + 处理器 + boot 接线）、`ipc/ai-handlers.ts`（5–6 新通道）、`src/types/index.ts` + `electron/preload.ts`（能力面）、`AgentSettings.tsx`/或新 `AiLabelPanel.tsx`（UI）、`index.html`? 否。
- 新：`ai/quality-scorer.ts`、`ai/tag-suggester.ts`、`ai/label-quality-session.ts`、对应 `__tests__`。

**T24**
- 改：`agent/recommend-scorer.ts`（可选 provider + 融合）、`ipc/agent-handlers.ts`（条件注入）、`ai/ai-wiring.ts`（`runVisualSimilarity`）。
- 测：`recommend-scorer.test.ts`（+ provider 融合/回退）、`ai-wiring.test.ts`（`runVisualSimilarity` mock）。

**T25**
- 改：`image-service.ts`（phash→JobRunner，删 backfillRunning）、`export-service.ts`（复合作业包装，逻辑不改）、注册处理器处（`job-handlers.ts` 或新 `job-kinds.ts` 汇总注册）、`preload.ts`/前端进度订阅迁移。
- 测：phash-backfill-via-JobRunner（续跑/cancel）、export 复合作业（观察/取消）。

---

## 6. 测试与门禁策略
- 每子项先写纯 DI 单测（FakeEngine/FakeTextEncoder/临时库），零模型零网络跑绿；模型/网络相关仅门控 e2e（`IV_AI_E2E=1`）冒烟。
- 回归硬线：`recommend-scorer.test.ts` 现有用例不改即绿（证 T24 provider 缺省零影响）；`export-service.test.ts` 绿；phash 迁移用例改写但覆盖等价。
- 全量：`tsc --noEmit` 0 错 + 全量 vitest 绿（基线 705，本轮预计新增 30–45 例）。
- 提交：三项各自可独立 commit（T23 / T24 / T25），**待用户显式授权方提交，不 push**。

---

## 7. 交付边界（本轮有意不做，登记技术债）
- IQA 深度审美模型（CLIPIQA/MUSIQ/LAION-aesthetic）：需自导出 ONNX + 下载链，超本轮，留后续。
- AI 标签中文词表 / 自定义词表 UI：D-2 走内置通用 + 已有标签，中文增强留 §16 Q2 线。
- T24 远端候选「下载后二次视觉评分」：本轮仅本地媒体出信号。
- T25 scanner 收编：见 §4.3。
- `ai.textPrecision` fp32 运行时开关：D-2 标签 prompt 走 fp32 为内部策略，仍不做用户级开关接线。
- 质量分参与排序/筛选（`SearchCriteria` 接入）：本轮仅产分数与查询接口，接入筛选 UI 留后续。

---

## 8. 里程碑顺序与工时
1. **T23（≈2 天）**：schema → quality-scorer → tag-suggester → 作业/IPC → UI → 测。
2. **T24（≈2 天）**：RecommendScorer 融合 plumbing（先测零依赖等价）→ runVisualSimilarity → 条件注入 → 测。
3. **T25（≈2 天）**：phash 收编（旗舰）→ export 复合收编 → 进度面迁移 → 测。
> 三者互不阻塞，可串行提交；T24/T25 不依赖 T23。

---

**请确认此方案，或指出需调整处（如标签 confidence 阈值、内置类别清单、phash 进度兼容策略、是否本轮就要把质量分接入筛选）。确认后我按 T23 → T24 → T25 顺序实施，每项过门禁后听候提交授权。**

---

## 9. 实施回填（2026-10-08，T23/T24/T25 全部交付）

**T23 · AI 标签 + IQA 质量分** ✅
- schema：MIGRATIONS v4（纯补列 tolerant：`tags.source` 默认 'manual' / `image_tags.confidence`）+ ThumbnailsDB `quality_scores` 表 + upsert/查询方法。
- IQA（D-1 零模型启发式）：新 `ai/quality-scorer.ts`（`model_id='heuristic-v1'`），不接筛选 UI；新 `ai/tag-suggester.ts`（CLIP 零样本，本库已有标签 ∪ 内置约 40 英文类，MIN_CONFIDENCE=0.15，导出 `int8Cosine`）；`text-encoder.ts` 加 `encodeBatch`。
- 作业：新 `ai/label-quality-session.ts`（会话分时复用 R2 机器）+ `ai-wiring` 入队/处理器（标签→proposal 'ai_tag_suggestion' 人在回路；质量分→upsert）。
- IPC：`ai-handlers` 六通道（triggerAiTagging/triggerAiQuality/listTagSuggestions/adoptTagSuggestion/dismissTagSuggestion/removeAiTag）+ types/preload 能力面；新 `ai-handlers.test.ts` 13 例。
- UI：新 `AiLabelPanel.tsx` 挂 AgentSettings（ai.enabled 门禁整块隐藏），首次启用 `jobsSubscribeProgress`+`onJobProgress` 事件流（ref 归属活跃 jobId）。
- 夹具适配：`database-migration.test.ts` 两处 `DELETE version = 3` → `>= 3`（v4 存在时 MAX(version) 短路 v3 重跑，非生产 bug）。门禁：tsc 0 + 全量 769 绿。

**T24 · 视觉匹配升级** ✅
- `recommend-scorer.ts`：可选 `getVisualSimilarity` deps + `VISUAL_WEIGHT=0.25` 融合（`0.75*base+0.25*sim`，base 贯通到 noul 融合）；provider 缺省与 T16 完全等价（旧测 13 条不改即绿）。
- `ai-wiring`：`firstLocalMedia`（仅 file:/盘符/UNC 出信号，协议相对 URL 不算本地，D-3 不打分期拉网络）+ `runVisualSimilarity`（只读 vectors.db 行含 §9.7 模型校验，图像-图像 int8 余弦 top-k 均值夹 [0,1]，引擎引用计数，全程静默回退 null）。
- `agent-handlers`：函数体内 `ai.enabled` 门禁 + 动态 import（flag 即开即生效，C1 保持）。新增测 6+7 例。门禁：tsc 0 + 全量 782 绿。

**T25 · phash/export 收编 JobRunner** ✅
- `image-service.ts`：删单槽 `backfillRunning` → 库级 `phashJobs` Map；`startPhashBackfill` 改为 enqueue `image.phash-backfill`（项级 items，失败 throw 记 failed 可续跑，不再写空串污染 phash）+ 返回 `{success, data?:{jobId}}`；处理器 `computePhash→updatePhash` 幂等注册；进度兼容映射（D-3 保留 `phashProgress` 事件名，终态退订+清守卫）；`stopPhashBackfill` 逐库 cancel。scanner 不动。
- `file-handlers.ts`：`export.batch` 复合作业（单复合项 + 内存参数表 `exportJobParams`/`exportBatchJobs`，重启不承诺续跑）；onProgress 三职责：取消观察点（台账 cancelled → `exportService.cancel` + throw）/四参 `updateJobState` 台账映射/100ms 节流 `export-progress`（ExportDialog 零改动）；`cancelExport` 双路桥接；单张导出不入队（双通道原则）。类型面两处签名加 `data?:{jobId}`。
- 新测：`image-service-phash.test.ts` 13 例 + `file-handlers-export.test.ts` 12 例；`export-service.test.ts`/`job-runner.test.ts` 不改即绿。

**实施与方案的差异登记**
- T25 export 处理器落在 `file-handlers.ts` 模块内（未另建 `job-kinds.ts` 汇总注册：目前无跨模块消费者，避免多余间接层）。
- 门禁终态：tsc 0 错，全量 **807 passed / 2 skipped**（逐阶段：T23 后 769 → T24 后 782 → T25 后 807；新增 T23 28 例（含 quality-scorer/tag-suggester/label-session）+ T24 13 例 + T25 25 例，旧测不改即绿）。
- 未提交：待用户显式授权（可拆 T23/T24/T25 三个 commit），不 push。
