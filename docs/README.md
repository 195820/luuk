# Luuk 图片查看器 - 文档中心

> 文档按用途分层组织：长期有效的内容进入对应目录，已完成/过期的内容移入 `archive/`。

## 📂 目录结构

```
docs/
├── README.md                    # 本文档 - 索引与管理规范
├── roadmap.md                   # 开发路线图（唯一的任务规划来源）
├── guides/                      # 实操指南
│   ├── 入门指南.md               # 用户快速上手
│   ├── 部署指南.md               # 构建与发布
│   └── 故障排除.md               # 常见问题与已知问题
├── reference/                   # 稳定参考（长期有效）
│   └── 架构设计.md               # 系统架构 / 数据库 / IPC / media://
├── plans/                       # 实施计划与方向性设计（阶段性，实施完成后归档）
│   ├── ai-crawler-direction-2026-q4.md            # Phase 8-11 AI 插件化与爬虫方向性设计（draft）
│   ├── implementation-plan-phase9-agent.md         # Phase 9 Agent 体系（approved · M0-M6 已交付）
│   ├── phase9-t22-text-encoder-poc.md              # T22 前置 PoC：文本塔跨模态可行性（已执行 · GO）
│   ├── phase9-t22-semantic-search.md               # T22 CLIP 语义搜索实施方案（已实施）
│   ├── phase9-t23-t24-t25-quality-match-jobs.md    # T23/T24/T25 合并实施方案（已实施）
│   ├── tier1-ai-wiring-hnsw-phase10-plan.md        # Tier 1：ai-wiring 并发修复 / HNSW 验证 / Phase 10 规划（已交付）
│   ├── implementation-plan-phase10.md              # Phase 10 蒙版/SAM2/LaMa/人脸/图集补全（draft · 零代码）
│   ├── Agent架构派生规划-2026-09-22.md              # Agent 架构派生扩展点调研（draft）
│   ├── 回归测试计划-2026-09-13.md                    # MT-* 回归用例（current）
│   ├── 全面测试方案-2026-09-19.md                    # 分层测试方案（current）
│   ├── Phase8人工验收清单-2026-09-19.md              # Phase 8 人工验收 32 项（current）
│   ├── M-C人工验收执行手册-2026-09-21.md              # M-C 人工验收子集执行手册（current）
│   └── 自动化测试与P0P1修复报告-2026-09-21.md         # E2E 自动化与 P0/P1 修复报告
└── archive/                     # 已完成的方案与测试记录（历史快照，不再更新）
    ├── implementation-plan-2026-q3-q4.md   # Phase 5-7 实施计划（已交付）
    ├── code-review-2026-q3-q4-phase5-7.md  # Phase 5-7 代码评审报告
    ├── phase-5-completion.md               # Phase 5 完成记录
    ├── defect-summary-2026-09-15.md        # Phase 8 缺陷汇总
    ├── Phase8缺陷修复计划-2026-09-18.md
    ├── Phase8补全实现方案-2026-09.md
    ├── 项目状态分析与规划-2026-09-18.md
    ├── 媒体加载性能提升方案-2026-09.md
    ├── 测试方案.md                          # Phase 1 MVP 测试方案
    ├── 多媒体模块重构方案.md
    ├── 多媒体模块重构测试计划.md             # 重构测试执行记录（45/45 PASS）
    ├── 文件操作阶段测试执行记录.md
    └── superpowers/          # 前端重构 plan/spec（已执行，含 2026-08-08 ～ 2026-09-13 各阶段）
```

> ⚠️ **已完成并归档的 Phase 5-7 计划、评审报告、Phase 5 完成记录位于 `archive/` 而非 `plans/`**（2026-10-19 核对修正，旧索引树中这三个条目为断链）。

## 🧭 每类文档怎么用

| 目录 | 面向读者 | 内容类型 | 更新策略 |
|------|---------|---------|---------|
| `roadmap.md` | 开发者/规划 | 任务清单 + 进度 | 常更新，反映现状 |
| `guides/` | 用户/发布者 | 操作步骤 | 功能变化时更新 |
| `reference/` | 开发者 | 架构/接口描述 | 慎改，随代码演进 |
| `plans/` | 开发者/规划 | 实施计划、方向性设计、评审报告 | 阶段性文档，带 `status` 标记（draft → reviewed → current），实施完成后连同结果移入 `archive/` |
| `archive/` | 任何人 | 已完成方案的历史快照 | 不再更新 |

## ✅ 文档维护规范

1. **新增文档**：先判断归属——指南 → `guides/`，参考 → `reference/`，实施计划与方向性设计 → `plans/`，任务清单 → 并入 `roadmap.md`；已完成/过期的内容 → `archive/`
2. **统一 front matter**：每份文档顶部需有 YAML front matter：

   ```yaml
   ---
   title: 文档标题
   description: 一句话说明（用于索引检索）
   type: guide | reference | roadmap | archive | plan | design | review
   status: draft | reviewed | current | archived
   updated: YYYY-MM-DD
   ---
   ```

   > `type` 枚举补全说明：`plan`（实施计划）、`design`（方向性设计）、`review`（评审报告）已被 `plans/` 下的现有文档使用，原枚举缺这三项。`status` 同理补 `draft` / `reviewed` 两个阶段性取值。

3. **交叉引用**：使用相对路径链接（如 `../roadmap.md`），移动文档时同步修正引用
4. **归档**：方案/计划一旦实施完成，连同结果记录移入 `archive/` 并标记 `status: archived`
5. **编号**：不使用序号前缀（01/02…）；文件名即功能名，避免编号断层

## ⌨️ 快捷键参考

| 快捷键 | 功能 | 快捷键 | 功能 |
|--------|------|--------|------|
| `←/→` | 上一张/下一张 | `0` / `1` | 适应窗口 / 实际大小 |
| `Home/End` | 第一张/最后一张 | `R` | 重置缩放/旋转/翻转 |
| `H` / `V` | 水平 / 垂直翻转 | `I` | 显示图片信息 |
| `F` | 收藏/取消收藏 | `Esc` | 关闭查看器 |
| `Space` | 幻灯片播放 | `Ctrl+Space` | 音频播放/暂停 |
| `F5` | 切换视图模式 | `F6` | 切换文件夹侧边栏 |
| `F11` | 全屏沉浸式模式 | | |

## 🔗 其他入口

- 根目录 [README](../README.md) — 项目简介（对外）
- [CLAUDE.md](../CLAUDE.md) — AI 协作开发指引
- [requirements.md](../requirements.md) — 需求规格
- [CHANGELOG.md](../CHANGELOG.md) — 变更日志

---

**文档结构更新日期**: 2026-10-19（v1.0.0 发版前索引核对：plans/ 实有 13 份、归档件位置修正、全部补 front matter）