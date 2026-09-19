---
title: AI 插件化能力与爬虫模块方向性设计
description: Phase 8+ 插件化 AI（索引/修图/生图/补图）与图片采集的架构方向、宿主运行时、数据模型草案与风险验证清单
type: design
status: current
created: 2026-09-13
revised: 2026-09-13
updated: 2026-09-19
related_plan: ../archive/implementation-plan-2026-q3-q4.md
---

# AI 插件化能力与爬虫模块方向性设计（Phase 8+）

> **本文只定方向，不拆任务、不给工时。** 工时与任务级验收标准留待评审通过后的 `implementation-plan-2027-q1.md`。
> **需求来源**：[requirements.md](../../requirements.md) 第二阶段 5/6 节与 Phase 3 · [docs/roadmap.md](../roadmap.md) 第五节 #32-#36、#38
> **前序文档**：[implementation-plan-2026-q3-q4.md](../archive/implementation-plan-2026-q3-q4.md)（Phase 5-7，已全部完成）
>
> **实施状态（2026-09-19）**：本文仍为 Phase 9-11 的活跃方向设计。已落地部分：**Phase 8 已全部交付**（插件宿主/SDK/推理池/JobRunner/模型管理/三内置插件，含 2026-09-19 M1-M5 缺陷修复，分支 `fix/phase8-defects`；实施计划见 [archive/superpowers/plans/2026-09-13-phase8-ai-plugin-system.md](../archive/superpowers/plans/2026-09-13-phase8-ai-plugin-system.md)，人工验收进行中）。PoC 进底：R1/R3/R7 已回填实测值，R2/R4/R5/R6/R8/R9 待回填；§16 的 Q1/Q2/Q3/Q7 尚未决策。

---

## 摘要

Phase 1-7 已交付一个功能完整的本地图库查看器。下一阶段的两条候选主线——AI 能力与图片采集——共享同一批底层需求：数十小时级的后台作业、可取消可续跑的调度、独立于渲染进程的重负载执行环境。

本文锁定五项顶层决策：

1. **基础设施先行**——先建作业调度与插件宿主，再挂能力
2. **ONNX Runtime Node 本地推理**——跑在 `utilityProcess`
3. **插件化承载全部 AI 与爬虫能力**——核心应用不写死任何模型与站点
4. **批量流水线优先**——单图交互式编辑器延后
5. **「补图」三义全含**——画质补完 / 图集缺图补全 / 局部重绘，按成本分别归位

**架构主轴变更**：roadmap 第五节 #38「插件系统」由「远期待确认」升级为 **Phase 8 主轴**。AI 索引、AI 修图、生图、补图、爬虫站点适配全部以插件形态交付；核心应用只提供宿主能力（作业调度 / 推理会话 / 权限 / 蒙版 / UI 贡献点）。

这一决策的驱动力不是「插件化很酷」，而是一个具体的工程事实：**这些能力的失效频率远高于核心功能**。CLIP 模型每年换代、Real-ESRGAN 有新变体、扩散后端从本地到 ComfyUI 到云 API 层出不穷、目标网站随时改版。把它们写进 `image-service.ts` 意味着每次上游变动都要发一次 Luuk 版本；做成插件则变动被隔离在能力层。

---

## 1. 背景与范围

### 1.1 现状

| 项 | 状态 |
|---|---|
| Phase 1-7 | 全部完成，135 测试通过（见 [roadmap.md](../roadmap.md) 第七轮） |
| 已具备的可复用资产 | `media://` 流式协议 + HTTP Range、三级缩略图缓存、自研 DCT pHash + 汉明距离、标签系统与级联、`MIGRATIONS` + `schema_version` 迁移框架、`AbortController` Map 作业模式、直方图分析 |
| 尚不具备 | 后台作业持久化与断点续跑、原生推理运行时、插件加载机制、非破坏性编辑版本链 |

### 1.2 本文覆盖范围

覆盖 roadmap 第五节 #32（AI 标签）、#33（人脸识别）、#34（智能筛选）、#35（AI 修图）、#36（图片爬虫）、#38（插件系统），以及 requirements.md 第二阶段 5/6 节与 Phase 3。

#37（云同步）**不在本文范围**，仅在第 16 节列为未决策项。

### 1.3 本文不产出什么

- 工时估算与任务级拆解
- PoC 脚本（R1-R9 留待本文评审通过后单独排期）
- 具体扩散模型与 LoRA/ControlNet 方案选型
- 插件市场、代码签名、远程插件源的设计

---

## 2. 硬约束（选型的前提）

以下六项是选型的**前提**而非结论。任何违背它们的技术方案直接出局，不进入权衡。

| # | 约束 | 来源 | 对设计的强制影响 |
|---|---|---|---|
| C1 | 库规模 100 万-200 万张 / 10TB+ / 2-3 块硬盘 | requirements.md 用户场景表 | AI 全量索引是**数十小时级离线作业**，不是「点个按钮等几秒」的功能。必须有持久化、断点续跑、优先级调度 |
| C2 | 参考机 Ryzen 5 PRO 4650U（6C/12T，核显）+ 16GB + NVMe 512GB | [implementation-plan](../archive/implementation-plan-2026-q3-q4.md) 附录 A 实机采集 | **无独显**，CPU 推理为主，GPU 加速收益有限。这条直接决定了 D2 扩散类的可行性判定 |
| C3 | 性能红线：启动 <3s / 内存 <500MB / 滚动 ≥30FPS | [roadmap.md](../roadmap.md) 第九节 | 推理不得进渲染进程；向量不得全量常驻内存；插件宿主必须懒启动 |
| C4 | 内容为高清写真 | requirements.md | **上传原图不可接受**，本地优先。**例外**：纯文生图不上传任何原图，隐私风险 ≈ 0，可单独定策略（见 6.4） |
| C5 | 判别式与生成式算力差 2-3 个数量级 | 外部实测参考值，见 6.2 | 修图（单次前向）本地可做；生图/补图（迭代去噪 20-50 步）在无独显机器上不可做，必须走可替换的 provider 插件 |
| C6 | 单模型内存峰值可压穿红线 | rembg 4K 抠图外部实测峰值 510MB（Xeon E5-2680 v4 4C/8T，CPU-only） | 推理必须在 `utilityProcess`，且模型按需 load/unload，**必须有水位线与驱逐机制**（见 7.4） |

C6 值得单独强调：510MB 这个数字**已经超过 500MB 红线的全部预算**，而它只是一次 4K 抠图。这不是「优化一下就没事」的量级问题，而是必须由架构层面解决的约束——所以第 7 节的内存水位线不是可选优化，是必需组件。

---

## 3. 顶层决策记录

体例沿用 [implementation-plan](../archive/implementation-plan-2026-q3-q4.md) Task 5.0 / 7.1 的决策记录格式：**决策 / 理由 / 被否决的替代方案 / 失效条件**。

### D1 优先线：基础设施先行

| 要素 | 内容 |
|---|---|
| **决策** | 先建 JobRunner 后台作业子系统与插件宿主，再挂 AI 与爬虫能力 |
| **理由** | 两条主线共享同一批底层需求；跳过基础设施直接堆功能会导致每个 AI 特性各自实现一套进度/取消/续跑，重演 `scanner.ts` / `startPhashBackfill` / `export-service.ts` 三套各自为政的现状（见 4.1） |
| **被否决** | 跳过基础设施，先做一个能跑的 CLIP 标签功能证明价值 |
| **失效条件** | 若 R2 实测显示 CLIP 索引在 4650U 上根本跑不完（ETA 超过用户可接受的数天量级），则索引方向不成立，基础设施的必要性随之下降，应重新评估 |

### D2 推理运行时：ONNX Runtime Node

| 要素 | 内容 |
|---|---|
| **决策** | `onnxruntime-node`，跑在 Electron `utilityProcess` |
| **理由** | N-API ABI 稳定，与项目已有的 `sharp` / `better-sqlite3` 同一条打包路径；微软官方已有 Electron + WinML JS 绑定指南且明确「推理在实用工具进程中运行，因此不会阻止主进程」（见 7.3）；纯 JS/TS 插件无需捆绑 Python |
| **被否决** | ① Python sidecar 常驻（+数百 MB 体积，且 `environment.yml` 指定 `python>=3.14`，wheel 可用性存疑，见 R4）② transformers.js / WebGPU 进渲染进程（违反 C3，且 `onnxruntime-node` 的 WebGPU EP 仍为实验性未正式发布，该 EP 归属 `onnxruntime-web`）③ 云端作为主路径（违反 C4） |
| **失效条件** | PoC R1（打包）或 R2（本机吞吐）不通过 → 降级为纯传统算法（autotone 仍可交付）或改走 Python sidecar |

> **WebGPU 路线已归档**，不作为 R6 兼容性矩阵的待测项。仅当 R6 全线失败时重新评估，且届时路径只能是「隐藏窗口 + onnxruntime-web」，与本文的 `utilityProcess` 原生路线互斥。

### D3 能力承载方式：全部以插件形态交付

| 要素 | 内容 |
|---|---|
| **决策** | AI 索引、AI 修图、生图、补图、爬虫站点适配**全部以插件形态交付**，核心应用不写死任何具体模型与站点。首批能力用**内置插件**交付（随包分发，但仍是插件形态） |
| **理由** | ① 这些能力的上游变动频率远高于核心功能，插件化把变动隔离在能力层 ② 内置插件用真实功能驱动 API 设计，避免造出无人使用的空框架 ③ 一次性解决「无独显用户看不到跑不动的功能」——通过能力 ↔ Provider 解耦（见 5.5） |
| **被否决** | 把 CLIP / 超分 / 站点适配直接写进 `image-service.ts` |
| **失效条件** | R9 显示 API 面无法在 3 个内置插件内收敛（即每加一个插件就要改一次 SDK），说明抽象层级错了，应退回「核心内置 + 少量扩展点」 |

### D4 修图产品形态：批量流水线优先

| 要素 | 内容 |
|---|---|
| **决策** | 多选 / 右键文件夹 → 批量 op → 输出副本目录。单图交互式编辑器延后至蒙版体系就绪（Phase 10） |
| **理由** | 批量流水线可复用现有 `export-service.ts` 的 AbortController + 进度事件 + 单项失败不中断模式，以及 `CompareViewer.tsx` 的前后对比；而单图编辑器 UI（图层、蒙版画笔、历史记录、参数实时预览）的工作量比 Phase 5-7 总和还大 |
| **被否决** | 先做编辑器 UI，让 AI 修图像 Photoshop |
| **失效条件** | 若用户实测反馈「批量结果不满意但无法单图微调」成为主要阻塞，则 Phase 10 的编辑器需提前 |

### D5 「补图」三义全含

「补图」在讨论中含义模糊，本节明确拆为三个独立能力，按成本与依赖分别归位：

| 子义 | 含义 | 归属 | 可行性 |
|---|---|---|---|
| ① 画质补完 | 超分 / 去噪 / 去压缩伪影 | D1 轻量修复类（引擎分层见 6.1） | **本地可做**，Phase 8 |
| ② 图集缺图补全 | 检测图集残缺 → 爬虫补齐缺失页 | AI × 爬虫交叉能力，归第 12 节 | 本地可做，Phase 10 |
| ③ 局部重绘 / 扩图 | inpainting / outpainting | D2 扩散生成类 | **本地 CPU 不可做**，需 provider 插件，Phase 11 |

三者共享的前置是**蒙版体系**（②的连续性检测除外），故第 8 节把蒙版单列为独立基础设施。

---

## 4. 共享基础设施 A：JobRunner 后台作业子系统

### 4.1 现状问题

项目目前有三套互不相干的「后台任务」实现：

| 位置 | 模式 | 问题 |
|---|---|---|
| `src/main/services/scanner.ts` | `BATCH_SIZE = 10` + `Promise.allSettled` + 批量进度事件 | 有进度，但无持久化，中断即重来 |
| `src/main/services/image-service.ts` `startPhashBackfill` | **单槽位** `backfillRunning: { libraryId, stopped }` 内存字段 + `BATCH_SIZE = 100` + `setImmediate` 让权 | **单槽位 + 内存态 + 无断点**。进程重启后 `backfillRunning` 丢失，已完成进度不落库，必须从头再扫 |
| `src/main/services/export-service.ts` | `abortControllers` Map + 流式 + 单项失败不中断 | 模式最成熟，但只服务导出，无法复用 |

`startPhashBackfill` 是关键反面教材：pHash 回填一个百万级库本身就要跑很久，而它**没有任何持久化**。AI 索引作业的时长是它的十倍以上——沿用这个模式，一次意外退出就意味着数十小时白跑。

### 4.2 抽象设计

```
Job（作业）      1 ─── n     JobItem（作业项）
```

**状态机**：`pending → running → done | failed | skipped | paused`

`paused` 是一等状态而非 `running` 的变体——它区分「用户主动暂停」与「系统资源闸门暂停」，两者恢复条件不同。

**接口签名草案**：

```typescript
enqueue(kind: string, payload: unknown, priority?: number): Promise<string /* jobId */>
pause(jobId: string): Promise<void>
resume(jobId: string): Promise<void>
cancel(jobId: string): Promise<void>
subscribeProgress(jobId: string, cb: (p: JobProgress) => void): () => void
```

### 4.3 持久化 schema 草案

走 `database.ts` 已有的 `MIGRATIONS` + `schema_version` 机制，作为**迁移 v2**，存 master.db：

```sql
CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,          -- 'ai.clip-index' | 'ai.upscale' | 'crawler.download' ...
  state       TEXT NOT NULL,          -- pending|running|paused|done|failed|cancelled
  priority    INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  payload     TEXT,                   -- JSON，作业参数
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE job_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  library_id  INTEGER NOT NULL,
  image_id    INTEGER,
  state       TEXT NOT NULL,          -- pending|running|done|failed|skipped
  attempt     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_job_items_state ON job_items(job_id, state);
```

**重启恢复规则**：进程启动时将所有 `state = 'running'` 的 job 与 job_item 批量改为 `'paused'`，由用户手动续跑或空闲检测自动续跑。**不自动恢复为 running**——避免用户刚打开应用就被后台任务抢占 CPU，违反 C3 的启动 <3s。

### 4.4 资源闸门

| 闸门 | 规则 |
|---|---|
| 线程数 | 推理线程 = `max(1, cores - 2)`，给系统与 UI 留 2 核 |
| 空闲检测 | `powerMonitor.getSystemIdleTime()`：空闲时全速，用户操作时降速 |
| 电源事件 | `powerMonitor` 的电池 / 省电事件 → 暂停作业 |
| 网络并发 | 网络类作业 per-host 并发上限（爬虫见 12.3） |
| 内存水位 | 与第 7.4 节共用同一机制，超红线暂停作业 |

### 4.5 收编路线：先并存后迁移

Phase 8 **只要求 AI 与爬虫走 JobRunner**。`scanner` / `phash backfill` / `export` 保持现状不动，Phase 9+ 再逐个收编。

理由：这三个模块已通过 135 个测试，同时重构它们与新建 JobRunner 会把回归风险和新建风险叠加。先让新代码验证抽象是否正确，再迁移旧代码。

> 这也回答了「现有系统如何迁移到插件架构」——**它们不迁移**。`scanner.ts` / `image-service.ts` / `export-service.ts` 是核心能力，不是插件。只有新增的 AI 与爬虫能力以插件形态交付。JobRunner 是它们未来可选的收编目标，与插件化无关。

### 4.6 作业通道二分

这是本节最重要的设计约束：

| 通道 | 适用 | 机制 |
|---|---|---|
| **批处理通道** | 全量索引、批量修图、批量下载 | 走 JobRunner，持久化、可断点续跑、受资源闸门约束 |
| **交互式通道** | 单图一次扩散生成、单图超分预览 | **同步请求 + 可取消，不进 Job 队列** |

若交互式请求也进 Job 队列，用户点一张图做超分时要先排完前面万张批量任务的队列——这是不可接受的。**交互式请求可插队到批处理之前**（见 7.5）。

---

## 5. 共享基础设施 B：插件系统架构（Phase 8 核心）

本节是 D3 的落地。

### 5.1 双宿主模型

| 宿主 | 承载 | 实现 |
|---|---|---|
| **Worker 宿主** | 推理 / 下载 / 批处理插件 | Electron `utilityProcess.fork()` 独立 Node 子进程，RPC 走 MessagePort。崩溃可 kill 重启，不影响主窗口与 `media://` |
| **UI 贡献** | 面板 / 菜单项 / 参数表单 | **声明式清单驱动、宿主渲染**。插件只提供 JSON Schema + 回调，**不向渲染进程注入任意代码** |

**关键决策：插件宿主 = 推理宿主，同一进程模型。** 不分成两个进程。理由：插件的主要负载就是推理，分两个进程意味着模型数据要跨进程传输，而图像张量体积巨大。

UI 贡献走声明式而非注入式，是本设计的安全边界——它保证第三方插件无法在渲染进程执行任意代码，即使插件本身在 Worker 宿主里拥有 Node 权限。

### 5.2 插件清单 `plugin.json`

```jsonc
{
  "id": "builtin.upscale",
  "name": "超分辨率",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",              // semver，与宿主协商
  "kind": "ai-transform",              // 见下方枚举
  "entry": "index.js",
  "capabilities": ["image.upscale"],
  "requires": {
    "runtime": "onnx",
    "gpu": false,                      // true 则无独显时 isAvailable() = false
    "models": [{ "id": "realesr-general-x4v3-w8a8", "size": 1250000, "sha256": "..." }]
  },
  "contributes": {
    "ops": [{ "id": "upscale.x4", "capability": "image.upscale", "params": { /* JSON Schema */ } }],
    "menuItems": [{ "op": "upscale.x4", "label": "超分 ×4", "context": ["grid-multi", "folder"] }],
    "settings": [ /* JSON Schema */ ],
    "panels": []
  },
  "permissions": ["library.read", "fs.write.output", "inference"]
}
```

**`kind` 枚举**（五种，封闭集合）：

| kind | 职责 | 典型 |
|---|---|---|
| `ai-index` | 只读分析 → 写元数据 | `builtin.clip-index` |
| `ai-transform` | 读图 → 生成新文件 | `builtin.upscale`、`builtin.matting`、`builtin.autotone` |
| `diffusion-provider` | 提供扩散生成后端 | `provider.local-diffusion`、`provider.comfyui`、`provider.cloud` |
| `crawler-adapter` | 站点解析适配 | 各站点适配插件、通用规则引擎 |
| `ui-panel` | 纯声明式 UI 贡献 | 统计面板等 |

### 5.3 SDK API 面（`luuk.*`）最小集

| API | 用途 | 所需权限 |
|---|---|---|
| `luuk.library` | 只读查询图片 / 元数据 / 库状态；写入走具名方法（如 `writeEmbedding`） | `library.read` / `library.write` |
| `luuk.fs` | 受限读写：**读限已注册库，写限指定输出目录**，复用 `file-service.ts` 现有「路径必须在已注册库范围内」校验 | `fs.read.library` / `fs.write.output` |
| `luuk.inference` | **向宿主申请 ONNX 会话**（见 5.4） | `inference` |
| `luuk.image` | `sharp` 封装：解码 / 编码 / 分块 / resize / 归一化 | `image` |
| `luuk.jobs` | 注册批处理作业到 JobRunner | `jobs` |
| `luuk.edit` | 写入 `edits` 版本链（见 8.2） | `edit.write` |
| `luuk.browser` | 宿主提供的隐藏 `BrowserWindow` 抓取能力 | `browser` |
| `luuk.fetch` | 受域名白名单约束的网络请求 | `fetch` |
| `luuk.mask` | 申请蒙版（见 8.4） | `mask` |
| `luuk.progress` / `luuk.log` / `luuk.settings` | 进度上报 / 日志 / 插件私有设置命名空间 | 无需声明 |

### 5.4 关键决策：插件不直接依赖 `onnxruntime-node`

**一律经 `luuk.inference` 向宿主申请会话。** 三条理由：

1. **体积**——避免每个插件捆绑一份 native 运行时
2. **统一管控**——只有宿主能做统一的模型 load/unload、内存水位线、EP 选择（CPU / DirectML / WinML）、并发排队。若插件各自持有会话，第 7.4 节的内存治理根本无法实施
3. **门槛**——插件可为纯 JS/TS，第三方开发不需要处理 native 编译

这条决策是第 7 节所有内存与并发治理能成立的前提。

### 5.5 能力 ↔ Provider 解耦（本设计最关键的一环）

op 声明 `requires.capability`（如 `diffusion.inpaint`），宿主路由到任意 `isAvailable()` 返回真的 provider 插件。**provider 不可用 → 该 op 在 UI 自动隐藏，而非报错。**

一次机制解决四个问题：

| 问题 | 解法 |
|---|---|
| 无独显用户看到跑不动的功能 | `provider.local-diffusion` 探测硬件，无独显则 `isAvailable() = false`，相关 op 自动隐藏 |
| 云端隐私提示该在哪出现 | 只在 `provider.cloud` 被选中时出现，不污染本地路径 |
| ComfyUI 用户 | 自装 `provider.comfyui`，核心无需改动 |
| 未来接新后端 | 新增一个 provider 插件即可，核心零改动 |

**具体例子**：用户在无独显的 4650U 机器上打开右键菜单，「局部重绘」这一项**根本不出现**——不是灰掉、不是点了报错，而是不存在。装了 ComfyUI 并启用对应插件后，同一项自动出现。

### 5.6 权限模型

声明式 `permissions[]` + 安装时授权 UI（显示清单，用户可见插件要什么）。

**必须诚实写明：Node 插件做不到真沙箱。** 权限系统是**契约与事故防线**，不是安全边界——它防止的是插件因 bug 误写库外文件，不防止恶意插件。`utilityProcess` 提供的隔离是**崩溃隔离**，不是**权限隔离**。

现有的真实边界只有两条，都必须守住：
- UI 贡献走声明式，插件无法向渲染进程注入代码（5.1）
- `luuk.fs` 的路径校验复用 `file-service.ts` 现有逻辑，越界路径直接拒绝

### 5.7 插件生命周期

```
discover → validate → activate → idle/unload → deactivate
```

| 阶段 | 行为 |
|---|---|
| `discover` | 扫内置目录 + `%APPDATA%\luuk\plugins\`，读 `plugin.json` |
| `validate` | `apiVersion` semver 协商、`kind` 合法、`permissions` 与已授权记录比对、`entry` 存在 |
| `activate` | **惰性**：仅当该插件的 op 被调用或其 capability 被请求时才载入宿主进程 |
| `idle/unload` | 空闲超时释放会话（与 7.4 驱逐机制联动） |
| `deactivate` | 用户停用，或崩溃熔断（连续崩溃 N 次后禁用并告知） |

**校验失败不得让宿主进程整体启动失败**——只标记该插件 `invalid` 并在设置面板列出原因。一个坏插件不该让整个 AI 功能不可用。

### 5.8 分发与更新

| 项 | 方案 |
|---|---|
| 内置插件 | 随包分发。**需确认 `electron-builder.json` 的 `files` 规则包含插件目录**（当前只含 `dist/**` 与 `dist-electron/**`） |
| 第三方插件 | `%APPDATA%\luuk\plugins\{id}\` |
| registry | 清单 JSON。可先用 npm 包作为分发通道，降低自建成本 |
| UI 区分 | 内置与第三方在设置面板明确标识 |

**更新的真实载体**：Phase 8 不做远程插件源，故第三方插件更新 = **用户手动替换 `%APPDATA%\luuk\plugins\{id}\` 目录，需重启插件宿主进程生效，不是运行时热替换**。内置插件更新随应用发版。

> 措辞纪律：不得写成「插件热更新无需发版」。爬虫插件化的真实论据是「站点改版时用户/第三方可自行替换适配插件，无需等待 Luuk 发版」——这仍然足够有力，但不夸大。

### 5.9 API 版本治理

- `apiVersion` semver 协商 + 宿主兼容层 + deprecation 策略
- **纪律：API 必须由 2-3 个真实内置插件驱动定型后才冻结。** Phase 8 内允许破坏性变更，Phase 9 起进入兼容承诺
- **废弃流程**：标记 deprecated → 保留至少一个 Phase（含宿主兼容层转发 + 日志告警）→ 次一 Phase 移除
- `plugin.json` 的 `apiVersion` 低于宿主支持下限时，插件**不激活**并给出明确升级提示，**不做静默降级**

### 5.10 首批内置插件清单

用真实功能验证 API，而非先造框架再找用例：

| 插件 | 模型 | 为什么是它 |
|---|---|---|
| `builtin.autotone` | **零模型** | 复用已有 `histogram.ts` 直方图 + `sharp` 做曝光/对比度/白平衡自动修正。以最小代价验证 op / job / edit 全链路 |
| `builtin.matting` | U2-Net（`u2netp` 4.7MB） | 验证 `luuk.inference` + 模型下载 + 内存治理 |
| `builtin.upscale` | Real-ESRGAN（`realesr-general-x4v3` w8a8 1.25MB） | 验证分块推理 + 大图防护 |
| `builtin.clip-index` | CLIP/SigLIP | 验证 `ai-index` kind + 向量写入 + JobRunner 长作业 |

### 5.11 插件测试策略

| 类别 | 内容 |
|---|---|
| **SDK 契约测试** | 用一个 `test-plugin` 桩插件覆盖 `luuk.*` 每个 API 的正常 / 越权 / 异常三分支，进 `src/__tests__/` 随 CI 跑 |
| **EP 兼容测试** | 同一模型在 CPU EP / DirectML / WinML 下输出张量的最大绝对误差阈值校验（量化模型放宽阈值） |
| **权限拒绝测试** | 声明外路径读写、自开 `BrowserWindow`、直连 `onnxruntime-node` 三种违规必须被拒 |
| **输出黄金样本** | `autotone` / `matting` / `upscale` 各一张固定输入图的参考输出，容差比对 |

**不做**插件性能基准排行榜——没有生态，投入无回报。

### 5.12 Phase 8 边界（明确不做）

- 不做插件市场 UI
- 不做代码签名
- 不做远程插件源
- 不做注入式 UI 插件（仅声明式贡献点）
- 不做运行时热替换插件

---

## 6. AI 能力分层与算力现实

### 6.1 引擎矩阵

| 引擎 | 能力 | roadmap | 类别 |
|---|---|---|---|
| **A** CLIP / SigLIP | 图文嵌入：AI 标签、语义搜索、以图搜图、智能聚类 | #32 | 索引类 |
| **B** 人脸检测 + 识别 | 人物分组、人脸聚类 | #33 | 索引类 |
| **C** 无参考 IQA | 构图 / 清晰度 / 曝光评分，智能筛选最佳照片 | #34 | 索引类 |
| **D1** 轻量修复类 | 超分 / 去水印 / 抠图 / 调色 / 磨皮 / 老照片修复 | #35（D1 部分） | 变换类 |
| **D2** 扩散生成类 | 生图 / 图生图 / 局部重绘 / 扩图 | #35（D2 部分） | 变换类 |

**索引类 vs 变换类**是本设计的第二条主轴（第一条是插件化）：

| | 索引类（A/B/C） | 变换类（D1/D2） |
|---|---|---|
| 数据流 | 只读分析 → 写元数据 | 读原图 → **生成新文件** |
| 共享设施 | 流水线 / 向量存储 / 失效机制 | `edits` 版本链 / 蒙版体系 |
| 与现有代码同构于 | `scanner.ts` + 标签系统 | `export-service.ts` |
| UI 复用 | `SearchPanel` / `SortControl` / `TagCloudPanel` | `CompareViewer.tsx`（前后对比） |

### 6.2 算力对照表

> **全部为外部实测参考值，非本机数据。** 每项标注来源硬件。本机（4650U）数字待 PoC R2/R7 回填，**禁止填估算值**。

| 模型 / 任务 | 耗时 | 来源硬件 | 类别 |
|---|---|---|---|
| SigLIP 图文嵌入 | 26.28 ms/张 | i9 桌面 CPU，ORT 1.25.1（OpenCV 5 DNN Benchmarks） | A |
| YuNet 人脸检测 | 2.34 ms | 同上 | B |
| RetinaFace 人脸检测 | 21 ms | 同上 | B |
| U2-Net 抠图 | ~100 ms（中等输入） | 同上 | D1 |
| rembg 抠图 1080p / 4K / 5K | 3.6s / 13.2s / 22.4s | Xeon E5-2680 v4（4C/8T，CPU-only） | D1 |
| rembg 峰值内存 | **380-620MB（4K 达 510MB）** | 同上 | D1 |
| BiRefNet 抠图 | 9503 ms | i9 桌面 CPU | D1（偏慢，不选） |
| Real-ESRGAN 超分 | 580 ms（小输入） | i9 桌面 CPU | D1 |
| SwinIR 超分 | 164.7 ms（小输入） | i9 桌面 CPU | D1 |
| 老照片修复全流程 | 19.5s @2400×1600（CPU）vs 4.9s（GPU） | i7-11800H | D1 |
| **SAM2 encoder / decoder** | **2280 ms / 10.94 ms** | i9 桌面 CPU | 蒙版 |
| NAFNet | 1518 ms | i9 桌面 CPU | D1 |
| **SD1.5 FP16** | **5.8-9.0 s/张** | RTX PRO 2000 **独显** | D2 |
| SD1.5 INT8 | 2.3-3.7 s/张 | 同上（独显） | D2 |
| **SD1.5 CPU 推算** | **2-10 分钟/张** | 由独显数据外推，**非实测** | D2 |
| SDXL / Flux 模型体积 | 6.5GB / 23GB | — | **超出 16GB 内存预算** |

### 6.3 由表得出的三条硬结论

1. **D1 全部本地可行**——秒级到数十秒。单图可等待，批量可跑夜。1080p 抠图 3.6s、超分 580ms、老照片修复 19.5s，都在用户可接受范围
2. **D2 在无独显机器上不可行**——独显 5.8-9s 的活，CPU 要 2-10 分钟一张；SDXL/Flux 模型体积直接超出 16GB 内存。**必须 provider 插件化**（6.4）
3. **抠图 4K 内存峰值已压 500MB 红线**——510MB > 500MB。**强制 `utilityProcess` + 按需 load/unload + 水位线驱逐**（7.4）

### 6.4 D2 三 provider 插件对照

| provider | 后端 | 隐私 | 代价 | 前置条件 |
|---|---|---|---|---|
| `provider.local-diffusion` | WinML / DirectML / CUDA | **原图不出本机** | 包体与显存 | 探测硬件，无独显则 `isAvailable() = false` |
| `provider.comfyui` | 用户自装 ComfyUI，插件做 HTTP 客户端 | 原图不出本机 | 用户需自行安装 | 生态最全，含 LoRA / ControlNet |
| `provider.cloud` | 云 API | **分场景，见下** | 按量付费 | 网络 |

**cloud provider 的隐私策略必须区分两种场景**：

| 场景 | 是否上传原图 | 默认策略 |
|---|---|---|
| **纯文生图** | **不上传任何原图** | **默认启用**——隐私风险 ≈ 0，与 C4 不冲突 |
| **补图 / 图生图 / 局部重绘** | **需上传原图** | **默认关闭 + 强提示**——内容为高清写真，违反 C4 |

这个区分是 C4 约束下唯一能让云端能力落地的方式。

### 6.5 D1 各项技术路径

| 能力 | 技术路径 | 备注 |
|---|---|---|
| 超分 | Real-ESRGAN / SwinIR | **大图必须分块推理**（如 128px 块 + 8px 重叠） |
| 抠图 | U2-Net / ISNet | 优于 BiRefNet（后者 9.5s 偏慢） |
| 去水印 | **LaMa** | **单次前向 inpainting，非迭代去噪，故 CPU 可行**。LaMa 训练于 **256×256** 但具 **resolution-robust** 特性，可泛化至 ~2k——**不是固定输入尺寸**（arXiv `2109.07161`） |
| 磨皮 | 双边滤波 / 表面模糊 | **传统算法，不需要 AI** |
| 瘦脸 | 人脸关键点 + 网格形变 | 依赖引擎 B |
| 老照片修复 | 多模型串联 | 做成带进度的批处理作业 |
| 自动调色 | `src/main/utils/histogram.ts` 直方图 + `sharp` | **零模型**，见 6.6 |

IQA（引擎 C）实现参考 `chaofengc/IQA-PyTorch`（即 `pyiqa`，含 MUSIQ / MANIQA / CLIPIQA / DBCNN）。**注意它本身是 PyTorch 推理库，ONNX 需自行导出**，不是官方提供 ONNX 版本；导出成本计入 R2 PoC。

### 6.6 D1 零成本起步项：自动调色不需要 AI

复用已有的 `src/main/utils/histogram.ts` 直方图分析 + `sharp`，做曝光 / 对比度 / 白平衡自动修正。

这是**第一个内置插件**的最佳候选：零模型下载、零推理耗时、零内存风险，却能完整验证 op 声明 → 右键菜单贡献 → JobRunner 批处理 → `edits` 版本链 → `CompareViewer` 前后对比的全链路。**用它把插件框架跑通，再上有模型的插件。**

### 6.7 模型选型待决

中文查询场景需评估 **Chinese-CLIP**（标准 OpenAI CLIP 中文能力弱，论文 `2211.01335` 确认其在中文原生数据集 MUGE 上显著优于标准 CLIP）。与 MobileCLIP / ViT-B-32 / SigLIP 构成精度-速度-中文能力三角，详见第 16 节未决策项。

---

## 7. 插件宿主与推理运行时

### 7.1 进程拓扑

```
┌──────────────────────┐   IPC    ┌─────────────────────────┐
│  主进程               │◄────────►│  渲染进程（React UI）    │
│  窗口 / IPC / DB      │          │  仅通过 IPC 访问数据     │
│  media:// 协议        │          └─────────────────────────┘
└──────────┬───────────┘
           │ MessagePort RPC
           ▼
┌──────────────────────────────────────────┐
│  utilityProcess 插件宿主                  │
│  插件加载 / ONNX 会话池 / 模型缓存         │
│  资源闸门 / 内存水位线 / JobRunner 执行器  │
└──────────────────────────────────────────┘
```

**推理与插件代码都不进主进程**——避免阻塞 IPC 与 `media://` 流式响应，那会直接违反 C3 的 ≥30FPS 滚动红线。

### 7.2 模型分发

**运行时按需下载**到 `%APPDATA%\luuk\models\`，含清单 JSON（名称 / 版本 / 大小 / SHA256 / 来源 / 镜像）、下载前确认 UI、支持离线手动放置。

理由：`electron-builder.json` 的 `files` 仅含 `dist/**` 与 `dist-electron/**`，**模型不得进包**。

### 7.3 运行时选型：双运行时策略

**新发现（影响 R6）**：ONNX Runtime 官方已将 **DirectML EP 标注为 "sustained engineering"，新 Windows 项目推荐 WinML**（`Microsoft.AI.MachineLearning`）。

| 项 | WinML | 约束 |
|---|---|---|
| 优势 | 系统级共享 ORT + 动态下载 EP（CPU / DirectML / QNN NPU），显著减小包体 | — |
| 依赖 | Windows App SDK 2.x | `onnxruntime-node` 版本须与其 ORT ABI 匹配（2.x → **`1.24.x`**） |
| 平台 | NPU / 厂商 EP 要求 **Win11 24H2+** | 而 requirements 目标平台**含 Win10** |

微软官方已有 **Electron + WinML JS 绑定指南**，且明确「推理在 Electron 实用工具进程中运行，因此不会阻止主进程」——**与本文的 `utilityProcess` 决策完全一致**，作为直接依据引用。

**结论：双运行时策略**

| 层 | 方案 | 覆盖 |
|---|---|---|
| **基线** | `onnxruntime-node` + CPU EP | Win10 / Win11 全量，**必须有** |
| **加速** | WinML / DirectML EP（经 `luuk.inference` 切换） | Win11 24H2+ 且有 GPU/NPU |

**EP 选择对插件透明**——插件只调 `luuk.inference`，不知道也不关心底层跑在哪个 EP 上。这是 5.4 决策的直接收益。

### 7.4 内存水位线与自动驱逐

针对 C6（单模型可压穿红线）的必需组件，不是可选优化。

**监控**：宿主定时（每 5s）读 `process.memoryUsage().rss` + `app.getAppMetrics()`，写入环形缓冲供 UI 展示。

**三级水位线**：

| 水位 | 阈值 | 行为 |
|---|---|---|
| 🟢 绿 | <300MB | 正常 |
| 🟡 黄 | 300-400MB | 停止预加载，不再接受新会话常驻 |
| 🔴 红 | >400MB | **立即按驱逐顺序 unload 直到回落绿区**，并暂停 JobRunner（与 4.4 资源闸门共用同一机制） |

**驱逐顺序**：

1. `refCount = 0` 的空闲会话（按 `lastUsedAt` 升序）
2. 已完成的批处理模型
3. 当前交互 op 的模型（**仅当仍超红且已向用户告警**）

> **渲染进程与主进程内存计入全局预算**，不是只看宿主进程。500MB 红线是应用整体的，不是单进程的。

**大图防护**：输入分辨率超阈（如 >4K）时**强制分块推理**，单块内存可预估；分块尺寸与重叠区写入模型清单 JSON。

### 7.5 推理会话池与并发控制

| 项 | 策略 |
|---|---|
| **会话缓存** | 宿主维护 `Map<modelId, { session, refCount, lastUsedAt, residentMB }>`。同一模型多插件**共享一个 `InferenceSession`**——会话创建成本 ~秒级，不得每请求重建 |
| **线程配置** | 全局 `intra_op_num_threads = max(1, cores - 2)`（与 4.4 一致），`inter_op_num_threads = 1` |
| **并发上限** | **并发会话数上限 = 1**——同一时刻只允许一个模型占用推理线程池，多 op **排队而非并行**。6C/12T 上并行推理会互相抢线程，导致总吞吐下降 |
| **队列优先级** | 沿用 JobRunner 优先级语义（当前可见 / 收藏 > 全量回填）；**交互式单图请求插队到批处理之前**（对应 4.6） |

**首次延迟处理**：会话创建 ~秒级，采用**惰性加载**（见 5.7 `activate`），并在 UI 明示首次延迟。**不做猜测式预热**（如「空闲时预加载最常用的 3 个模型」）——在 500MB 红线下白占内存的代价高于省下的首次延迟。

### 7.6 模型权重量化策略

**原则：优先选上游已量化好的权重，不自己做量化。** 自量化需要校准数据集与精度回归验证，成本超出本项目范围。

| 模型 | 量化方案 | 理由 |
|---|---|---|
| CLIP / SigLIP | **FP16 优先** | 精度敏感——嵌入向量失真**直接污染检索结果**，且不可见（用户不知道搜不准是量化导致的） |
| Real-ESRGAN | **`realesr-general-x4v3` 的 w8a8 INT8** | 外部参考：4.65MB → 1.25MB（约 73% 减小），画质损失可接受 |
| U2-Net | **`u2netp`（4.7MB）优先于 `u2net`（176MB）** | 体积差 37 倍，抠图质量在写真场景足够 |
| LaMa / SAM2 | **FP32 基线** | 内存超红时才考虑 FP16 |

**约束**：
- **量化误差必须进 5.11 的 EP 兼容测试阈值**
- 同一 capability 允许挂多个不同量化级的 provider（如 `upscale.fast` / `upscale.quality`），由用户选
- **不得把向量量化与模型量化混为一谈**——前者（第 9 节的 int8 embedding）影响检索召回，后者影响输出画质，**两者失败模式不同，必须分别评估**

### 7.7 离线与下载失败路径

| 项 | 方案 |
|---|---|
| 断点续传 | `.part` 临时文件 + **HTTP Range**（复用 `electron/main.ts` 中 `media://` 的 Range 处理经验） |
| 重试策略 | 指数退避 3 次 → 切换下一个镜像 → 全部镜像失败则**保留 `.part`** 并提示用户手动下载放置 |
| 完整性 | 下载后 **SHA256 校验不通过则删除重下，不得载入** |
| **首次使用** | **无需联网**。所有 AI 能力在模型未就绪时 op 在 UI 隐藏（第 13 节），**核心看图功能不依赖任何下载** |

### 7.8 打包注意

`electron-builder.json` 中 **`npmRebuild: false`**，`onnxruntime-node` 依赖 N-API ABI 稳定性（与 `sharp` / `better-sqlite3` 同路径）。`build:dir` 与 nsis 双通道均需 PoC R1 验证，必要时补 `asarUnpack`。

预处理复用现有 `sharp`，**不引入 jimp 等新图像库**。

---

## 8. 非破坏性编辑与蒙版体系

变换类能力（D1/D2）的前提。

### 8.1 底线：原图绝对不修改

本地图库的不可协商底线，与 `file-service.ts` 的软删除 + 补偿式一致性设计一脉相承。所有变换类 op 输出**新文件**，原图字节不变。

### 8.2 `edits` 版本链 schema 草案

master.db 迁移 v2 的一部分：

```sql
CREATE TABLE edits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id     INTEGER NOT NULL,
  image_id       INTEGER NOT NULL,
  plugin_id      TEXT NOT NULL,        -- 产生此编辑的插件
  op             TEXT NOT NULL,        -- 'upscale.x4' | 'matting' | 'inpaint' ...
  params         TEXT,                 -- JSON，op 参数
  model_id       TEXT,                 -- 使用的模型（零模型 op 为 NULL）
  output_path    TEXT NOT NULL,
  parent_edit_id INTEGER,              -- ← 构成树而非链
  created_at     TEXT NOT NULL
);
```

**`parent_edit_id` 构成树而非链**——允许多方案并存（同一原图分别试 ×2 与 ×4 超分）、从任意历史节点派生（不满意某次结果时回到其父节点重做，而非从头开始）。

### 8.3 输出落地方案（两选一，待定）

| 方案 | 形式 | 代价 |
|---|---|---|
| ① 库内子目录 | `{库根}/_edits/{原文件名}/{op}_{timestamp}.png` | **`scanner.ts` 需排除 `_edits` / `_downloads` 前缀目录**，避免自我递归入库（记为待确认改动点） |
| ② 独立输出库 | 单独的「编辑输出库」 | 需新增库管理 UI，跨库引用 |

倾向 ①，但必须先确认 scanner 的排除逻辑改动量。列入第 16 节未决策项。

### 8.4 蒙版三来源

蒙版是补图 / 去水印 / 瘦身的**共同前置**：

| 来源 | 机制 | 落地期 |
|---|---|---|
| ① 手工画笔 | 编辑器 UI 涂抹 | Phase 10（依赖 EditViewer） |
| ② **SAM2 交互式分割** | 点选即出蒙版。CPU 实测 **enc 2.3s / dec 11ms**——编码器一次、解码器多次的架构天然适合交互场景，体验可接受 | Phase 10 |
| ③ 自动 | 水印检测、U2-Net alpha 直接作 mask | Phase 8-9（无需 UI） |

> SAM2 的 2.3s 编码器耗时是 **CPU 实测值**（i9 桌面 CPU，OpenCV 5 DNN Benchmarks）。网上流传的 ~250ms 量级是 GPU 数据，**不得用于 CPU 可行性论证**。

### 8.5 蒙版存储

```sql
CREATE TABLE masks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id  INTEGER NOT NULL,
  image_id    INTEGER NOT NULL,
  source      TEXT NOT NULL,          -- 'manual' | 'sam2' | 'auto-watermark' | 'auto-alpha'
  data        BLOB NOT NULL,          -- PNG 单通道 RLE 压缩
  created_at  TEXT NOT NULL
);
```

**同一蒙版可复用于多次 op**——用户点一次 SAM2 分割出人物，之后可以既做背景虚化又做局部重绘，不必重复分割（这在 CPU 上每次要 2.3s）。

### 8.6 结论：蒙版体系应早于扩散能力落地

Phase 10 先做蒙版 + LaMa 去水印（D1，CPU 可行），Phase 11 才接 D2 provider。

理由：蒙版是 D2 的**输入通道**，没有蒙版体系，inpainting/outpainting 根本无法交互；而蒙版本身配上 LaMa 就能独立产出用户价值（去水印），不必等扩散后端定案。

---

## 9. 向量与元数据存储设计

### 9.1 存储位置：每库 `.ivlib/thumbs.db`，而非 master.db

| 理由 | 说明 |
|---|---|
| 随库可插拔 | 向量与图片同生共死，拔走硬盘带走索引 |
| 复用 Phase 1 路径级联 | 库移动 / 重命名时的级联更新逻辑已存在 |
| 离线库不污染全局 | 未挂载的库不会拖慢全局查询 |
| 避免 master.db 膨胀 | 200 万条 embedding 会让 master.db 涨到 GB 级，拖慢所有全局操作 |

### 9.2 schema 草案（thumbs.db 侧迁移）

```sql
CREATE TABLE image_embeddings (
  image_id    INTEGER PRIMARY KEY,
  model_id    TEXT NOT NULL,          -- 产生此向量的模型，见 9.6
  dim         INTEGER NOT NULL,       -- 如 512
  quant       TEXT NOT NULL,          -- 'int8' | 'float32'
  vector      BLOB NOT NULL,
  created_at  TEXT NOT NULL,
  dirty       INTEGER NOT NULL DEFAULT 0   -- 原文件变动后置 1
);

CREATE TABLE quality_scores (
  image_id     INTEGER PRIMARY KEY,
  total        REAL,
  sharpness    REAL,
  exposure     REAL,
  composition  REAL,
  model_id     TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE faces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id    INTEGER NOT NULL,
  box         TEXT NOT NULL,          -- JSON: {x,y,w,h}
  embedding   BLOB NOT NULL,
  cluster_id  INTEGER,
  created_at  TEXT NOT NULL
);

CREATE TABLE face_clusters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT,
  cover_face_id  INTEGER
);
```

**AI 标签不新建表**——复用 Phase 3 已建标签系统与级联机制：

```sql
ALTER TABLE tags       ADD COLUMN source     TEXT DEFAULT 'manual';   -- 'manual' | 'ai'
ALTER TABLE image_tags ADD COLUMN confidence REAL;
```

好处：一键撤销 / 采纳 AI 标签的能力天然获得，无需为 AI 标签单独设计一套管理 UI。

### 9.3 体积测算

512 维向量：

| 库规模 | float32 | **int8** |
|---|---|---|
| 100 万张 | 2.05 GB | **512 MB** |
| 150 万张 | 3.07 GB | **768 MB** |
| 200 万张 | 4.10 GB | **1.02 GB** |

（每条含 `model_id` / `dim` / `quant` / `created_at` 等元字段，实际略大）

**int8 是必选项**，不是优化项——float32 在 200 万张时达 4GB，单库 thumbs.db 会失控。

### 9.4 检索策略

| 期 | 方案 |
|---|---|
| **一期** | **分块流式暴力扫描 + int8 点积**。NVMe 顺序读，1M 级目标 1-3s/查询 |
| **二期** | 视一期实测再上 HNSW 或 `sqlite-vec` |

**明确否决「全量向量常驻内存」**——512MB-1GB 直接违反 C3 的 500MB 红线。

一期方案的关键在于：int8 点积是纯整数运算，可批量加载向量块到内存做扫描后释放，**内存占用由块大小决定而非库规模决定**。

### 9.5 增量失效

复用 `scanner.ts` 已有的 **size + mtime 双条件**判定：扫描时将变动文件的 embedding 打 `dirty = 1`，由后续索引作业优先重算。

不引入新的文件变更检测机制——Phase 1 的判定逻辑已经过实战验证。

### 9.6 写入路径约束

**`ai-index` 插件不持有 DB 连接**，一律经宿主 API（如 `luuk.library.writeEmbedding`）写入。

保证三件事：事务一致性、路径级联（库移动时同步更新）、权限可控（5.6）。

### 9.7 模型绑定约束

`image_embeddings.model_id` 记录产生该向量的模型。**不同模型的 embedding 不可互比**——换模型（如 ViT-B-32 → Chinese-CLIP）**必须全量重建索引**。

**这条约束的后果**：第 16 节的 CLIP 选型必须在 Phase 9 全量索引开工**之前**定案，否则数十小时的作业白跑。UI 必须在模型变更时明示「将重建索引，预计 X 小时」。

这也是 9.2 中 `model_id` 作为 NOT NULL 字段而非可选元数据的原因——它是索引有效性的判定依据，不是溯源信息。

---

## 10. 索引流水线与优先级调度

### 10.1 优先级队列

目标是「**打开就见效**」，而非让用户等数十小时后才有第一个可用结果。

| 优先级 | 范围 | 理由 |
|---|---|---|
| 1（最高） | 当前可见 / 最近浏览文件夹 | 用户正在看的内容立即获得语义搜索能力 |
| 2 | 收藏 | 用户已明示偏好的高价值子集 |
| 3 | 高评分 | 同上，弱信号 |
| 4 | 最近修改 | 新增内容优先于历史积压 |
| 5（最低） | 全量 | 夜间空闲跑完 |

优先级变更不需要重跑已完成项——`job_items` 的 `state` 已经是 `done` 的项跳过即可。

### 10.2 ETA 测算

```
ETA = (待索引张数) / (实测吞吐 张/秒)
```

**吞吐数字留待 PoC R2 回填，本文不给估算值。** 但公式与展示形态先定：以 SigLIP 外部参考值 26ms/张（i9 桌面 CPU）为例，若本机（4650U，6C/12T 移动低压）达到同量级，100 万张约为 7.3 小时；若慢 3 倍则 22 小时——**这个跨度正是 R2 必须实测的原因**，它直接决定全量索引方向是否成立。

### 10.3 进度 UI

复用 `ScanProgress.tsx` 的既有模式：已完成 / 总数 / 速率 / ETA / 暂停继续。

不新造进度组件——扫描进度条已经过用户验证，AI 索引在用户认知里就是「另一种扫描」。

### 10.4 批处理与让权

沿用 `scanner.ts` 的惯例：`BATCH_SIZE` 分批 + `Promise.allSettled`（单项失败不中断整批）+ `setImmediate` 让出执行权。

与 `startPhashBackfill` 的区别在于：进度落 `job_items` 表而非内存字段（见 4.1）。

---

## 11. 与现有系统的接合点

| 功能 | 改动文件 | 改动性质 | 内容 |
|---|---|---|---|
| 搜索 | `src/stores/searchStore.ts` | 扩展 | `SearchCriteria` 加 `semanticQuery` / `minQualityScore` / `faceClusterId` |
| 搜索 | `src/main/services/database.ts` | 扩展 | 搜索方法支持新条件 |
| 搜索 | `src/components/SearchPanel.tsx` | 扩展 | 加语义搜索入口 |
| 排序 | `src/components/SortControl.tsx` | 扩展 | 加「质量分」排序 = **#34 的最小可用形态** |
| 相似图 | `src/components/SimilarImagesPanel.tsx`、`src/stores/similarStore.ts` | 扩展 | 增加「语义相似」模式，与现有 pHash 汉明距离**并列**（不替换） |
| 统计 | `src/components/StatsPanel.tsx` | 扩展 | 增加 AI 索引覆盖率 |
| 标签 | `src/components/TagCloudPanel.tsx`、`src/components/TagDialog.tsx` | 扩展 | 区分 `manual` / `ai` 来源 |
| 设置 | `src/components/SettingsPanel.tsx` | 扩展 | 新增「AI 与采集」分区（模型管理 / 能力开关 / 下载目录）与**「插件」分区**（已装列表 / 权限查看 / 启用停用 / 更新） |
| 右键菜单 | `src/components/file-ops/FileContextMenu.tsx` | 扩展 | **批量 op 条目由插件 `contributes.menuItems` 声明生成，不在代码里写死** |
| 前后对比 | `src/components/CompareViewer.tsx` | 复用 | 变换类 op 的结果预览，**零改动** |
| 收藏推荐 | #39 | 合并 | 可与引擎 C 的质量分**共用一次遍历** |

**关键观察**：这张表里没有一处是「重写」。全部是扩展或复用——因为 AI 能力的输出（标签、评分、向量、编辑结果）都能映射到已有的数据模型与 UI 组件上。这是 Phase 1-7 把数据层做扎实的直接收益。

---

## 12. 爬虫模块方向

> 本节仅定方向。具体站点清单至今未确认（见第 16 节），因此不做适配器接口的方法级设计。

### 12.1 核心变更：SiteAdapter = 插件

**`SiteAdapter` 就是 `kind: "crawler-adapter"` 的插件。**

插件化在爬虫上的最强论据：**网站改版导致适配器频繁失效**。用户 / 第三方可自行替换适配插件，无需等待 Luuk 发版。

> 注意措辞：这**不是运行时热替换**——需重启插件宿主进程（见 5.8）。论据依然成立，但不夸大。

### 12.2 解析三层

| 层 | 形态 | 说明 |
|---|---|---|
| ① 站点适配插件 | `crawler-adapter` 插件 | 首批 3-5 个内置，用于验证接口 |
| ② **通用规则引擎** | **一个内置的数据驱动适配插件** | CSS 选择器 + 可视化拾取；规则 JSON 可导出分享，**规则包本身也是插件产物** |
| ③ 浏览器级抓取 | **宿主提供 `luuk.browser`** | Electron 隐藏 `BrowserWindow` + `webContents.executeJavaScript` |

**第 ② 层是关键设计**：绝大多数图库站点的结构可以用「列表页选择器 + 详情页选择器 + 图片 URL 提取规则」描述。把它做成数据驱动，用户不需要写代码就能适配新站点，只需导出/导入一个 JSON。

### 12.3 浏览器级抓取：不引入 Playwright

**关键结论：项目已在 Electron 内，无需引入 Playwright**（+300MB 体积 / +300MB 内存）即可处理：

| 需求 | Electron 原生方案 |
|---|---|
| JS 渲染页面 | 隐藏 `BrowserWindow` 加载后 `executeJavaScript` 取 DOM |
| 登录 Cookie | `session.fromPartition('persist:crawler')` |
| 防盗链 Referer | 请求头由宿主统一注入 |

**约束**：登录态**不存明文密码**；**插件不得自开 `BrowserWindow`**——一律经 `luuk.browser` 申请，由宿主控制窗口生命周期与并发数。这条与 5.4「插件不直接依赖 onnxruntime-node」是同一设计哲学：**重资源必须由宿主集中管控**。

### 12.4 下载子系统

宿主提供，复用 `export-service.ts` 的成熟模式：

| 项 | 方案 |
|---|---|
| 取消 | `AbortController` Map |
| 失败隔离 | 单项失败不中断整批 |
| 调度 | 接入 JobRunner（批处理通道，见 4.6） |
| 断点续传 | HTTP Range（`electron/main.ts` 的 `media://` Range 实现已有经验） |
| 原子写入 | `.part` 临时文件 + 完成后 rename |
| 并发限制 | per-host 2-4 + 全局上限 + **随机延时** |

### 12.5 三级去重

```
下载前  URL 去重          → 避免重复请求
下载后  file_hash(SHA256) → 精确字节去重
入库前  phash.ts 感知相似  → 同图不同压缩/尺寸
```

第三级复用已有的自研 DCT pHash + 汉明距离，**零新代码**。

### 12.6 落地即入库

下载到 `{库根}/_downloads/{站点}/{图集}/`，完成后触发 `scanner` 增量扫描。

**零新代码接入现有全链路**——缩略图、pHash、标签、统计全部自动生效。这是本设计最省力的一环。

> 依赖 8.3 的待确认改动点：`scanner.ts` 需排除 `_edits` / `_downloads` 前缀目录，避免自我递归入库。

### 12.7 图集缺图补全（D5-②，AI × 爬虫交叉能力）

| 步骤 | 机制 |
|---|---|
| 检测 | 序号 / 页数连续性检测（`001.jpg ... 008.jpg 010.jpg` → 缺 009） |
| 去重 | 已有 pHash 排除「序号不连续但内容已存在」的情况 |
| 补全 | 生成补全任务，交给对应站点适配插件 |
| 约束 | **仅对已录入来源 URL 的图集生效**（依赖 12.8 溯源留档） |

这是 AI 与爬虫两条线唯一的真实交叉点，也是「补图」三义中最贴合图库场景的一项。

### 12.8 溯源留档

来源 URL / 页面标题 / 作者 / 抓取时间写入 `crawl_items` 表 + sidecar JSON。

sidecar JSON 的意义：**即使数据库损坏或库被迁移，溯源信息仍随文件存在**。

### 12.9 合规红线清单

- 尊重 `robots.txt`（可配置）
- UA 明确标识
- 速率限制
- UI 明示「**仅个人本地使用，遵守目标站点条款与著作权法**」
- **不做付费墙绕过与 DRM 破解**
- **不做大规模并发压测**

### 12.10 反爬技术失败路径

> **红线：只识别与退让，不绕过。**

**识别信号**：HTTP 403 / 429 / 503、重定向到验证页、响应体含 challenge 特征、连续 N 页零抽取结果。

**统一退让策略**：

1. **识别即停**——暂停该主机作业，写入 `crawl_items.error`，UI 明示「目标站点拒绝访问，已停止」
2. 退避后**最多重试一轮**
3. 仍失败则标记该适配插件为 `degraded`，建议用户检查插件更新

**明确不做**：

| 不做 | 理由 |
|---|---|
| Cloudflare / WAF challenge 求解 | 与 12.9 合规红线直接冲突 |
| 接打码平台 | 同上，且引入第三方付费依赖 |
| 代理池与 IP 轮换 | 本质是规避封禁，属对抗行为 |
| 伪造浏览器指纹 | 同上 |

> 法律风险由用户承担，而代码由项目提供——这条边界必须清晰。

**登录态**：仅用 `session.fromPartition('persist:crawler')` 的用户自有会话，**不存明文密码、不自动登录、不绕过登录墙**。

**适配器健康度**：每个 `crawler-adapter` 插件记录最近成功率，连续失败超阈时在设置面板标红，**提醒用户而非默默重试**。

---

## 13. 能力开关与渐进增强

**两层开关，不可混淆**：

### 13.1 插件层

```
插件启用状态（plugins.{id}.enabled）
        +
provider isAvailable() 探测结果
        ↓
   op 是否在 UI 出现
```

两者**共同决定**。用户停用了插件，或 provider 探测到硬件不支持，op 都不出现。

### 13.2 feature flag 层

存 electron-store，沿用 `theme.enabled` 的成功经验与「**Phase 末评估 → 达标默认开启 → 清理 flag**」纪律：

| flag | Phase 8 默认 |
|---|---|
| `plugins.enabled`（插件系统总开关） | **false** |
| `ai.enabled` | false |
| `crawler.enabled` | false |

### 13.3 渐进增强保证

未下载模型、provider 不可用、或 flag 关闭时，**UI 完全隐藏**（不是灰掉、不是报错），确保三条性能红线不受影响。

**插件宿主进程懒启动**：无任何启用插件时**不 fork `utilityProcess`**，不影响冷启动 <3s（C3）。

---

## 14. 分期路线

> 只给目标与出口条件，不给工时。

### Phase 8：插件宿主 + JobRunner + D1 先行

**内容**：
- `utilityProcess` 插件宿主与 MessagePort RPC
- `plugin.json` 解析、生命周期（5.7）与加载
- `luuk.*` 最小 API 面
- 模型下载器（含断点续传与校验，7.7）
- 推理会话池 + 内存水位线（7.4 / 7.5）
- JobRunner 与迁移 v2（`jobs` / `job_items` / `edits`）
- **三个内置插件**：`builtin.autotone` / `builtin.matting` / `builtin.upscale`
- 批量 op 右键入口与输出副本
- CLIP 索引最小闭环
- 插件测试四类（5.11）

**出口条件**：三个内置插件跑通，且 R1 / R2 / R7 / R9 有实测数据，API 面冻结候选版确定。

**排序理由**：`autotone` 零模型、`matting` / `upscale` 单图同步即可跑，**不依赖 JobRunner 就能先见效**，同时以最小代价验证 onnxruntime 打包与插件宿主链路。相比先推进 CLIP 全量索引（数十小时作业），**风险更低、可见价值更高**。

### Phase 9：索引能力全量 + 爬虫

**内容**：
- CLIP / SigLIP 索引流水线与优先级调度
- 语义搜索、AI 标签（`tags.source`）、IQA 质量分
- `crawler-adapter` 插件类型 + 3 个站点适配 + 通用规则引擎
- 下载队列 + 落地自动入库
- 收编 `scanner` / `phash backfill` / `export` 到 JobRunner（4.5）

**出口条件**：JobRunner 经数十小时级任务实战验证（**重启续跑不丢进度**）；**插件 API 进入兼容承诺**。

### Phase 10：蒙版体系 + 人脸

**内容**：
- SAM2 交互分割 + 手工画笔
- LaMa 去水印
- 单图交互式编辑器 UI（EditViewer）
- 人脸检测 / 识别 / 聚类 + 人物视图
- 图集缺图补全（12.7）

### Phase 11：D2 扩散类

**内容**：生图 / 局部重绘 / 扩图 op + 三个 provider 插件（`local-diffusion` / `comfyui` / `cloud`）。

**前置条件**：**R8（用户独显占比调研）+ R6（兼容性矩阵）完成且后端路线定案，否则不开工。**

---

## 15. 待验证风险清单（PoC）

评审通过后优先执行。脚本约定放 `scripts/`（沿用 `bench-scan.mjs` / `bench-hash-window.mjs` 命名风格），实测数据回填附录 A，**禁止填估算值**（沿用 [implementation-plan](../archive/implementation-plan-2026-q3-q4.md) 附录 A 的纪律）。

| # | 风险 | 测量协议 | 失败时的改道方案 |
|---|---|---|---|
| **R1** | `onnxruntime-node` 在 Electron 40 + Node 24 的 rebuild 与 `build:dir` / nsis 双通道打包（注意 `npmRebuild: false`） | 最小 demo 打包后在干净 Windows 环境运行一次推理 | 降为纯传统算法（`autotone` 仍可交付）或 Python sidecar |
| **R2** | 4650U 上 CLIP/SigLIP CPU 推理实测吞吐 | 固定 1000 张样本集，测张/秒 → 换算 1M 张 ETA | 缩小模型（MobileCLIP）、只索引收藏与近期、或改为按需单图推理 |
| **R3** | HuggingFace / 国内镜像在目标网络的可达性与下载速率 | 多镜像各下载同一模型，测成功率与速率 | 内置多镜像 + 手动放置模型 |
| **R4** | Python 3.14 的 onnxruntime / torch wheel 是否存在（`environment.yml` 指定 `python>=3.14`） | 查 PyPI 可用 wheel | **仅影响 ComfyUI provider 路线**；降 Python 版本或彻底放弃 sidecar |
| **R5** | 1M 条 int8 embedding 写入 thumbs.db 后的库体积、语义查询延迟、`EXPLAIN QUERY PLAN` 表现 | 生成 1M 条随机向量写入，测查询 P50/P95 | 向量独立成 `vectors.db` 或提前引入 HNSW |
| **R6** | **运行时兼容性矩阵**：Win10 / Win11 <24H2 / Win11 24H2+ × 核显 / 独显 / NPU | 逐格确定走 CPU EP / DirectML / WinML；含 `onnxruntime-node` 与 Windows App SDK 2.x 的 ABI 版本对齐验证（官方要求 `1.24.x`） | 全线只用 `onnxruntime-node` CPU EP，放弃 GPU 加速，**D2 仅留 comfyui + cloud 两个 provider** |
| **R7** | **大图内存峰值**：4K 抠图与超分分块推理的峰值内存与耗时 | 逐级分辨率测 RSS 峰值，对照 7.4 水位线（外部参考值 510MB 已超红线） | 强制分块 + 限制单次处理分辨率上限 + 模型用完立即 unload |
| **R8** | **目标用户独显占比**（产品调研，**非技术验证**） | 用户问卷 / 社区投票 | 无数据则 D2 只能先做 comfyui + cloud，**Phase 11 不得开工** |
| **R9** | **插件 API 冻结风险**：API 过早发布导致长期兼容负担 | Phase 8 结束时列出「必须已验证的 API 面清单」，逐项核对是否被 3 个内置插件真实使用 | 由 3 个内置插件驱动、Phase 8 内允许破坏性变更、Phase 9 起才进入兼容承诺 |

**两个决定性指标**：
- **R2** 决定索引方向是否成立（数十小时 vs 数天的差别）
- **R8** 决定 D2 是否值得做本地 provider（产品问题，不是技术问题）

---

## 16. 未决策项（open questions）

需用户确认，本文不给臆测结论：

| # | 未决策项 |
|---|---|
| Q1 | **爬虫目标站点清单**（requirements 待确认事项 #2 至今未答）——阻塞 12.2 的适配器接口设计 |
| Q2 | **CLIP 具体模型**（Chinese-CLIP vs MobileCLIP vs ViT-B-32 vs SigLIP）——受 9.7 约束，必须在 Phase 9 开工前定案 |
| Q3 | **编辑输出目录方案**（`_edits` 子目录 vs 独立输出库，见 8.3） |
| Q4 | **人脸聚类的 UI 形态**与命名 / 合并交互 |
| Q5 | **插件分发的签名与信任模型**（Phase 8 排除，但 Phase 9+ 需回答） |
| Q6 | **#37 云同步**是否纳入 |
| Q7 | **AI 标签是否允许自动写入**，还是必须用户逐个采纳 |

### 16.1 多语言查询策略（三选一，待 R2 实测后定）

| 选项 | 方案 | 代价 |
|---|---|---|
| **A** | **Chinese-CLIP** | 中文原生词表，无翻译层。代价：英文查询能力弱于标准 CLIP；需单独索引（与英文模型 embedding 不兼容，**模型切换 = 全量重建索引**，见 9.7） |
| **B** | **多语 CLIP（multilingual 变体）** | 中英共存于同一嵌入空间。代价：中文精度不如专用模型，模型体积更大 |
| **C** | **标准 CLIP + 查询翻译层** | 索引不变，仅搜索时将中文译为英文。代价：引入翻译依赖；**云翻译会泄露用户查询内容**，与本地优先原则冲突 |

**当前倾向：A**——目标用户为中文使用者，写真场景术语以中文为主。

但**必须等 R2 实测中文查询召回率后才能定案**。若 A 的召回率不达标而 C 的隐私代价用户可接受，则可能反转。

### 16.2 WebGPU 路线（已归档，避免重复提议）

已在 D2 中否决。补充事实依据：

- `onnxruntime-node` 的 WebGPU EP **仍为实验性且未正式发布**（WebGPU EP 归属 `onnxruntime-web`）
- 若未来评估，路径只能是「隐藏窗口 + onnxruntime-web」，与本文的 `utilityProcess` 原生路线**互斥**
- 算子覆盖率不足，多数视觉模型无法完全 offload

**不作为 R6 矩阵的待测项**，仅当 R6 全线失败时重新评估。

---

## 17. 附录

### 附录 A：PoC 实测数据

**待回填**（R1-R9）。纪律：只填实测值，**禁止估算值**。

| # | 项目 | 实测结果 | 日期 | 结论 |
|---|---|---|---|---|
| R1 | onnxruntime-node 打包 | dev 模式：模块加载 + CPU EP `InferenceSession.create` 对 u2netp（输入名 `input.1`）与 RealESRGAN-x4plus（输入名 `image`，128→512 即 4x）均成功；`scripts/poc-r1-onnx.mjs` 各 3 passed。打包通道（`build:dir` + win-unpacked `.node` 扫描）**待跑** | 2026-09-18 | dev 加载/推理 PASS；打包验证 pending（需 `npm run build:dir`）|
| R2 | 4650U CLIP 吞吐 | 待回填 | — | — |
| R3 | 镜像可达性 | 本机直连 github/huggingface.co 超时；`hf-mirror.com` / `registry.npmmirror.com` / `modelscope.cn` 直连 200；HTTP 代理 `127.0.0.1:7897` 可用 | 2026-09-18 | 已为 upscale 配 `hf-mirror` 镜像，`downloadModel` 支持 url→mirrorUrls 逐个回退 |
| R4 | Python 3.14 wheel | 待回填 | — | — |
| R5 | 1M embedding 查询延迟 | 待回填 | — | — |
| R6 | 运行时兼容性矩阵 | 待回填 | — | — |
| R7 | 大图内存峰值 | 本机 Windows 开发机，`process.memoryUsage().rss` 采样，24× 分块串行推理。**ORT CPU mem-arena 开启**：u2netp@320 **599MB**、RealESRGAN@128 **555MB**（均超 C6 500MB）；**关闭 arena（`enableCpuMemArena:false`）**：u2netp@320 **134MB**、RealESRGAN@128 **212MB**（均在红线内）。tile 64（arena 开）RealESRGAN 256MB | 2026-09-18 | **关键缓解 = 关闭 CPU mem-arena**（已写入 `inference-pool.ts` 会话配置），无需缩小分块即满足 C6。注意：本项仅计 ONNX 推理 RSS，未含 4K→16K 输出的整幅像素缓冲（sharp decode/RGBA/输出图），该部分随输出分辨率线性增长，需另配降采样/落盘策略 |
| R8 | 用户独显占比 | 待回填 | — | — |
| R9 | API 面验证清单 | 待回填 | — | — |

### 附录 B：外部实测参考值来源清单

> **以下全部为非本机数据。** 本机（Ryzen 5 PRO 4650U）数字见附录 A。

| 来源 | 提供的数据 | 硬件 |
|---|---|---|
| **OpenCV 5 DNN Benchmarks** | SigLIP 26.28ms、YuNet 2.34ms、RetinaFace 21ms、U2-Net ~100ms、BiRefNet 9503ms、Real-ESRGAN 580ms、SwinIR 164.7ms、**SAM2 enc 2280ms / dec 10.94ms**、NAFNet 1518ms | i9 桌面 CPU，ORT 1.25.1 |
| **rembg CPU 实测** | 1080p 3.6s、4K 13.2s、5K 22.4s；**峰值内存 380-620MB（4K 达 510MB）** | Xeon E5-2680 v4（4C/8T，CPU-only） |
| **SD1.5 独显基准** | FP16 5.8-9.0s/张、INT8 2.3-3.7s/张 | RTX PRO 2000 **独显**（CPU 数据为外推，非实测） |
| **MTools 老照片修复对照** | CPU 19.5s vs GPU 4.9s @2400×1600 | i7-11800H |
| **Microsoft Learn / WinML 文档** | DirectML EP 标注 "sustained engineering"；Windows App SDK 2.x ↔ `onnxruntime-node@1.24.x` ABI 对齐；NPU 需 Win11 24H2+ | 官方文档 |
| **Microsoft winappCli Electron + WinML JS 指南** | 「推理在 Electron 实用工具进程中运行，因此不会阻止主进程」 | 官方指南 |

### 附录 C：引用纠偏与已剔除来源

本附录记录评审阶段发现并被剔除的错误引用，**防止其流入实施阶段**。

**✅ 可用仓库**（已核实存在且与所述特性相符）：

| 仓库 | 用途 |
|---|---|
| `rom1504/clip-retrieval` | 百万级 embedding 检索参考 |
| `xinntao/Real-ESRGAN` | 超分，官方提供 `pytorch2onnx.py` |
| `xuebinqin/U-2-Net` | 抠图，官方 ONNX 版本 |
| `danielgatis/rembg` | 抠图生产实现，CPU 实测数据来源 |
| `advimman/lama` | 修复（inpainting） |
| `0ssamaak0/CLIPPyX` | MobileCLIP 支持参考 |
| **`chaofengc/IQA-PyTorch`**（即 `pyiqa`） | IQA 多模型库。**本身是 PyTorch 推理库，ONNX 需自行导出** |
| `CVHub520/X-AnyLabeling` | SAM 系列 ONNX 导出与标注生态 |

**✅ 可用论文编号**：

| 论文 | arXiv |
|---|---|
| Chinese-CLIP | `2211.01335` |
| Real-ESRGAN | `2107.10833` |
| SAM 2 | `2408.00714` |
| MUSIQ | `2108.05997` |
| LIQE | `2301.09301` |
| **LaMa** | **`2109.07161`** |

**⚠️ 已纠正的错误数据**：

| 错误表述 | 正确事实 |
|---|---|
| LaMa arXiv `2111.07551` | **`2109.07161`** |
| LaMa「512×512 固定输入」 | 训练于 **256×256**，核心特性为 **resolution-robust**（可泛化至 ~2k），**不存在固定输入尺寸一说** |
| SAM2 CPU 编码器「~250ms」 | **2280ms**（250ms 量级属 GPU 数据，不得用于 CPU 可行性论证） |
| IQA-PyTorch 属 `Degraded-AI-Vision-Lab` | 真实为 **`chaofengc/IQA-PyTorch`** |

**❌ 已剔除的不可验证来源**（禁止写入正文）：

| 来源 | 剔除理由 |
|---|---|
| 「Ever Gauzy Plugin System」/ `docs.gauzy.co/plugins-marketplace/runtime` | 检索零命中；Gauzy 为 ERP 项目，且与 5.12「不做插件市场」边界冲突 |
| 「SAMExporter」/ `anylabeling.nrl.ai/docs/samexporter` | URL 不可验证；SAM 导出工具实际归属 `CVHub520/X-AnyLabeling` 生态 |
| `Snapseek` / `LocalLens` / `ai-image-scaler(dhaneswara)` / `sam2-onnx-cpp(pagarcia)` / 「Formatif AI」 | 均无法验证存在或与所述特性相符 |

**❌ 已剔除的技术论断**：

| 论断 | 事实 |
|---|---|
| 「onnxruntime-node 支持 WebGPU EP，可作 GPU 加速备选」 | 该 EP 属 `onnxruntime-web`；node 侧实验性未发布（见 16.2） |
| 「CoreML EP 可用于 onnxruntime-node」 | 官方标 preview，属 Edge/Mobile 列，**node 绑定不暴露** |
| 「CUDA EP 仅 Linux」 | Windows 同样支持 |

---

## 18. 变更日志

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-09-12 | 初版方向分析：基础设施 + AI 索引两线，AI 修图仅一段话提及 |
| v2 | 2026-09-12 | 用户挑战「AI 只做索引吗」后重构：拆分 D1（轻量修复，本地可行）/ D2（扩散生成，本地 CPU 不可行），新增算力对照表、`edits` 版本链、蒙版体系；分期重排为 Phase 8-11 |
| v2.1 | 2026-09-12 | 用户定调「作为插件功能集成而非写死」后重构主轴：roadmap #38 升为 Phase 8 核心，新增插件系统架构（双宿主 / `plugin.json` / `luuk.*` SDK / 能力↔Provider 解耦）；`SiteAdapter` 改为 `crawler-adapter` 插件 |
| **v3** | **2026-09-13** | 基于外部评审与联网核实打补丁：**新增**推理会话池与内存水位线（7.4/7.5）、模型权重量化策略（7.6）、离线下载失败路径（7.7）、插件生命周期（5.7）、插件测试策略（5.11）、API 废弃流程（5.9）、反爬失败路径（12.10）、多语言查询三选项（16.1）、WebGPU 归档（16.2）、`model_id` 重建索引约束（9.7）、附录 C 引用纠偏。**修正**「插件热更新无需发版」过强表述（5.8/12.1）、LaMa 输入规格与 arXiv 编号（6.5）。**驳回**评审中的四项提议：现有系统迁移插件架构（4.5 已说明不迁移）、插件生态激励机制（5.12 已排除）、安全沙箱强化（5.6 已诚实声明非沙箱）、猜测式模型预热（7.5 采用惰性加载） |

---

**文档状态**：`draft` — 待评审。评审通过后将 `status` 改为 `current`，并回填附录 A 的 PoC 实测数据。

