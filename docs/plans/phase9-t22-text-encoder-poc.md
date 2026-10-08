# Phase 9 · T22 前置 PoC：CLIP 文本编码器跨模态可行性验证

> 状态：**✅ 已执行 · 结论=开门（GO）**（2026-10-07，纯脚本实测，零生产代码改动；详见文末「## 6 实测结果」）
> 关联：[implementation-plan-phase9-agent.md](./implementation-plan-phase9-agent.md) T22 · [ai-crawler-direction-2026-q4.md](./ai-crawler-direction-2026-q4.md) §9.4 / §9.7 / R2 / D14

## 0. 背景与触发

T22 原计划 =「查询文本 → embedding → HNSW ANN 召回」。实施前核查发现**硬前提缺口**：

- 现用图像资产 `cache/poc-r2/clip-vit-b32-int8.onnx` 经运行时自省确认为**仅视觉塔**：`INPUTS['pixel_values'] → OUTPUTS['image_embeds']`，**不含文本编码器**。
- repo 内无 CLIP 分词器（vocab/merges），`VectorIndexService.search()` 已实现但**尚无生产调用方**（T21 审查 W13 已登记）。
- 结论：**文本语义检索无法直接开工**，须先验证文本塔可行性——与当初 M5 因 PoC 实测改道（D14）同类的「先开门、后实施」纪律。

## 1. 有利前提（已核实）

- 资产出处 `Xenova/clip-vit-base-patch32`（见 `scripts/poc-r2/download-model.mjs`）。
- **同一仓库存在配对文本塔**：`onnx/text_model_int8.onnx`（64.1 MB）、`onnx/text_model.onnx`（254 MB，fp32），与视觉塔同 checkpoint → 同 `text_projection/visual_projection` 空间 → 跨模态余弦理论上可比。
- 仓库根含标准 CLIP 分词文件：`vocab.json` / `merges.txt` / `tokenizer.json` / `special_tokens_map.json` / `preprocessor_config.json`。

## 2. 待证伪的三个真实风险（PoC 目的）

| 风险 | 说明 | 判据 |
|---|---|---|
| **R-a 投影折叠假设** | 视觉塔输出已是 `image_embeds`(512，折叠 visual_projection)。文本塔是否同样折叠 text_projection 直接输出 `text_embeds`(512)？若否，需从权重手动乘投影矩阵 | 自省 `text_model_int8.onnx` 的 inputNames/outputNames/dims；必要时取投影矩阵补齐 |
| **R-b Node 端 CLIP BPE** | 需在无 Python 前提下产出正确 token id（byte-level BPE、SOT=49406/EOT=49407、pad 到 77、merges 规则） | 与参考实现（HF `tokenizer.json` 或 transformers.js）逐条对齐 token id |
| **R-c int8 跨模态召回退化** | 图像侧已 int8（×127 on L2 归一）；文本侧同法量化后，跨模态 top-k 是否仍可靠；fp32 基线对照量化噪声 | 用 `set01` 真图 + 若干文本查询，比对 fp32×fp32 与 int8×int8 的召回一致性 |

## 3. 执行步骤（确认后）

### P1 资产落位（只读下载，沿用项目既有 downloader 范式）
1. 扩展 `scripts/poc-r2/download-model.mjs`（或新增 `download-text-model.mjs`）从 `hf-mirror` 取：
   - `onnx/text_model_int8.onnx` → `cache/poc-r2/clip-text-b32-int8.onnx`
   - `onnx/text_model.onnx` → `cache/poc-r2/clip-text-b32-fp32.onnx`
   - `vocab.json` / `merges.txt` / `tokenizer.json` → `cache/poc-r2/clip-token/`
   - 完整性用期望体积下限校验（同 R2 惯例）。
2. **不注册进生产 ModelManager**（PoC 阶段仅本地校验，避免污染生产 cache 原件；对齐 T21 W9 教训）。

### P2 R-a 模型自省 + 参考向量基准
1. Node `onnxruntime-node` 打开 `text_model_int8.onnx`，打印 `inputNames/outputNames` 与输出 dims。
   - 期望 `input_ids`(int64) + `attention_mask`(int64) → `text_embeds`(1×512)。
   - 若仅出 `last_hidden_state`/`pooler_output`(768) → 记录需补 text_projection。
2. 取一组参考 token id + 文本向量（用仓库 `tokenizer.json` 经 `@huggingface/transformers` 的 Node 侧调用，或本地 Python transformers 若可用）作「金标准」，用于对齐分词与向量。

### P3 R-b Node CLIP BPE 最小实现 + 对齐
1. 在 `scripts/poc-t22/` 实现 byte-level BPE：加载 `vocab.json`+`merges.txt`，实现 `pre_tokenizer(ByteLevel)`、合并次序、`SOT/EOT`、截断/补齐到 77、position_ids。
2. 断言对若干中英样本产出 token id 序列与金标准**逐位一致**。

### P4 R-c 跨模态召回 sanity（PoC 主结论）
1. 用 `OnnxClipEngine` 同款预处理（sharp lanczos3→224→CHW→CLIP 归一）对 `test-library/set01` 出图像向量（fp32 用 `clip-vit-b32-fp32.onnx`、int8 用 `clip-vit-b32-int8.onnx`）。
2. 文本查询若干（如「猫」「沙滩」「城市夜景」；英文对齐 CLIP 训练分布），出文本向量（fp32/int8 各一）。
3. 计算余弦矩阵，检查：正确图的排名是否最高/前列；fp32 与 int8 两套 top-1 命中一致率。
4. 记录吞吐与内存（文本编码单次会话，供后续并入 R2 口径）。

### P5 结论与门
产出 `docs/plans/` 内一份实测结论（回填本文件「## 6 实测结果」），并据结果二选一：
- **开门**（R-a 清晰、R-b 逐位对齐、R-c 语义召回明显优于随机且 int8 退化可接受）→ 起草正式 T22 实施方案（文本塔并入宿主引擎/ModelManager+SHA256、Node 分词器落 `src/main`、查询 IPC、结果并入 `searchStore` 维度），再确认后编码。
- **不开门**（投影不可得 / 分词成本或召回退化过大 / 中文查询弱到不可用）→ 改道登记：优先「以图搜图」视觉相似（复用现有图像塔 + `search()`，清 W13 技术债），文本语义转 §16 Q2（Chinese-CLIP 等）另立 PoC。

## 4. 交付物（PoC）
- `scripts/poc-r2/download-text-model.mjs`、`scripts/poc-t22/*`（introspect / bpe / cross-modal sanity 脚本，零生产依赖、可 Node 直跑）
- 本文件「## 6 实测结果」回填数据点 + 开门/改道结论
- 不改动 `src/main` 生产代码、不动已提交的 T21

## 5. 约束与注意
- 分词器/文本塔与图像塔**必须同 checkpoint**（§9.7 模型绑定：换 model_id 不互比）→ 三者共享 `model_id = clip-vit-b32-int8`（文本塔为其一部分）。
- PoC 期不触碰 `cache` 原件注册与 `verifyModel` 删除路径（T21 W9）。
- 图像预处理非官方 bicubic（lanczos3）→ 跨模态召回会带此偏差，PoC 以「相对排序合理」而非绝对分值判据。
- 中文能力：标准 OpenAI/Xenova CLIP 中文弱（§16 记录）→ sanity 以英文为主、中文作观察项，不作为开门否决项。

## 6. 实测结果（2026-10-07 回填）

> 工具链：conda node25（ABI 141）+ `onnxruntime-node` + `sharp`；文本编码用 `@huggingface/transformers` 的 `CLIPTokenizer`（本地分词文件，离线）。
> 脚本：`scripts/poc-r2/download-text-model.mjs`、`scripts/poc-t22/{introspect,tokenize-oracle,fetch-real-images,make-tokens,cross-modal}.mjs`（零生产依赖，Node 直跑）。

### R-a 投影折叠 —— ✅ 通过
- 自省 `text_model_int8.onnx` / `text_model.onnx`：`INPUTS['input_ids']`（1×77，**无** attention_mask/position_ids，内部已折叠）→ `OUTPUTS['text_embeds']` **[1,512]**。
- `text_projection` **已折叠**，与视觉塔 `image_embeds`[1,512] **同一投影空间** → 跨模态余弦直接可比，无需手动乘投影矩阵。

### R-b Node CLIP BPE —— ✅ 可行
- `transformers.js` 从本地 `clip-token/` 离线产出正确 CLIP id：`"a photo of a fluffy cat"` → `[49406,320,1125,539,320,17054,2368,49407,…]`（SOT=49406、EOT/pad=49407、补齐到 77）。
- 纯 JS、无原生/Rust 依赖 → 生产分词器可落地（选型：内嵌 `tokenizer.json` + 轻量 JS BPE，或复用 vetted JS 实现；属实施细节，非可行性障碍）。

### R-c 跨模态召回 sanity —— ✅ 通过（开门主判据）
- Ground-truth：4 张**主体明确真实照片**（cat 兔狲 / bee 花蕊采粉 / baklava 果仁蜜饼 / bicycle 白单车），逐张目测确认主体；文本查询各 1 条，应命中对应图。
- 三档精度 top-1 召回（`cross-modal.mjs`，复刻生产预处理 `sharp 224 cover→CHW→CLIP 归一` 与 `×127 int8` 量化）：

| 配对 | top-1 准确率 | margin（top1−top2） | 说明 |
|---|---|---|---|
| A fp32 塔 × fp32 塔 | **4/4 (100%)** | 0.103–0.235 | 基线 |
| B int8 塔 × int8 塔 | **4/4 (100%)** | 0.080–0.128 | 权重动态量化（生产图像塔即此） |
| C 存储 int8（×127 往返） | **4/4 (100%)** | 0.101–0.226 | 模拟 VectorsDB + 查询落库路径 |

- **正/负样本余弦分离（fp32）**：正样本 mean=0.322（min=0.283）vs 负样本 mean=0.120（max=0.180）→ 明显间隔，排序稳健。
- **A↔B、A↔C top-1 全一致**；单次全链（4 图 ×2 塔 + 4 文 ×2 塔）耗时 ≈3.2s。
- ⚠ **int8 权重保真不对称**：图像 fp32↔int8 余弦 0.968–0.982（高）；**文本 fp32↔int8 余弦低至 0.716**（较长查询）→ 文本塔对量化更敏感。

### 关键设计启示（写入正式 T22 方案）
- **非对称精度**：查询文本用 **fp32 文本塔**编码（每次检索仅一次前向，成本可忽略，规避 int8 文本漂移），图像侧维持 **int8**（批量存储 ×127）；余弦尺度无关，混合配对合法。
- 边界与保留：样本仅 4×4（sanity 非统计基准）；预处理 `lanczos3 cover` 非官方 bicubic（以相对排序判据）；中文查询弱（标准 CLIP），留 §16 Q2（Chinese-CLIP）另议。

### 判定：**开门（GO）** → 起草正式 T22 实施方案
R-a 契约清晰、R-b 离线分词可行、R-c 语义 top-1 三档精度全对且正负间隔明显、int8 退化可接受（并给出非对称精度规避方案）。下一步：按「先写方案、后确认再动手」惯例，起草正式 T22 实施方案（文本塔并入 ModelManager+SHA256、Node 分词器落 `src/main`、查询 IPC、结果并入 `searchStore`，并给 `VectorIndexService.search()` 首个生产调用方以清 W13 技术债），**待确认后再编码**。
