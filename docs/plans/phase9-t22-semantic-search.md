# Phase 9 · T22 实施方案：CLIP 语义搜索（文本→ANN→结果）

> 状态：**✅ 已实施完成**（2026-10-07；门禁 tsc 0 错 + 全量 vitest 绿 + 门控 e2e 生产混合配对通过；提交待授权。实施回填见 §8）
> 前置：[phase9-t22-text-encoder-poc.md](./phase9-t22-text-encoder-poc.md)（R-a/R-b/R-c 全通过，结论=开门）
> 关联：[implementation-plan-phase9-agent.md](./implementation-plan-phase9-agent.md) T22 · [ai-crawler-direction-2026-q4.md](./ai-crawler-direction-2026-q4.md) §9.4 / §9.7 / R2 / R5

## 0. 目标与范围

- **交付**：查询文本 → CLIP 文本塔 embedding（同 checkpoint / 同 model_id）→ HNSW ANN 召回 → 结果并入搜索。给 `VectorIndexService.search()` **首个生产调用方**，顺带清 T21 审查登记的 **W13 技术债**。
- **不在范围**：AI 标签 / IQA（T23）、视觉相似推荐信号（T24）、模型/分词器的**生产打包与下载**（沿用 T21 口径：开发期 cache 直连 + `ai.enabled` 默认关）、中文查询（标准 CLIP 弱，留 §16 Q2）。
- **验收（对齐 §9.4）**：典型库（≤数万张）语义查询 **P95 < 1–3s**（靠 HNSW，非暴力扫描）；**模型绑定**：查询向量与库向量必须同 `model_id`，跨模型拒绝比较。

## 1. 关键设计决策（PoC 背书，实施者无需再选）

### D-1 非对称精度：文本塔用 int8（默认），fp32 作大库兜底
- PoC：图像塔 int8 几乎无损（fp32↔int8 余弦 0.968–0.982）；**文本塔 int8 漂移较大（低至 0.716）**，但 int8×int8 top-1 仍 100%、与 fp32 全一致，margin 由 0.10–0.23 缩到 0.08–0.13（约 −40%）。
- **默认**：文本塔 `clip-text-b32-int8.onnx`（61MB），与 §R5「int8-only、零 fp32 常驻」内存纪律一致；margin 收缩对典型库召回无碍。
- **兜底开关**：`ai.textPrecision`（`'int8'` 默认 / `'fp32'`）——大库（≥百万）召回不足时切 fp32（254MB，仅按需 load、不进常驻）。两资产都注册，SHA256 各一。

### D-2 查询会话生命周期：按 R2 分时 + 空闲 TTL，绝不与索引会话抢卸载
- 新增「查询会话」：文本编码会话 + 目标库内存 ANN，**首次查询惰性 load**，`IDLE_MS=60s` 无新查询后释放。
- **铁律**：查询路径**只 load、不 unload** 库 ANN 的**所有权**——卸载权仍归索引会话 `finish()` 与 `dispose/closeAll`。空闲 TTL 定时器卸载前**必须**判 `!librarySessions.has(libId)`（该库无活跃索引作业）才 `unload()`，避免把正在写入的共享单例挤出。
- 文本编码会话独立引用计数（仿 `engineSessions`），归零才 `unload()`。

### D-3 Node 端 CLIP 分词器：自实现最小 byte-level BPE，零新运行时依赖
- **不引** `@huggingface/transformers`（重依赖 + 其自带嵌套 sharp 与顶层 sharp 原生符号冲突，见 PoC 记忆）。
- 在 `src/main/services/ai/clip-tokenizer.ts` 实现：加载 `vocab.json`+`merges.txt` → byte-level 预分词 + BPE 合并 + `SOT=49406` 前置 / `EOT=49407` 收尾 → 截断/补齐到 77（pad=EOT）。
- **正确性以 PoC 的 transformers.js 参照逐条对齐**（黄金 token id 固化为测试 fixture）。

### D-4 资产指纹（cache/poc-r2，开发期直连，`verifyModel` 只读模式 `deleteOnMismatch:false`）
| 资产 | model_id / 名 | SHA256 | size |
|---|---|---|---|
| 文本塔 int8 | `clip-text-b32-int8` | `18845f2ccc35223bb7fec403383a131154b11ac0918df25cf51986df5efd3a21` | 64,070,791 |
| 文本塔 fp32 | `clip-text-b32-fp32` | `3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc` | 254,058,553 |
| 图像塔 int8（现有） | `clip-vit-b32-int8` | `0ab0c1b3ace708e539633af1744d5a95247fe4e14d3e08ff197ef82a6cb9bd93` | 88,648,877 |
| `vocab.json` | — | `5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363` | 862,328 |
| `merges.txt` | — | `9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a` | 524,619 |

- **模型绑定（§9.7）**：文本塔与图像塔同为 `Xenova/clip-vit-base-patch32` 同 checkpoint → 同 512 维投影空间；库向量 `model_id=clip-vit-b32-int8`，查询向量按此 id 走对应库 ANN。文本塔 id 仅作资产标识，检索空间键仍是图像 `model_id`。

## 2. 代码改动（按子系统）

### 2.1 新模块 `src/main/services/ai/`
- **`clip-tokenizer.ts`**：`class ClipTokenizer { static fromFiles(vocabPath, mergesPath): Promise<ClipTokenizer>; encode(text): number[] /* len=77 */ }`。纯 JS，顶层零原生依赖（可单测）。
- **`text-encoder.ts`**：
  - `interface TextEncoder { modelId; dim; load(); unload(); isLoaded(); encodeToFloat(text): Promise<Float32Array> }`
  - `class OnnxClipTextEncoder implements TextEncoder`：顶层零原生依赖（`onnxruntime-node` 方法内 `await import()`），`load()` 复用 in-flight Promise（仿 `OnnxClipEngine` C2 串行化）；输入 `input_ids`(int64,1×77)，输出 `text_embeds`[1,512] fp32。
  - 复用 `quantizeEmbedToInt8`（从 `onnx-clip-engine.ts` 导出）把 fp32 文本向量量化为 int8 查询向量。
- **`semantic-search.ts`**：`semanticSearch(deps, libraryId, text, k): Promise<SemanticResult[]>` 编排：tokenize → encode → `quantizeEmbedToInt8` → `ann.search(vec,k)` → 命中 imageId 经 `ThumbnailsDB` 记录 + `toAbsolutePath` 组装。**依赖注入**（tokenizer/encoder/ann/DB 解析器可替身），零模型单测。

### 2.2 `ai-wiring.ts`（生产接线扩展，保持 C1：usearch 链只经动态 import）
- 新增文本资产注册：`registerTextModel(manager, file, precision)`（int8 默认 / fp32 兜底），`createTextEncoder(manager, precision)`（`verifyModel` 只读模式）。
- 查询会话状态：`textEncoder` 单例 + `textSessions` 引用计数 + 每库 `annIdleTimers`；`ensureTextEncoder()` / `scheduleAnnIdleRelease(libId)`（卸载前判 `!librarySessions.has`）。
- 导出 `runSemanticSearch(libraryId, text, k)`：内部 `getAiLayer()` 判启用、解析库 rootPath、`getVectorIndexService(root, CLIP_DIM, CLIP_MODEL_ID)` 确保 load、调 `semantic-search` 编排、组装 `Image[]`+similarity。
- `ensureAiLayerOnBoot`：一并装配文本资产（若 `ai.enabled`）；`disposeAiLayer`：清 idle 定时器、释放文本会话。

### 2.3 IPC / preload / types（camelCase、无前缀）
- **`ai-handlers.ts`**：注册 `ipcMain.handle('semanticSearchImages', (e, libraryId, text, k) => ...)`，**动态** `loadAiModules()` 后调 `wiring.runSemanticSearch`（关闭态/未就绪 → `{success:false,error}`，与 C1 零原生加载一致）。`unregisterAiHandlers` 补该通道。
- **`electron/preload.ts`**：`semanticSearchImages: (libraryId, text, k) => ipcRenderer.invoke('semanticSearchImages', libraryId, text, k)`。
- **`src/types/index.ts`**：`ElectronAPI.semanticSearchImages(...)`；返回 `{ success: boolean; images?: SemanticImage[]; error?: string }`，`SemanticImage = Image & { similarity: number }`（新类型，仿 `similarStore` 的 `SimilarImage`）。

### 2.4 渲染层
- **`src/stores/searchStore.ts`**：新增 `semanticActive: boolean`、`semanticQuery: string`、`semanticSearch(libraryId): Promise<void>`（调 `semanticSearchImages`，复用 `results`/`searching` 承载；与关键词 `criteria` 互斥：进入语义模式清空 keyword criteria，反之亦然）。
- **搜索面板 UI**：`ai.enabled` 时显示「🔍 语义」输入/切换（沿用 T21 `AgentSettings` 的 `getAiStatus` 探测 + `Sparkles` 图标语言）；失败展示 `error` 文案（同 S17 范式）。结果复用现有 `ImageGrid`。

## 3. 测试（基于实测、全覆盖；conda node25 门禁）

- **`clip-tokenizer.test.ts`**：对 N 条样本（含 PoC 的 4 条 + 边界：空串、超长截断、标点/大小写、`</w>`）断言 token id 序列与**黄金 fixture 逐位一致**；fixture 由 `scripts/poc-t22/make-tokens.mjs` 用 transformers.js 生成后固化。
- **`text-encoder.test.ts`**：`FakeTextEncoder` 断言 load/unload 各一次（R2）、并发 `load()` 复用 in-flight（C2 同构）、输出维度=512。
- **`semantic-search.test.ts`**：全替身（tokenizer/encoder/ann/DB）→ 断言：正确 int8 查询向量入 `ann.search`、命中映射为 `Image[]`+similarity、`ai` 未启用/引擎缺失 → 显式失败（不假成功）、模型绑定拒绝跨 id。
- **`ai-wiring` 查询会话**：扩展既有 `ai-wiring.test.ts`——空闲 TTL 卸载前若 `librarySessions.has(libId)` 则不卸载；文本会话引用计数归零才 unload。
- **门控 e2e `clip-e2e-integration.test.ts` 扩展**（`IV_AI_E2E=1`）：真文本塔 int8 + 真分词器 + 真图像向量 + 真 HNSW，跑「生产混合配对」（文本 fp32/int8 × 图像 int8 存储）对 4 张真图查询 top-1 命中，**补齐 PoC 未直接覆盖的混合路径**。
- 门禁：`tsc --noEmit` 0 错 + 全量 vitest 绿（默认 skip e2e）+ 门控 e2e 通过。

## 4. 安全 / 回归红线

- **C1 不破坏**：`semanticSearchImages` 经动态 import，关闭态启动零 usearch/零 ort/零模型/零网络。
- **默认关**：`ai.enabled`（+ `plugins.enabled`）双闸；语义 UI 仅启用时出现。
- **不误删原件**：文本/图像资产 `verifyModel(..., {deleteOnMismatch:false})`（承 T21 W9）。
- **不抢索引**：查询只 load 不夺 unload 所有权；idle 释放前判活跃索引作业。
- **内存有界**：默认 int8 文本塔 61MB，idle 60s 释放；fp32 仅显式开关且按需。

## 5. 交付物清单

- 新增：`clip-tokenizer.ts`、`text-encoder.ts`、`semantic-search.ts` + 对应 `__tests__`；`clip-token` 黄金 fixture。
- 改：`ai-wiring.ts`、`ai-handlers.ts`、`preload.ts`、`types/index.ts`、`searchStore.ts`、搜索面板组件、`ai-wiring.test.ts`、`clip-e2e-integration.test.ts`。
- 文档：`implementation-plan-phase9-agent.md` T22 状态 + 本文件执行回填。
- 资产（cache，gitignore）：`clip-text-b32-int8.onnx` 已在；分词文件已在。

## 6. 实施顺序（确认后执行）

1. `clip-tokenizer.ts` + 黄金 fixture 对齐测试（先证分词，风险最高）。
2. `text-encoder.ts`（Fake 测试）→ `semantic-search.ts`（编排 + 替身测试）。
3. `ai-wiring.ts` 查询会话（引用计数 + idle TTL + 索引互斥）+ 扩展 `ai-wiring.test.ts`。
4. IPC/preload/types/渲染层接线。
5. 门控 e2e 混合配对扩展 → 全量门禁（tsc + vitest + e2e）。
6. 文档同步 + 待授权提交。

## 7. 待确认点（若有异议请指出，否则按上述默认执行）

- **默认文本塔精度**：int8（省内存、margin 略降）vs fp32（召回更稳、254MB 按需）。方案取 **int8 默认 + fp32 兜底**。
- **UI 接入形态**：语义搜索作为搜索面板的**独立模式**（与关键词互斥），而非 `SearchCriteria` 的一个 AND 维度。
- **idle TTL = 60s**：查询会话内存驻留上限时长。

## 8. 实施回填（2026-10-07）

> 按 §6 顺序全链实施完毕，端到端贯通：SearchPanel → `searchStore.searchSemantic` → `electronAPI.semanticSearchImages` → `ai-handlers` → `ai-wiring.runSemanticQuery` → `semantic-search` → `clip-tokenizer`/`text-encoder` → ANN → `getMappedImageById` 组装。

**门禁结果**（conda Node25 / ABI141）：
- `tsc --noEmit`：**0 错误**（覆盖 `src` + `electron`）。
- 全量 vitest（默认 skip e2e）：**65 files / 696 tests 通过**，2 file（真模型 e2e）自动 skip。
- 新增单测：`clip-tokenizer` 16/16（逐位对齐黄金 fixture，含空串/大小写/重音破折号/控制字符/`endoftext` 字面/超长截断/多余空白）· `text-encoder` 8/8（mock ort：R2/C2 + 维度 + attention_mask 防御分支）· `semantic-search` 6/6（全替身编排）· `ai-wiring` 15/15（含 fake timers 验 idle TTL 与索引接管不卸载）· `searchStore` 16/16（含 `searchSemantic` + mode 门控）。
- 门控 e2e（`IV_AI_E2E=1`）：`clip-semantic-e2e-integration.test.ts` 真分词 + 真文本塔(int8/fp32) × 真 int8 图像库存 + 真 HNSW，top-1 全链真实通过。

**与方案的实现差异（均据实测优化，不改架构与硬约束）**：
- **D-3/2.1 分词器入参**：改为 `ClipTokenizer.fromTokenizerJson(json)` 直读 HF `tokenizer.json`（含 vocab/merges/pre_tokenizer/post_processor 一体），而非 `fromFiles(vocab.json, merges.txt)`。关键实测发现：此 CLIP 变体 `pre_tokenizer` 的 `invert:true` **丢弃空白 → 词无空格前缀、无 `Ġ` token**；BPE 末符号加 `</w>`。
- **2.1 fixture 生成器**：`scripts/poc-t22/make-fixture.mjs`（非 `make-tokens.mjs`），golden 序列固化到 `src/main/services/ai/__tests__/__fixtures__/clip-tokens.json`（14 样本，git 纳入）。
- **HF 截断语义**：实测 `transformers.js` 为「后处理 SOT+content+EOT 后按 77 **保头截断**」，超长时**尾 EOT 被切**、内容填满末槽（非预留 EOT 槽）——已按此实现并通过超长样本对齐。
- **2.1 TextEncoder 接口**：`encode(text): Promise<Uint8Array>`（内部即 `quantizeEmbedToInt8` 输出 int8 查询向量），非方案初稿的 `encodeToFloat→Float32Array`；`semanticSearch(deps, query, limit)` 不接 `libraryId`（库归属由 DI 闭包 `search`/`getImage` 承担）。
- **2.2 ai-wiring 命名**：导出 `runSemanticQuery` / `registerClipTextModel` / `createClipTextEncoder` / `loadTokenizerFromFile`；索引互斥铁律落地为「自加载 + 最后离开 + `!librarySessions.has`」才 `ann.unload`。
- **2.3/2.4 UI 字段**：`searchStore` 用 `mode: 'keyword' | 'semantic'`（非 `semanticActive`/`semanticQuery`），查询文本为组件局部态（`SearchPanel` 的 `semanticInput`）；互斥经 `mode` 标志 + `loadMore` 语义门控 + `closePanel` 复位 `mode` 实现。
- **2.2/§1 D-1 fp32 兜底开关**：`ai.textPrecision` 运行时切换**本轮未接线**（默认 int8 文本塔）；fp32 仅在门控 e2e 中验证检索空间一致。
- **3 e2e 落点**：新建独立文件 `clip-semantic-e2e-integration.test.ts`（与 T21 的 `clip-e2e-integration.test.ts` 分文件），聚合于 `IV_AI_E2E=1` 门控下。混合配对断言按「各量化变体独立产出良构 top-1 + 全链确定性」而非「fp32/int8 top-1 id 强等」——合成 near-tie 图库下二者 top-1 可合法不同（实测确认）。

## 9. 代码审查修复回填（2026-10-07 · ultra-review 后）

> 三视角并行审查（完整性/正确性/影响面）合并去重：硬红线（C1 零原生、verifyModel 只读、文本塔指纹、相似度口径、HF 截断对齐）经核查无问题；下列为修出并处置项。

- **[Critical #1] 语义框回车双触发竞态**：portal 内 `<input>` 的 React 事件沿组件树冒泡至面板根 `onKeyDown→handleSearch`，Enter 同时跑 `searchSemantic`(semantic) 与 `search`(keyword)，mode/结果被竞态覆盖。修复：语义输入 `onKeyDown` 加 `e.stopPropagation()`；`searchStore` 引入 `searchSeq` 请求序号丢弃过期响应（后发起者胜）。
- **[Critical #2] `ai.enabled` 未门控 + 失败静默**：语义行原无条件渲染、关闭态 IPC 返 `success:true,images:[]`，「永远 0 结果且无解释」。修复：`SearchPanel` 挂载取 `getAiStatus()`，`enabled=false` 隐藏语义入口；`searchStore` 增 `semanticError` 并在面板渲染；`ai-handlers` 关闭态改返 `success:false,error:'AI 未启用'`。
- **[Warning #3] `textInflight` 可变负致 idle 永不卸载**：`finally` 无条件 `textInflight--` 与 `teardown` 清零叠加会变负，`scheduleIdleUnload` 判 `===0` 不满足 → 文本塔会话常驻。修复：`finally` 改 `Math.max(0, textInflight-1)`；引入 `queryEpoch` 代际，`teardownQuerySession` 自增使在飞 `finally` 跳过对已复位全局计数的二次收尾。
- **[Warning #4] 重装配旧文本编码器未 unload（ort 会话泄漏）**：`setQueryTextEncoder` 直接覆盖引用。修复：换链时 `cancelIdleTimer` + 对已 load 的旧编码器 `void old.unload()`。
- **[Warning #5] 索引可在查询 `await` 期卸载共享 ANN**：`semanticSearch` 内 `await encode` 让出事件循环，索引 `finish→ann.unload` 令随后 `search` 命中空。修复：`runSemanticQuery` 收敛临界区——`enc.load()`/`enc.encode()` 的全部 await 置于触碰 ANN 之前，其后同步 `isOpen→load→search→assemble`（新增 `assembleSemanticResults` 同步出口）。
- **[Warning #7] 只读检索在未索引库落盘 sidecar**：查询自加载后 `unload→save` 会在从未索引的库新建 `vectors.usearch`。修复：`runSemanticQuery` 先查 `getVectorsDB().countIndexed(modelId)===0` → 直接空返回，不 load ANN。
- **[Warning #8] §9.7 跨模型拒绝比较未强制**：`VectorIndexService` 之前不暴露 modelId。修复：新增 `getModelId()`，工厂按 modelId 变化 close+重建；`runSemanticQuery` 断言 `ann.getModelId()===layer.modelId`，不一致记 error 返回空（与 #7 的 `countIndexed(modelId)` 双保险）。
- **[Warning #9] 分词 golden 门控在 gitignore 的 cache/**：纯 JS BPE 唯一正确性证据在全新克隆 CI 被 `skipIf` 整体跳过。修复：抽取 `fromTokenizerJson` 实读字段固化为入库 fixture `__fixtures__/clip-tokenizer.json`（`scripts/poc-t22/make-tokenizer-fixture.mjs`），`clip-tokenizer.test` 改读该 fixture 使 BPE 门测 CI 可跑；补 `loadTokenizerFromFile` 异常路径（缺文件→null）与成功载入 fixture 的单测。
- **[Warning #11] 语义结果被过期关键词高亮**：`searchSemantic` 置 `hasSearched` 却不清 `criteria`，`ImageGridItem` 据 `criteria` 高亮命中语义结果。修复：`searchSemantic` 开头 `criteria:{...EMPTY_CRITERIA}`；`handleClear` 复位 `mode:'keyword'`；高亮取 `hasSearched && mode==='keyword'`。
- **[审查项 #10 · 经核查为误报] 词表 miss 回落 EOT**：审查建议改 `vocab['!']??0`，但实测本 `tokenizer.json` 的 `model.unk_token = <|endoftext|>`(49407)、`byte_fallback=false`——当前 miss→EOT 恰与 HF 声明的 unk 一致（`!` 是索引 0 处 token，非 HF unk）。**保持 EOT 不改**；因 byte-level 词表覆盖全字节、正常输入不命中 miss，改用空词表替身确定性触发该防御分支并加回归测锁死。
- **[Suggestion 顺带处理]**：`ai-handlers` IPC 入参收紧（非法 libraryId / query>512 → `success:false`，limit 夹 [1,500]）；`clip-tokenizer.encode` 早停（内容填满 77 头即 break）；`searchStore` 去 `as unknown as`（`SemanticImage extends Image` 直接赋值）；`text-encoder.encode` 输入长度 + 输出 dtype 自校验并处理 load/unload 竞态（`disposedDuringLoad`）。

**门禁复验（conda Node25/ABI141）**：`tsc --noEmit` 0 错误；全量 vitest **65 files / 705 tests 通过**（新增 `ai-wiring` #7/#8 守卫测 + `loadTokenizerFromFile` 测、`searchStore` seq guard/`semanticError`/清 criteria 测），2 file 真模型 e2e 自动 skip；门控 e2e（`IV_AI_E2E=1`）真模型链通过。
