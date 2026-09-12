---
title: 实施计划 2026-Q3/Q4
description: Phase 5-7 功能实施路线图 — 时间线、依赖、验收标准
type: plan
status: reviewed
created: 2026-09-12
revised: 2026-09-12
---

# 实施计划 2026-Q3/Q4

> 本文档整合 P0（未完成）+ P1（近期）+ P2（中期）任务，按依赖关系与执行优先级编排。
> **需求来源**：[requirements.md](../../requirements.md) · [docs/roadmap.md](../roadmap.md)
> **预估总工时**：**11 天**（含工程化 2 天，单人全职），加 20% 风险缓冲 ≈ **13 天**，建议 3-4 周内分 3 个 Phase 交付。

---

## 📋 任务总览

| 优先级 | 任务数 | 预计工时 | 目标完成时间 |
|--------|--------|----------|--------------|
| **P0（收尾）** | 1 项 | 0.5 天 | Week 1 |
| **P1（近期）** | 2 项 | 1.5 天 | Week 1 |
| **P2（中期）** | 5 项 | 7 天 | Week 2-3 |
| **工程化** | 2 项 | 2 天 | 贯穿全程 |
| **依赖引入** | 2 项 | 0.5 天 | Phase 首日前置 |
| **总计** | **12 项** | **11 天** | **3-4 周** |

> ⚠️ 注：P0 #4（增量扫描）的**文件夹级优化**因技术风险暂缓，本计划仅完成**文件级收尾**（`scanner.ts` 已具备 `added/updated/skipped/deleted` 计数，仅缺日志输出）。

### 🔗 任务依赖图

```
Task 5.0（引入 chokidar 备选）
    └─► Task 5.2（离线库检测，复用 libraries.status）
             └─► Task 5.3（搜索体验，需感知库在线状态）

Task 5.1（增量扫描收尾）  ← 独立，可并行

Task 6.1（主题系统，Tailwind v4 @theme）
    └─► Task 6.2（直方图 UI 需跟随主题）
    └─► Task 6.3（文件夹封面 UI 需跟随主题）

Task 7.0（引入 archiver）
    └─► Task 7.2（导出）

Task 7.1（幻灯片增强，复用 wavesurfer.js）  ← 独立

Task E.1（测试）→ 每个 Phase 完成后 24h 内补齐
Task E.2（性能）→ Phase 5 首日跑基线，Phase 7 结束复测
```

---

## 🎯 Phase 5：体验打磨（Week 1，2 天）

### 目标
补齐搜索体验闭环 + 离线库支持，为 P2 功能铺路。

### Task 5.0：依赖引入与冒烟（前置）

**状态**：⬜ 未开始  **工时**：0.25 天  **优先级**：P0

**范围**：
- 引入 `chokidar@^3.6.0`（Task 5.2 备选，非必需 —— 详见 5.2 方案对比）
- 在 Electron 主进程 require 冒烟：`npm i chokidar` → `npm run dev` → 主进程 `import('chokidar')` 无错
- 验证打包（`npm run build:dir`）后 `chokidar` 未被 asar 排除

**验收标准**：
- [ ] `package.json` dependencies 新增 chokidar
- [ ] Electron 主进程可正常 import，dev + build:dir 双通道通过
- [ ] 若选择纯 `fs.access` 方案（推荐），本任务改为**跳过**并在 5.2 中标注

---

### Task 5.1：增量扫描收尾（P0 #4）

**状态**：🟡 70% 完成（文件级已实现）  **工时**：0.5 天  **优先级**：P0
**前置**：无

**已完成**：
- ✅ 文件大小 + mtime 双条件跳过（`scanner.ts:222-227`）
- ✅ 批量预载已有记录（Map 替代逐文件查询，`scanner.ts:183-186`）
- ✅ ScanResult 已含 `added/updated/deleted/skipped/total` 五字段

**待完成**：
- ⬜ 扫描日志增强（在 `scan()` 结束处 `logger.info` 输出统计）
- ⬜ **性能基线采集**（详见附录 A，Phase 5 首日执行）

**验收标准**：
- [ ] 扫描完成日志包含 `[Scanner] 库 X 扫描完成 | 总计: N | 新增: Y | 更新: Z | 跳过: S | 删除: D`
- [ ] 基线测试报告写入附录 A，含硬件配置 + 冷/热扫描时长
- [ ] 目标：10 万张库（NVMe SSD 冷启动）首次扫描 < 8 分钟，增量扫描（无变化）< 30 秒

**涉及文件**：
- `src/main/services/scanner.ts`（scan() 尾部 + 日志）
- `scripts/bench-scan.mjs`（新建基线脚本，参考现有 `scripts/bench-hash-window.mjs`）

---

### Task 5.2：离线库自动检测（P1 #13）

**状态**：⬜ 未开始  **工时**：0.5 天  **优先级**：P1
**前置**：Task 5.0（若选 chokidar 方案）

**关键前提**：**复用现有 `libraries.status` 字段**（`database.ts:72` 已定义 `status TEXT DEFAULT 'offline'`，已建索引 `idx_libraries_status`），不新增字段。

**需求**：
- 定时探测库根路径可达性，自动更新 `libraries.status`（`online` / `offline`）
- 离线库在侧边栏置灰，禁用扫描/搜索/右键操作
- 重新可达后 10 秒内自动恢复在线

**技术方案对比**：

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. `fs.access` 定时探测** | 无新依赖、跨平台稳、代码 <50 行 | 检测延迟 = 轮询间隔 | ✅ **推荐** |
| B. chokidar `depth:0` + 事件 | 理论上更实时 | Windows 移动盘拔出时 watcher 自身失效，`unlink` 事件不可靠；需引入新依赖 | ❌ 不推荐 |

**采用方案 A 的实现草案**：
```typescript
// src/main/services/library-monitor.ts（新建）
import { promises as fsp } from 'fs';
import { logger } from '../../utils/logger';

class LibraryMonitor {
  private timer: NodeJS.Timeout | null = null;
  private libraries: Array<{ id: number; rootPath: string }> = [];
  private statusCache = new Map<number, 'online' | 'offline'>();

  /** 单一 interval 调度所有库，避免多库场景下 N 个 setInterval */
  start(intervalMs = 5000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.probeAll(), intervalMs);
    this.probeAll(); // 立即执行一次
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  setLibraries(libs: Array<{ id: number; rootPath: string }>) {
    this.libraries = libs;
  }

  private async probeAll() {
    for (const lib of this.libraries) {
      const next = await this.probe(lib.rootPath);
      const prev = this.statusCache.get(lib.id);
      if (prev !== next) {
        this.statusCache.set(lib.id, next);
        masterDB.updateLibraryStatus(lib.id, next); // 复用现有 status 字段
        broadcastToRenderers('library-status-changed', { id: lib.id, status: next });
        logger.info('LibraryMonitor', `库 ${lib.id} 状态变更: ${prev ?? 'unknown'} → ${next}`);
      }
    }
  }

  private async probe(p: string): Promise<'online' | 'offline'> {
    try { await fsp.access(p, fs.constants.R_OK); return 'online'; }
    catch { return 'offline'; }
  }
}
```

**验收标准**：
- [ ] 拔出移动硬盘后 ≤ 5 秒内 UI 显示"离线"图标（灰化 + tooltip "库不可达"）
- [ ] 重新插入后 ≤ 10 秒内自动恢复在线
- [ ] 离线库的扫描/搜索/文件夹右键按钮全部禁用（`disabled` 属性 + 视觉反馈）
- [ ] `libraries.status` 与 UI 状态一致（可通过 sqlite3 CLI 验证）
- [ ] 10 库并存时 CPU 占用增量 < 1%

**涉及文件**：
- `src/main/services/library-monitor.ts`（新建）
- `src/main/services/database.ts`（新增 `updateLibraryStatus(id, status)` 方法）
- `src/main/ipc/library-handlers.ts`（广播 `library-status-changed` 事件）
- `electron/preload.ts`（暴露 `onLibraryStatusChanged` 订阅）
- `src/stores/imageStore.ts`（增加 `libraryStatus: Record<number, 'online'|'offline'>`）
- `src/components/library/LibraryPanel.tsx`（消费状态 + 禁用交互）

---

### Task 5.3：搜索体验优化（新增）

**状态**：⬜ 未开始  **工时**：1 天  **优先级**：P1
**前置**：Task 5.2（搜索时需感知库在线状态）

**需求**：
- 搜索结果高亮匹配关键词（**React 节点方案，避免 XSS**）
- 搜索历史（最近 10 次，持久化到 electron-store）
- 高级搜索面板增加"保存为预设"功能（预设存储于 electron-store）

**技术方案**：
```typescript
// src/stores/searchStore.ts —— 在现有 store 基础上扩展
interface SearchState {
  // ...现有字段
  history: string[];              // 最近 10 次
  presets: SearchPreset[];        // 命名预设
  addToHistory: (query: string) => void;
  saveAsPreset: (name: string, criteria: SearchCriteria) => void;
  removePreset: (id: string) => void;
}

// 持久化：electron-store 已存在依赖，key 命名 search.history / search.presets
```

**高亮渲染（React 节点方案，杜绝 dangerouslySetInnerHTML）**：
```tsx
// src/utils/highlight.tsx（新建）
export function highlightMatch(text: string, keyword: string): React.ReactNode[] {
  if (!keyword) return [text];
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === keyword.toLowerCase()
      ? <mark key={i} className="bg-accent/40 text-foreground rounded-sm px-0.5">{part}</mark>
      : part
  );
}
```

**验收标准**：
- [ ] 搜索结果中文件名匹配部分以 `<mark>` 高亮，**无 XSS 风险**（含 `<script>` 的文件名能安全渲染）
- [ ] 搜索框下拉显示最近 10 次搜索词，可清空
- [ ] 可保存/删除命名预设，重启后保留
- [ ] 离线库搜索按钮禁用（继承 Task 5.2）

**涉及文件**：
- `src/stores/searchStore.ts`（扩展）
- `src/utils/highlight.tsx`（新建）
- `src/components/SearchPanel.tsx`
- `src/components/ImageGridItem.tsx`（高亮渲染）
- `src/main/services/settings-store.ts`（新增 search.history / search.presets 命名空间）

---

## 🎨 Phase 6：个性化与视觉增强（Week 2，3 天）

### 目标
提供主题定制能力 + 视觉反馈增强，提升用户归属感。

### ⚠️ 关键前提：Tailwind v4 CSS-first 配置

项目使用 `tailwindcss@^4.3.3`（v4），**已改用 CSS-first 配置**：
- ✅ 通过 [`src/index.css`](../../src/index.css) 中的 `@theme { ... }` 指令定义 token
- ✅ 通过 `@utility` 定义自定义工具类（如 `.glass-l1`, `.btn-icon`）
- ✅ 通过 `@custom-variant dark (&:is(.dark *))` 定义暗色变体
- ❌ **不使用 `tailwind.config.ts`**（项目根目录不存在此文件）

Phase 6 所有涉及主题的任务必须遵循此规范，**禁止引入 v3 风格的配置文件**。

---

### Task 6.1：主题/皮肤系统（P2 #21）

**状态**：⬜ 未开始  **工时**：1.5 天  **优先级**：P2
**前置**：无
**回滚保障**：feature flag（electron-store `theme.enabled`，默认 `false` → 灰度开启）

**需求**：
- 深色/浅色/跟随系统三种模式（当前仅深色，需扩展浅色）
- 强调色自定义（6 种预设 + 自定义 HEX）
- 界面密度（紧凑/舒适/宽松）

**技术方案（Tailwind v4 兼容）**：

```css
/* src/index.css —— 在现有 @theme 基础上扩展 */

/* 1. 浅色主题变量覆盖（沿用现有 --color-* token 名） */
[data-theme="light"] {
  --color-canvas:           #fafafa;
  --color-canvas-raised:    #ffffff;
  --color-canvas-tertiary:  #f4f4f5;
  --color-glass-l1:         rgba(255, 255, 255, 0.75);
  --color-glass-l2:         rgba(255, 255, 255, 0.85);
  --color-glass-l3:         rgba(255, 255, 255, 0.9);
  --color-text-primary:     rgba(0, 0, 0, 0.92);
  --color-text-secondary:   rgba(0, 0, 0, 0.6);
  --color-text-muted:       rgba(0, 0, 0, 0.4);
  --color-border:           rgba(0, 0, 0, 0.08);
  /* ...其余 token 同步反转 */
}

/* 2. 强调色：6 预设 + 自定义，通过 CSS 变量注入 */
[data-accent="violet"]  { --color-accent: #7c6ef0; --color-accent-hover: #9488f8; }
[data-accent="blue"]    { --color-accent: #3b82f6; --color-accent-hover: #60a5fa; }
[data-accent="green"]   { --color-accent: #10b981; --color-accent-hover: #34d399; }
[data-accent="orange"]  { --color-accent: #f59e0b; --color-accent-hover: #fbbf24; }
[data-accent="pink"]    { --color-accent: #ec4899; --color-accent-hover: #f472b6; }
[data-accent="cyan"]    { --color-accent: #06b6d4; --color-accent-hover: #22d3ee; }
/* 自定义 HEX：由 themeStore 在 <html> 上写 style="--color-accent: #xxx" */

/* 3. 密度 */
[data-density="compact"]     { --density-scale: 0.85; }
[data-density="comfortable"] { --density-scale: 1; }
[data-density="spacious"]    { --density-scale: 1.15; }
```

```typescript
// src/stores/themeStore.ts（新建）
interface ThemeState {
  enabled: boolean;                                    // feature flag
  mode: 'light' | 'dark' | 'system';
  accentPreset: 'violet' | 'blue' | 'green' | 'orange' | 'pink' | 'cyan' | 'custom';
  accentCustom: string;                                // HEX
  density: 'compact' | 'comfortable' | 'spacious';
  setMode: (m: ThemeState['mode']) => void;
  setAccent: (preset: ThemeState['accentPreset'], hex?: string) => void;
  setDensity: (d: ThemeState['density']) => void;
}

// 应用逻辑：写入 <html data-theme="..." data-accent="..." data-density="...">
// system 模式：window.matchMedia('(prefers-color-scheme: dark)') 监听
// 持久化：electron-store theme.* 命名空间
```

**验收标准**：
- [ ] 设置面板提供主题切换 UI（模式 / 强调色 / 密度三组）
- [ ] 浅色模式下所有现有组件可读性良好（**含 glass-l1/l2/l3 视觉验证**）
- [ ] 强调色变化即时生效（无需刷新）
- [ ] 主题选择持久化（electron-store）+ 冷启动无闪烁（在 `index.html` 内联脚本预置 `data-theme`）
- [ ] **feature flag 关闭时完全回退到当前深色行为**（回滚保障）
- [ ] 遵循 `prefers-reduced-transparency` / `prefers-reduced-motion`（现有 `index.css` 末尾已定义）

**涉及文件**：
- `src/stores/themeStore.ts`（新建）
- `src/index.css`（在现有 `@theme` 基础上追加浅色变量 + 强调色 + 密度）
- `src/components/SettingsPanel.tsx`（新建，含 feature flag 开关）
- `src/main/services/settings-store.ts`（新增 theme.* 命名空间）
- `index.html`（预置 `data-theme` 防闪烁脚本）
- ❌ **不涉及** `tailwind.config.ts`（v4 无需此文件）

---

### Task 6.2：图片直方图（P2 #24）

**状态**：⬜ 未开始  **工时**：1 天  **优先级**：P2
**前置**：Task 6.1（UI 需跟随主题）

**需求**：
- RGB 三通道直方图 + 亮度直方图
- 查看器信息面板新增"直方图"标签页
- 支持对数/线性刻度切换

**技术方案（含降采样策略）**：
```typescript
// src/main/utils/histogram.ts（新建）
import sharp from 'sharp';

const MAX_PIXELS = 2_000_000; // 200 万像素上限

export async function calculateHistogram(imagePath: string) {
  const meta = await sharp(imagePath).metadata();
  const totalPixels = (meta.width ?? 0) * (meta.height ?? 0);

  let pipeline = sharp(imagePath);
  if (totalPixels > MAX_PIXELS) {
    // 大图降采样至 200 万像素，保持宽高比
    const scale = Math.sqrt(MAX_PIXELS / totalPixels);
    pipeline = pipeline.resize({
      width: Math.round((meta.width ?? 0) * scale),
      height: Math.round((meta.height ?? 0) * scale),
    });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const rHist = new Uint32Array(256);
  const gHist = new Uint32Array(256);
  const bHist = new Uint32Array(256);
  const lHist = new Uint32Array(256);

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    rHist[r]++; gHist[g]++; bHist[b]++;
    // Rec. 601 亮度
    lHist[(0.299 * r + 0.587 * g + 0.114 * b) | 0]++;
  }

  return { r: rHist, g: gHist, b: bHist, l: lHist, downsampled: totalPixels > MAX_PIXELS };
}
```

**分级性能 SLA**：

| 图像规模 | 目标延迟 | 备注 |
|---------|---------|------|
| ≤ 200 万像素（1080p） | < 50ms | 直接计算 |
| 200 万 - 2000 万像素（4K） | < 100ms | 降采样后计算 |
| > 2000 万像素（8K/中画幅） | < 150ms | 降采样 + Web Worker |

**验收标准**：
- [ ] 查看器信息面板显示 RGB + 亮度四通道直方图
- [ ] 分级 SLA 达标（在附录 A 记录实测）
- [ ] 支持鼠标悬停显示 bin 具体数值
- [ ] 对数/线性刻度切换
- [ ] 大图降采样时 UI 提示"已降采样至 200 万像素"

**涉及文件**：
- `src/main/utils/histogram.ts`（新建）
- `src/main/ipc/library-handlers.ts`（新增 `calculateHistogram` handler）
- `src/components/ImageViewer.tsx`（新增标签页）
- `src/components/HistogramChart.tsx`（新建，可复用 `recharts` 现有依赖）

---

### Task 6.3：文件夹封面设置（P2 #23）

**状态**：⬜ 未开始  **工时**：0.5 天  **优先级**：P2
**前置**：Task 6.1（UI 需跟随主题）

**需求**：
- 右键文件夹 → "设置为封面"（当前 `FolderTree.tsx` 未挂载 `onContextMenu`，需新增）
- 文件夹树显示封面缩略图（16x16）
- 封面选择：首张图片（默认）/ 手动指定

**技术方案（数据库迁移）**：

⚠️ **SQLite 无原生 JSON 类型**，使用 `TEXT` 存储 JSON 字符串：

```sql
-- 通过迁移脚本执行，而非直接 ALTER
ALTER TABLE libraries ADD COLUMN folder_covers TEXT;
-- 存储格式：JSON 字符串 '{ "relative/folder/path": "cover_relative_path" }'
```

**数据库迁移策略（首次引入）**：

```typescript
// src/main/services/database.ts —— 新增 schema_version 管理
private ensureSchemaVersion() {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const current = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get()?.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      this.db.transaction(() => {
        m.up(this.db);
        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
      })();
      logger.info('Database', `应用迁移 v${m.version}: ${m.name}`);
    }
  }
}

const MIGRATIONS = [
  { version: 1, name: 'folder_covers', up: (db) => db.exec(`ALTER TABLE libraries ADD COLUMN folder_covers TEXT`) },
  // 后续迁移递增 version
];
```

**验收标准**：
- [ ] 右键文件夹菜单包含"设置为封面 / 清除封面"选项（`FolderTree.tsx` 新增 `onFolderContextMenu`）
- [ ] 文件夹树节点显示封面缩略图（16x16，无封面时回退到默认图标）
- [ ] 封面设置持久化到 master.db（`libraries.folder_covers`）
- [ ] **老库首次启动自动应用 v1 迁移**，`schema_version` 表记录成功
- [ ] 迁移失败时回滚（事务包裹）+ 日志告警

**涉及文件**：
- `src/main/services/database.ts`（新增 `ensureSchemaVersion` + `MIGRATIONS` 常量）
- `src/main/services/image-service.ts`（`setFolderCover` / `getFolderCover` 方法）
- `src/main/ipc/library-handlers.ts`（IPC handler）
- `src/components/FolderTree.tsx`（新增 `onFolderContextMenu` 回调 + 封面渲染）
- `src/components/file-ops/FileContextMenu.tsx`（扩展"设置为封面"入口）

---

## 🎬 Phase 7：幻灯片与导出（Week 3，4 天）

### 目标
完善幻灯片播放体验 + 基础导出能力。

### Task 7.0：依赖引入与冒烟（前置）

**状态**：⬜ 未开始  **工时**：0.25 天  **优先级**：P0

**范围**：
- 引入 `archiver@^7.0.0`（Task 7.2 依赖）
- 冒烟：Electron 主进程写入 ZIP 到用户 Downloads，验证 asar 打包后 `archiver` 的 native binding 无异常
- **无需**引入 `color` 包：强调色 HSL↔HEX 转换用原生 `CSS.supports` + 手写工具函数（<30 行）即可

**验收标准**：
- [ ] `package.json` dependencies 新增 archiver
- [ ] dev + build:dir 双通道可成功生成 ZIP
- [ ] 若失败，切换到 `adm-zip`（备选，纯 JS 实现）

---

### Task 7.1：幻灯片增强（P2 #22）

**状态**：⬜ 未开始  **工时**：1.5 天  **优先级**：P2
**前置**：无（可与 Task 7.0 并行）

**需求（明确范围）**：
- 过渡动画：淡入淡出 / 滑动 / 缩放（复用 `motion@^13` + `src/lib/motion-presets.ts`）
- 随机播放模式（Ctrl+R 切换）
- 自定义播放列表（拖拽排序，持久化到 electron-store）
- **背景音乐范围明确**：
  - 单曲循环（一张 MP3/WAV/FLAC/M4A）
  - **复用现有 `wavesurfer.js@^7.12.8`**（无需新增音频依赖）
  - 与图片切换**解耦**（音乐独立播放，不影响切图节奏）
  - **退出全屏或幻灯片停止时自动停止并释放 audio 元素**
  - 音量控制（0-100，滑块 UI 复用现有 `.audio-volume-slider` 样式）

**技术方案**：
```typescript
// src/stores/slideshowStore.ts（新建）
interface SlideshowState {
  mode: 'sequential' | 'random';
  transition: 'fade' | 'slide' | 'zoom';
  intervalSec: number;                    // 3-30，默认 5
  playlist: number[];                     // 图片 ID 列表
  audioTrack: { path: string; volume: number } | null;
  isPlaying: boolean;

  toggleMode: () => void;
  setTransition: (t: SlideshowState['transition']) => void;
  addAudioTrack: (path: string) => void;
  removeAudioTrack: () => void;
  setVolume: (v: number) => void;
  reorderPlaylist: (from: number, to: number) => void;
  start: () => void;
  stop: () => void;                       // 必须释放 audio 资源
}
```

**验收标准**：
- [ ] 幻灯片控制栏增加过渡动画选择器（3 种）
- [ ] 支持随机播放模式（Ctrl+R 切换，UI 状态同步）
- [ ] 可创建/保存/加载自定义播放列表（electron-store `slideshow.playlists`）
- [ ] 支持添加背景音乐（MP3/WAV/FLAC/M4A），单曲循环 + 音量控制
- [ ] **退出全屏 / 关闭幻灯片 → 音乐立即停止 + wavesurfer 实例 destroy**（内存泄漏防护）
- [ ] 播放列表拖拽排序流畅（60 FPS）

**涉及文件**：
- `src/stores/slideshowStore.ts`（新建）
- `src/components/layout/SlideshowBar.tsx`
- `src/components/PlaylistEditor.tsx`（新建）
- `src/components/SlideshowAudio.tsx`（新建，封装 wavesurfer）
- `src/components/ImageViewer.tsx`（过渡动画，复用 motion-presets）

---

### Task 7.2：基础导出功能（新增）

**状态**：⬜ 未开始  **工时**：2 天（**从 0.5 天上调**，考虑 IPC 流式 + 大文件取消 + 进度反馈）  **优先级**：P2
**前置**：Task 7.0（archiver 引入）

**需求**：
- 导出当前图片（原始 / 调整尺寸 / 格式转换）
- 批量导出选中图片（ZIP，支持取消）
- 导出格式转换（JPG / PNG / WEBP，质量可调）
- 进度反馈 + 错误恢复（单文件失败不中断批量）

**技术方案**：
```typescript
// src/main/services/export-service.ts（新建）
import sharp from 'sharp';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

export interface ExportOptions {
  format: 'jpg' | 'png' | 'webp' | 'original';
  maxWidth?: number;
  quality?: number;               // 1-100
  outputPath: string;             // 目标目录或 ZIP 路径
}

export class ExportService {
  private abortControllers = new Map<string, AbortController>();

  async exportSingle(imagePath: string, opts: ExportOptions, taskId: string): Promise<string> {
    const ac = new AbortController();
    this.abortControllers.set(taskId, ac);
    let pipe = sharp(imagePath, { failOn: 'none' });
    if (opts.maxWidth) pipe = pipe.resize({ width: opts.maxWidth, withoutEnlargement: true });
    const outPath = this.resolveOutPath(imagePath, opts);
    if (opts.format === 'original') {
      // 直接复制
      await fsp.copyFile(imagePath, outPath);
    } else {
      await pipe.toFormat(opts.format, { quality: opts.quality ?? 90 }).toFile(outPath);
    }
    return outPath;
  }

  async exportBatch(imagePaths: string[], opts: ExportOptions, taskId: string,
                    onProgress: (done: number, total: number) => void): Promise<void> {
    const ac = new AbortController();
    this.abortControllers.set(taskId, ac);
    const output = createWriteStream(opts.outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', err => logger.warn('Export', err.message));
    archive.on('error', err => { throw err; });
    pipeline(archive, output);

    for (let i = 0; i < imagePaths.length; i++) {
      if (ac.signal.aborted) { archive.abort(); return; }
      try {
        const buf = await this.transformBuffer(imagePaths[i], opts);
        archive.append(buf, { name: path.basename(imagePaths[i]) });
      } catch (err) {
        logger.error('Export', `跳过失败文件 ${imagePaths[i]}`, err);
        // 单文件失败不中断，记录到 errorLog
      }
      onProgress(i + 1, imagePaths.length);
    }
    await archive.finalize();
  }

  cancel(taskId: string) {
    this.abortControllers.get(taskId)?.abort();
    this.abortControllers.delete(taskId);
  }
}
```

**验收标准**：
- [ ] 右键菜单"导出为..."打开 `ExportDialog`，支持格式/尺寸/质量选择
- [ ] 单图导出：目标目录写入成功，格式转换正确（Sharp 输出验证）
- [ ] 多选图片可批量导出为 ZIP，ZIP 内文件名与原名一致
- [ ] 导出进度条显示（IPC 事件 `export-progress` 每 100ms 节流）
- [ ] **支持取消**：中途取消后临时文件清理，无僵尸进程
- [ ] **单文件失败不中断批量**：错误记录到日志，成功文件正常输出
- [ ] 1000 张 4K 图批量导出 ZIP < 5 分钟（NVMe SSD 基线，写入附录 A）

**涉及文件**：
- `src/main/services/export-service.ts`（新建）
- `src/main/ipc/file-handlers.ts`（新增 `exportSingle` / `exportBatch` / `cancelExport` handlers）
- `electron/preload.ts`（暴露 `onExportProgress` 订阅）
- `src/components/file-ops/ExportDialog.tsx`（新建）
- `src/components/file-ops/FileContextMenu.tsx`（扩展"导出为..."入口）

---

## 🔧 工程化任务（贯穿全程）

### Task E.1：测试完善

**状态**：🟡 进行中（当前 135/135 通过）
**目标**：**按模块分解覆盖率**，避免"全局 80%" 一刀切

**分模块覆盖目标**：

| 新增模块 | 最低行覆盖率 | 关键用例 |
|---------|-------------|---------|
| `library-monitor.ts` | 70% | 探测成功/失败、状态变更广播、多库调度 |
| `themeStore.ts` | 80% | 模式切换、system 模式跟随、feature flag 关闭 |
| `highlight.tsx` | 90% | XSS 防护（含 `<script>` 文件名）、大小写匹配、空 keyword |
| `histogram.ts` | 75% | 降采样触发、通道计算、灰度图边界 |
| `slideshowStore.ts` | 70% | 随机模式、播放列表持久化、stop() 释放资源 |
| `export-service.ts` | 65% | 单图/批量、取消、单文件失败不中断 |
| `database.ts` 迁移 | 90% | 版本升级、失败回滚、幂等性 |

**预计新增**：**60-80 用例**（上调自 30-40，与工时匹配）

**验收标准**：
- [ ] 每个新模块达成上表覆盖率
- [ ] 全局行覆盖率 ≥ 70%（当前基线待 Task 5.1 首日采集）
- [ ] CI 上 `npm run test:run` 通过

---

### Task E.2：性能优化

**状态**：⬜ 未开始
**目标**：**先建立基线，再度量优化**

**执行节奏**：
1. **Phase 5 首日**：跑基线，填入下表 "当前" 列
2. **Phase 7 结束**：复测，验证是否达标
3. **不达标项**：立 issue 排入 Q1-2027

**性能基准表**：

| 指标 | 目标 | 基线（Phase 5 首日采集） | 复测（Phase 7 末） |
|------|------|------------------------|-------------------|
| 冷启动时间 | < 3s | 待测 | 待测 |
| 内存占用（10 万张库稳态） | < 500MB | 待测 | 待测 |
| 网格滚动帧率 | ≥ 30 FPS | 待测 | 待测 |
| 10 万张首次扫描（NVMe） | < 8 分钟 | 待测 | 待测 |
| 10 万张增量扫描（无变化） | < 30 秒 | 待测 | 待测 |
| 4K 图直方图计算 | < 100ms | 待测 | 待测 |
| 1000 张批量导出 ZIP | < 5 分钟 | 待测 | 待测 |

**待优化项（视基线结果决定优先级）**：
- [ ] 数据库批处理事务（当前单次插入）
- [ ] 路径索引优化（`images(library_id, relative_path)` 复合索引已存在，需 EXPLAIN QUERY PLAN 验证）
- [ ] 直方图计算 Web Worker 化（仅当 > 2000 万像素场景实测 > 150ms 时启用）

---

## 📅 交付时间线

| Week | Phase | 交付物 | 里程碑 |
|------|-------|--------|--------|
| **Week 1** | Phase 5 | 依赖引入 + 增量扫描收尾 + 离线库检测 + 搜索优化 | M1: 搜索体验闭环 + 性能基线报告 |
| **Week 2** | Phase 6 | 主题系统（含 feature flag）+ 直方图 + 文件夹封面 + DB 迁移 | M2: 个性化能力 + 迁移框架 |
| **Week 3** | Phase 7 前半 | 幻灯片增强（含音乐） | M3: 幻灯片完整版 |
| **Week 4** | Phase 7 后半 + 收尾 | 导出功能 + 性能复测 + 覆盖率验收 | M4: 完整交付 |

---

## ⚠️ 风险与依赖

### 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Windows 移动盘拔出检测不稳（chokidar） | 中 | 高 | **改用 `fs.access` 定时探测**（方案 A） |
| Tailwind v4 浅色主题变量遗漏 | 中 | 中 | 建立 token 检查清单 + 视觉回归截图对比 |
| 主题切换闪烁 | 低 | 中 | `index.html` 内联脚本预置 `data-theme` |
| 直方图大图性能瓶颈 | 中 | 中 | 200 万像素降采样 + 分级 SLA + 必要时 Worker |
| archiver 在 asar 打包后写入失败 | 低 | 高 | Task 7.0 冒烟验证 + 备选 `adm-zip` |
| DB 迁移失败破坏老用户数据 | 低 | 高 | 事务包裹 + `schema_version` 幂等 + 迁移前备份 `.ivlib/master.db.bak` |
| 导出大文件 ZIP 内存溢出 | 中 | 中 | 流式 `pipeline` + 单文件失败不中断 |
| feature flag 长期滞留 | 中 | 低 | Phase 7 末评估，达标则默认开启并清理 flag |

### 外部依赖

| 依赖 | 用途 | 版本 | 现有 | 风险 |
|------|------|------|------|------|
| `chokidar`（备选） | 文件监听 | ^3.6.0 | ❌ 需引入 | 中（若采用方案 A 可跳过） |
| `archiver` | ZIP 导出 | ^7.0.0 | ❌ 需引入 | 中（asar 打包待验证） |
| `sharp` | 直方图 / 导出转换 | ^0.34.5 | ✅ 已有 | 低 |
| `wavesurfer.js` | 幻灯片背景音乐 | ^7.12.8 | ✅ 已有 | 低 |
| `motion` | 过渡动画 | ^13.0.0 | ✅ 已有 | 低 |
| `recharts` | 直方图渲染 | ^3.10.1 | ✅ 已有 | 低 |
| `electron-store` | 主题 / 搜索历史 / 播放列表持久化 | ^11.0.2 | ✅ 已有 | 低 |
| ~~`color`~~ | ~~颜色转换~~ | — | — | **移除**（30 行工具函数替代） |

---

## 🔄 回滚策略

| 功能 | 回滚方式 | 触发条件 |
|------|---------|---------|
| 主题系统（6.1） | electron-store `theme.enabled = false` | 用户报告样式崩坏 / 视觉回归失败 |
| 文件夹封面（6.3） | `schema_version` 保留，UI 层不读取 `folder_covers` | 迁移失败 |
| 离线检测（5.2） | `LibraryMonitor.stop()` + 全库强制 `online` | 误报频繁 |
| 幻灯片音乐（7.1） | `slideshowStore.audioTrack = null` | wavesurfer 内存泄漏 |
| 导出（7.2） | 右键菜单隐藏"导出为..."入口 | ZIP 生成失败率高 |

**每个 feature flag 必须在 Phase 7 末评估：达标 → 默认开启并清理；不达标 → 排入下一 Quarter**。

---

## ✅ 验收标准汇总

### Phase 5（Week 1）
- [ ] 增量扫描日志显示 `总计/新增/更新/跳过/删除` 五字段统计
- [ ] 性能基线报告写入附录 A（含硬件配置）
- [ ] 离线库自动检测 + UI 状态同步（复用 `libraries.status`，5 秒内响应）
- [ ] 搜索历史 + 预设保存 + 高亮无 XSS

### Phase 6（Week 2）
- [ ] Tailwind v4 兼容的浅色 / 深色 / 系统三种主题模式
- [ ] 6 种预设强调色 + 自定义 HEX
- [ ] 界面密度三档
- [ ] RGB + 亮度直方图（分级 SLA 达标）
- [ ] 文件夹封面设置 + 缩略图显示
- [ ] DB 迁移框架（`schema_version`）落地，老库升级无异常
- [ ] feature flag 关闭可完全回退当前行为

### Phase 7（Week 3-4）
- [ ] 幻灯片过渡动画（淡入淡出 / 滑动 / 缩放）
- [ ] 随机播放 + 自定义播放列表（持久化）
- [ ] 背景音乐（复用 wavesurfer，退出释放资源）
- [ ] 单图 / 批量导出 + 格式转换 + 进度反馈 + 取消支持
- [ ] 单文件失败不中断批量

### 工程化（贯穿）
- [ ] 新增 60-80 单元测试，各模块达成分解覆盖率
- [ ] 全局行覆盖率 ≥ 70%
- [ ] 性能基准 Phase 5 采集 + Phase 7 复测报告
- [ ] DB 迁移幂等性验证

---

## 📎 附录 A：性能基线报告

> Phase 5 首日填写。

**测试环境**：
- CPU：待填
- 内存：待填
- 磁盘：待填（NVMe / SATA SSD / HDD）
- OS：Windows 22H2
- Node：待填 / Electron：^40.6.1

**基线数据**：

| 指标 | 冷启动 | 热启动 | 备注 |
|------|--------|--------|------|
| 应用启动时间 | 待测 | 待测 | 从双击到主窗口渲染完成 |
| 10 万张库首次扫描 | 待测 | — | 含元数据 + pHash |
| 10 万张库增量扫描（无变化） | — | 待测 | 双条件跳过生效 |
| 网格滚动 FPS（1000 张可见） | 待测 | 待测 | Chrome DevTools 采样 |
| 内存占用（稳态） | 待测 | 待测 | 任务管理器 Private Bytes |

---

## 📝 变更日志

| 日期 | 变更内容 | 作者 |
|------|----------|------|
| 2026-09-12 | 初始版本，整合 P0-P2 任务 | Claude |
| 2026-09-12 | **评审修订 v2**：修正 15 项问题 —— 依赖清单/DB 迁移策略/Tailwind v4 兼容/工时统一/XSS 防护/直方图分级 SLA/离线检测改用 fs.access/幻灯片音乐范围/导出工时上调/测试分模块覆盖率/任务依赖图/回滚 feature flag/需求追溯链接/变更日志规范/性能基线附录 | Claude |

---

**文档状态**：已评审（v2）
**下一步**：
1. Phase 5 首日跑性能基线，填入附录 A
2. 决策 Task 5.2 采用方案 A（推荐）或方案 B
3. 确认后启动 Task 5.0（依赖引入） + Task 5.1（增量扫描收尾）

