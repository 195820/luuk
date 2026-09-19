# Luuk 图片查看器 - 文档中心

> 文档按用途分层组织：长期有效的内容进入对应目录，已完成/过期的内容移入 `archive/`。

## 📂 目录结构

```
docs/
├── README.md                    # 本文档 - 索引与管理规范
├── roadmap.md                   # 开发路线图（唯一的任务规划来源，含现状/遗留项/进行中）
├── guides/                      # 实操指南
│   ├── 入门指南.md               # 用户快速上手
│   ├── 部署指南.md               # 构建与发布
│   └── 故障排除.md               # 常见问题与已知问题
├── reference/                   # 稳定参考（长期有效）
│   └── 架构设计.md               # 系统架构 / AI 插件子系统 / 媒体链路 / 数据库 / IPC
├── plans/                       # 实施计划与方向性设计（阶段性，实施完成后归档）
│   ├── ai-crawler-direction-2026-q4.md      # Phase 9-11 AI/爬虫方向设计（current）
│   ├── Phase8人工验收清单-2026-09-19.md      # Phase 8 人工验收（进行中）
│   └── 回归测试计划-2026-09-13.md            # 全量回归（自动化部分已闭环，M0~M8 人工走查待完成）
└── archive/                     # 已完成的方案与测试记录（历史快照，不再更新）
    ├── implementation-plan-2026-q3-q4.md    # Phase 5-7 实施计划（已交付）
    ├── code-review-2026-q3-q4-phase5-7.md   # Phase 5-7 代码评审报告
    ├── phase-5-completion.md                # Phase 5 完成报告
    ├── defect-summary-2026-09-15.md         # 回归缺陷修复总结（7/10，余量已闭环）
    ├── 媒体加载性能提升方案-2026-09.md        # 媒体改造方案（已实施，代码待提交；唯一权威版）
    ├── 测试方案.md · 多媒体模块重构方案/测试计划 · 文件操作阶段测试执行记录
    └── superpowers/             # 历史 plan/spec（含 phase4-and-beyond、Phase 8 实施计划）
```

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
| `Ctrl+R` | 幻灯片顺序/随机切换 | `Ctrl+F` | 搜索面板开合 |
| `F5` | 切换视图模式 | `F6` | 切换文件夹侧边栏 |
| `F11` | 全屏沉浸式模式 | | |

## 🔗 其他入口

- 根目录 [README](../README.md) — 项目简介（对外）
- [CLAUDE.md](../CLAUDE.md) — AI 协作开发指引
- [requirements.md](../requirements.md) — 需求规格
- [CHANGELOG.md](../CHANGELOG.md) — 变更日志

---

**文档结构更新日期**: 2026-09-19（文档整合：阶段计划归档，根目录仅保留 README 与 roadmap）