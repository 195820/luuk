---
title: Phase 2 实施计划 — 搜索与发现
description: 高级搜索、相似图片查找（pHash）、最近添加/修改、智能分类四项功能的完整实施计划
type: plan
status: archived
updated: 2026-08-30
archived: 2026-08-30
---

# Phase 2 实施计划：搜索与发现（Search & Discovery）

> 对应 `roadmap.md` 推荐执行顺序第三轮：高级搜索（#1）→ 相似图片查找（#17）→ 最近添加/修改（#9）→ 智能分类（#10）。
> 前置状态：Phase 1（文件操作）与 Phase 1.5（技术债清理）已全部完成并合并主干，71/71 测试通过。

---

## 一、背景与范围

### 1.1 范围确认（已与用户确认）

| 功能 | roadmap 条目 | 预估工时 | 风险 |
|---|---|---|---|
| 高级搜索面板 | #1 | 1.5 天 | 中 |
| 最近添加 / 最近修改视图 | #9 | 0.5 天 | 低 |
| 智能分类（分组视图） | #10 | 1 天 | 中 |
| 相似/重复图片查找（pHash） | #17 | 2.5-3 天 | 高 |

**执行顺序刻意将风险最高的相似图链路（Task 6-8）放在最后**，低风险功能先行交付，避免高难度任务阻塞整体进度（沿用 Phase 1.5 的风险排序原则）。

### 1.2 关键设计决策

1. **限定当前库**：搜索与相似查找均作用于当前库的 `thumbs.db`（多库分库架构，每库独立 SQLite）。全局跨库搜索/相似查找推后——避免遍历多库的性能失控，且与用户确认一致。相似图比对量 = 1 张基准图 × 库内全量，百万级约 100ms 量级，可控。
2. **pHash 自研，零新增依赖**：用现有 `sharp`（resize 32×32 灰度 → DCT → 中值阈值 → 64bit → 16 位 hex）。不引入 `imghash`——Phase 1 已验证 ESM-only 第三方依赖的治理成本（`trash`/`wallpaper`/`electron-store` 均需 externals 处理），自研约 60 行纯函数，可单测、可控制。
3. **跨库条件（收藏/评分）走路径集交集**：`favorites`/`rating` 在 `master.db`，图片元数据在 `thumbs.db`，两个独立 SQLite 无法 JOIN。策略：先查 `master.db` 得收藏路径集合（收藏是用户手动行为，通常 <1 万条），再对 `thumbs.db` 分块 `IN` 查询（SQLite 参数上限 999，按 900 个/批）。路径集超过 5 万时降级为「先按其他条件查询、结果在 JS 内用 Set 过滤」。
4. **最近视图沿用负 ID 模式**：`FAVORITE_LIBRARY_ID = -1` 已有先例（`src/stores/imageStore.ts` L17）。新增 `RECENT_ADDED_ID = -2`、`RECENT_MODIFIED_ID = -3`，复用 `loadImages` 的负 ID 分发逻辑。
5. **分组状态放 `viewStore`**：`groupBy` 属视图状态，带 localStorage 持久化（仿 `gridLayoutMode` 的既有模式）。排序字段（`imageSortBy`/`imageSortOrder`）保留在 `imageStore`，职责边界不变。
6. **迁移安全**：`images.phash` 列与新索引通过 `PRAGMA table_info` 检测后 `ALTER TABLE`，存量库平滑升级；新建库走 `CREATE TABLE` 直接带列。
7. **IPC 纯命名风格**（`searchImages`、`findSimilarImages`、`startPhashBackfill`），与现有 `getImages`/`moveFiles` 等通道一致，禁止 `xxx:action` 前缀风格。

### 1.3 性能红线（来自 requirements.md，任何功能不得突破）

- 启动时间 < 3s
- 内存占用 < 500MB
- 滚动帧率 ≥ 30 FPS
- 附加约束：百万级库单次搜索响应 < 2s；pHash 回填不得阻塞扫描与浏览（批间 `setImmediate` 让出）

---

## 二、文件结构总览

```
新增：
  src/main/ipc/search-handlers.ts          # 搜索/相似图/回填 IPC（registerSearchHandlers）
  src/main/utils/phash.ts                  # DCT pHash + hammingDistance（纯函数，可单测）
  src/main/services/__tests__/phash.test.ts
  src/main/services/__tests__/search.test.ts
  src/stores/searchStore.ts                # 搜索条件与结果状态
  src/stores/similarStore.ts               # 相似图结果状态
  src/components/SearchPanel.tsx           # 顶部折叠搜索面板
  src/components/SimilarImagesPanel.tsx    # 相似图结果面板
  src/utils/group.ts                       # 前端分组工具（纯函数，可单测）
  src/utils/__tests__/group.test.ts

修改：
  src/main/services/database.ts            # ThumbnailsDB：searchImages/findSimilar/migratePhash/索引
  src/main/services/image-service.ts       # 搜索与相似的服务层方法（含收藏交集逻辑）
  src/main/services/scanner.ts             # 索引新图片时计算 pHash（仅 media_type=image）
  electron/main.ts                         # registerSearchHandlers()（约 L192 registerFileHandlers 之后）
  electron/preload.ts                      # 暴露 4 个新通道 + phashProgress 事件
  src/types/index.ts                       # SearchCriteria/SearchResult/SimilarResult 类型
  src/stores/index.ts                      # 导出 useSearchStore/useSimilarStore
  src/stores/imageStore.ts                 # 负 ID 常量 + loadImages/applySort 分发
  src/stores/viewStore.ts                  # groupBy 状态 + localStorage 持久化
  src/components/FolderTree.tsx            # 「最近添加/最近修改」虚拟条目
  src/components/SortControl.tsx           # 分组下拉（与排序并列的独立控件）
  src/components/ImageGrid.tsx             # 组标题渲染 + 相似图右键项
  src/components/MasonryGrid.tsx           # 同上
  src/components/file-ops/FileContextMenu.tsx  # items 增加「查找相似图片」
  src/App.tsx                              # 搜索入口（Ctrl+F）、最近视图分发、相似面板挂载
```

---

## 三、Task 分解（9 个，按执行顺序）

### Task 1：数据库搜索层 + 单元测试【风险：中｜1 天】

**目标**：`ThumbnailsDB` 支持多条件组合搜索，补齐时间字段索引。

**步骤**：

1. `src/main/services/database.ts` 的 `initSchema` 中追加索引（`CREATE INDEX IF NOT EXISTS` 幂等）：
   ```sql
   CREATE INDEX IF NOT EXISTS idx_images_created_time ON images(created_time);
   CREATE INDEX IF NOT EXISTS idx_images_modified_time ON images(modified_time);
   CREATE INDEX IF NOT EXISTS idx_images_indexed_time ON images(indexed_time);
   ```
2. 同文件新增 `searchImages(criteria: SearchCriteria, options: { limit: number; offset: number }): { images: Image[]; total: number }`：
   - 动态 WHERE 构造：每个启用条件追加 `AND xxx`，全部参数化（`?` 占位，禁止字符串拼接值）。
   - 固定前置条件 `is_deleted = 0`。
   - 文件名模糊：`relative_path LIKE ?`（值形如 `%keyword%`，由调用方拼通配符；注释说明前缀 `%` 导致无法走索引，百万级下实测 <1s 可接受）。
   - 收藏/评分交集：`criteria.favoritePaths?: string[]` 由服务层传入（见 Task 2），按 900 个一批拆成 `(relative_path IN (...) OR relative_path IN (...))`；`favoritePaths` 为 `null` 表示不加该条件，为空数组表示「收藏条件下无命中」直接返回空。
   - `total` 用同条件 `SELECT COUNT(*)` 单独查询（供前端分页）。
   - 排序固定 `ORDER BY created_time DESC`（搜索场景按新到旧），不暴露自定义排序（避免与分组功能耦合）。
3. `SearchCriteria` 类型（同步写入 `src/types/index.ts`）：
   ```typescript
   export interface SearchCriteria {
     fileName?: string
     formats?: string[]          // ['jpg','png']，小写无点
     minWidth?: number
     maxWidth?: number
     minHeight?: number
     maxHeight?: number
     minFileSize?: number        // 字节
     maxFileSize?: number
     createdFrom?: string        // ISO 日期 '2026-01-01'
     createdTo?: string
     mediaType?: 'image' | 'video' | 'audio'
     minRating?: number          // 1-5，隐含「必须已收藏」
     favoritePaths?: string[] | null  // 服务层填充，渲染层不传
   }
   ```
   注意：`minRating` 与收藏同源（评分存在 `favorites.rating`，见 `database.ts` L81），服务层统一转为路径集。
4. 单元测试 `src/main/services/__tests__/search.test.ts`（仿现有 `database-cascade.test.ts` 的临时库模式）：
   - 单条件命中：文件名模糊、格式、尺寸范围、大小范围、日期范围
   - 组合条件：格式 + 尺寸 + 收藏交集
   - 边界：空条件返回全量、无命中返回 `{ images: [], total: 0 }`、`favoritePaths: []` 直接返回空
   - 分块：构造 >900 条路径验证分块拼接正确
   - 分页：`limit/offset` 与 `total` 一致性
5. **提交**：`feat: 数据库搜索层 — searchImages 多条件查询与时间索引`

**验收**：新增 ≥8 个用例全绿；`npx tsc --noEmit` 无错误。

---

### Task 2：服务层 + IPC + preload + 类型【风险：中｜0.5 天】

**目标**：打通主进程搜索链路，收藏/评分交集逻辑收敛在服务层。

**步骤**：

1. `src/main/services/image-service.ts` 新增：
   ```typescript
   searchImages(libraryId: number, criteria: SearchCriteria, options: { limit: number; offset: number }) {
     const library = this.masterDB.getLibrary(libraryId);
     if (!library) throw new Error(`库不存在：${libraryId}`);
     // 收藏/评分交集：先查 master.db
     let favoritePaths: string[] | null = null;
     if (criteria.minRating !== undefined) {
       favoritePaths = this.masterDB.getFavoritePathsByMinRating(libraryId, criteria.minRating);
     }
     const db = this.connectLibrary(libraryId);
     const { images, total } = db.searchImages({ ...criteria, favoritePaths }, options);
     return { images: images.map(img => this.mapImageWithLibraryInfo(img, libraryId, library.name)), total };
   }
   ```
   - `masterDB.getFavoritePathsByMinRating(libraryId, minRating)` 为 `database.ts` MasterDB 新增方法：`SELECT image_path FROM favorites WHERE library_id = ? AND rating >= ?`。
   - 路径集 >5 万条时：不传 `favoritePaths`，改为在结果映射阶段用 `Set` 过滤（`criteria` 内联标记），并在返回中修正 `total`——在代码注释中说明该降级路径。
2. 新建 `src/main/ipc/search-handlers.ts`（仿 `file-handlers.ts` 结构）：
   ```typescript
   export function registerSearchHandlers(): void {
     const service = getImageService();
     ipcMain.handle('searchImages', async (_e, libraryId, criteria, options) => {
       try { return { success: true, ...service.searchImages(libraryId, criteria, options) }; }
       catch (err) { return { success: false, error: (err as Error).message }; }
     });
     // findSimilarImages / startPhashBackfill / stopPhashBackfill 在 Task 6/7 补充
   }
   ```
3. `electron/main.ts` 约 L192 `registerFileHandlers()` 之后调用 `registerSearchHandlers()`；`unregister` 对称处理（`window-all-closed` 处，参考 `unregisterLibraryHandlers()` 的既有写法）。
4. `electron/preload.ts` 的 `electronAPI` 增加：
   ```typescript
   searchImages: (libraryId: number, criteria: SearchCriteria, options: { limit: number; offset: number }) =>
     ipcRenderer.invoke('searchImages', libraryId, criteria, options),
   ```
5. `src/types/index.ts` 补 `SearchResult`（`{ success: boolean; images: Image[]; total: number; error?: string }`）。
6. 手动冒烟：在开发者工具 console 调 `window.electronAPI.searchImages(1, { formats: ['jpg'] }, { limit: 10, offset: 0 })` 验证链路。
7. **提交**：`feat: 搜索 IPC 链路 — searchImages 通道与收藏评分交集`

**验收**：console 冒烟返回正确结果；`getFavoritePathsByMinRating` 单测 2 例（有/无命中）。

---

### Task 3：searchStore + SearchPanel UI + Ctrl+F【风险：中｜1 天】

**目标**：顶部折叠搜索面板，结果区复用 `ImageGrid`。

**步骤**：

1. 新建 `src/stores/searchStore.ts`：
   ```typescript
   interface SearchState {
     active: boolean                    // 面板是否展开
     searching: boolean
     criteria: SearchCriteria           // 表单双向绑定
     results: Image[]
     total: number
     hasSearched: boolean               // 区分「未搜索」与「搜索无结果」
     openPanel: () => void
     closePanel: () => void             // 同时清空结果，恢复正常浏览
     setCriteria: (patch: Partial<SearchCriteria>) => void
     search: (libraryId: number, offset?: number) => Promise<void>   // 内部分页累加
     loadMore: (libraryId: number) => Promise<void>
   }
   ```
   并在 `src/stores/index.ts` 导出 `useSearchStore`。
2. 新建 `src/components/SearchPanel.tsx`：
   - 顶部折叠面板（`motion/react` 展开动画，仿项目既有 `motionPresets` 用法）。
   - 字段：文件名输入框、宽/高范围、文件大小范围（带单位下拉 KB/MB）、格式多选（jpg/jpeg/png/webp/gif/bmp 芯片）、拍摄日期范围（两个 `<input type="date">`）、最低评分（1-5 下拉）。
   - 「搜索」「清空」按钮；回车触发搜索。
   - 结果统计行：`共 N 张（已加载 M 张）`。
3. `src/App.tsx` 集成：
   - 工具栏（现有排序控件旁，参考 `SortControl` 挂载位置）加搜索图标按钮（`lucide-react` 的 `Search`）。
   - 全局快捷键 `Ctrl+F`：在现有 `keydown` 监听处（与 `F5` 切换视图同一处）追加分支；打开面板时 `Esc` 关闭。
   - `hasSearched` 为真时，网格区渲染搜索结果（`ImageGrid` 的 `images` 换为 `searchStore.results` 的映射结果，`onImageClick` 等回调复用现有处理），并隐藏文件夹树侧边栏；滚动到底触发 `loadMore`。
   - **切换库时** `closePanel()`（在 `setCurrentLibrary` 调用处联动），避免跨库残留结果。
4. 手动回归：单条件/组合搜索、清空恢复、切库清空、Ctrl+F 开、Esc 关、滚动加载更多。
5. **提交**：`feat: 高级搜索面板 — SearchPanel、searchStore 与 Ctrl+F 入口`

**验收**：上述 6 项手动回归全过；无 TS 错误。

---

### Task 4：最近添加 / 最近修改视图【风险：低｜0.5 天】

**目标**：侧边栏两个虚拟入口，按 `indexed_time`/`modified_time` 倒序。

**步骤**：

1. `src/stores/imageStore.ts`：
   - L17 `FAVORITE_LIBRARY_ID` 旁新增 `export const RECENT_ADDED_ID = -2`、`export const RECENT_MODIFIED_ID = -3`。
   - `loadImages`（L283 起）负 ID 分发：现有逻辑是 `=== FAVORITE_LIBRARY_ID` 时置空返回；改为三分支——`-2` 调 `getImages(libraryId=真实库?, ...)`。注意：**最近视图依附于「当前真实库」**，实现上在 `imageStore` 记录 `lastRealLibraryId`（切到负 ID 前保存），加载时用真实库 ID 查询：
     ```typescript
     // -2: orderBy='indexed_time', order='DESC'
     // -3: orderBy='modified_time', order='DESC'
     await window.electronAPI.getImages(lastRealLibraryId, { limit, offset, orderBy, order: 'DESC' })
     ```
     （`getImages` 已支持 `orderBy`/`order`，见 `database.ts` L760，`validateOrderBy` 需确认白名单含这两个字段，缺则补。）
   - `applySort`（L611 附近）补两个负 ID 分支，重新调 `loadImages`。
   - `loadFolderTree`（L261 附近）对所有负 ID 置空 `folderTree`。
2. `src/components/FolderTree.tsx`：非收藏库时，在文件夹列表上方渲染两个固定条目（`Clock`/`History` 图标 + 「最近添加」「最近修改」），点击调 `setCurrentLibrary(RECENT_ADDED_ID)`；选中态高亮与现有文件夹选中样式一致。
3. `src/App.tsx`：负 ID 时隐藏文件夹侧边栏与搜索入口（与 `FAVORITE_LIBRARY_ID` 的处理方式对齐，`isFavoriteLibrary` 判断处同步扩展为 `isVirtualLibrary`）。
4. 手动回归：两个入口加载顺序正确、翻页正常、切回真实库恢复、收藏库下不显示该入口。
5. **提交**：`feat: 最近添加/最近修改虚拟视图（负 ID 模式）`

**验收**：4 项手动回归全过。

---

### Task 5：智能分类（分组视图）【风险：中｜1 天】

**目标**：网格按 日/月/格式/纵横比 分组显示组标题。

**步骤**：

1. 新建 `src/utils/group.ts` 纯函数：
   ```typescript
   export type GroupBy = 'none' | 'day' | 'month' | 'format' | 'aspect'
   export function groupImages<T extends { created_time?: string; format?: string; width?: number; height?: number }>(
     images: T[], groupBy: GroupBy
   ): Array<{ key: string; label: string; items: T[] }>
   ```
   - `day`：`created_time` 取 `YYYY-MM-DD`（缺失归入「未知日期」组）；`month` 取 `YYYY-MM`；`format` 大写；`aspect`：`width >= height` → 横向，否则纵向（缺尺寸归「未知」）。
   - 组顺序：`day`/`month` 按时间倒序，其余按数量倒序。
2. `src/stores/viewStore.ts`：加 `groupBy: GroupBy`（初始读 `localStorage.getItem('groupBy')`）+ `setGroupBy`（写 localStorage，完全仿 `gridLayoutMode` 的 L36-39 既有写法）。
3. `src/components/SortControl.tsx`：排序下拉旁增加分组下拉（复用同款 `select` 样式），选项：不分组/按拍摄日/按月/按格式/按纵横比；值绑定 `viewStore.groupBy`。
4. `src/components/ImageGrid.tsx` 与 `MasonryGrid.tsx`：
   - `useMemo` 对已加载 `images` 分组；`groupBy === 'none'` 时走现有渲染（零性能影响）。
   - 分组时渲染粘性组标题条（`sticky top-0`，液态玻璃风格 `bg-glass-l1`，显示 `label (N)`）。
   - **注意**：分组仅作用于已加载的分页数据（`loadImages` 分页 100 张累加），组标题会随滚动加载动态补入，属预期行为，在组件注释中说明。
5. 单元测试 `src/utils/__tests__/group.test.ts`：4 种分组键正确性、缺失字段归组、组顺序、`none` 返回单组。
6. 手动回归：四种分组渲染正确、切换布局（网格/瀑布流）分组保持、滚动帧率不掉（目测 ≥30FPS）、localStorage 持久化生效。
7. **提交**：`feat: 智能分类 — 分组视图（日/月/格式/纵横比）`

**验收**：≥6 个单测全绿；4 项手动回归全过。

---

### Task 6：pHash 计算与存储【风险：高｜1.5 天】

**目标**：`phash` 列迁移 + 自研 DCT pHash + 扫描时增量计算。

**步骤**：

1. 新建 `src/main/utils/phash.ts`（纯逻辑，sharp 之外可单测）：
   ```typescript
   export async function computePhash(filePath: string): Promise<string> {
     // sharp(filePath).resize(32, 32, { fit: 'fill' }).grayscale().raw().toBuffer()
     // → 32×32 DCT（双重循环，1024 点，纯数值计算 <1ms）
     // → 取左上 8×8（排除 [0][0] 直流分量共 63 项）与中值比较 → 64 bit
     // → BigInt 转 16 位 hex（padStart(16, '0')）
   }
   export function hammingDistance(a: string, b: string): number {
     // BigInt('0x'+a) ^ BigInt('0x'+b)，循环 n & 1n 计位数
   }
   ```
   - 损坏/不支持文件抛错，由调用方捕获跳过（不中断扫描）。
2. `src/main/services/database.ts` `ThumbnailsDB.initSchema`：
   - 新建库：`images` 表定义加 `phash TEXT`。
   - 存量库：`PRAGMA table_info(images)` 检测无 `phash` 列则 `ALTER TABLE images ADD COLUMN phash TEXT`。
   - 索引：`CREATE INDEX IF NOT EXISTS idx_images_phash ON images(phash)`（phash 非空才建意义的查询，索引供 `WHERE phash IS NULL` 回填筛选与未来索引查询）。
3. `src/main/services/scanner.ts`：索引新图片处（`calculateFileHash` 调用点附近），仅当 `media_type === 'image'` 时追加 `phash = await computePhash(absPath)`，失败置 `null` 并 `logger.warn`，不阻塞。`addImages` 参数白名单需放行 `phash`。
4. 单元测试 `src/main/services/__tests__/phash.test.ts`：
   - `hammingDistance`：相同为 0、已知异或结果、非法输入抛错
   - 用 `sharp` 在测试内生成两张 32×32 纯色图（红/蓝）：各自稳定出 16 位 hex、相同图重复计算一致、差异图距离 >0
   - `database`：迁移幂等（二次 `initSchema` 不报错）、`phash IS NULL` 可查
5. 手动验证：对 `test-data/1111113` 重新扫描，确认图片记录 `phash` 非空、视频/音频为 `null`。
6. **提交**：`feat: pHash 计算 — DCT 实现、phash 列迁移与扫描增量计算`

**验收**：≥8 个单测全绿；存量库打开无迁移报错（用 `test-library` 验证）。

---

### Task 7：存量库后台回填【风险：高｜1 天】

**目标**：存量百万级库可增量补齐 phash，进度可见、可随时停止续跑。

**步骤**：

1. `src/main/services/image-service.ts` 新增回填逻辑：
   ```typescript
   private backfillRunning: { libraryId: number; stopped: boolean } | null = null;
   async startPhashBackfill(libraryId: number) {
     // 若已有任务在跑，返回 { success: false, error: '已有回填任务进行中' }
     // 循环：SELECT id, relative_path FROM images WHERE phash IS NULL AND media_type = 'image' LIMIT 100
     // 逐张 computePhash → UPDATE images SET phash = ? WHERE id = ?（每批事务）
     // 每 50 张：BrowserWindow.getAllWindows()[0]?.webContents.send('phashProgress', { libraryId, done, remaining, percent })
     // 每张之间 setImmediate() 让出，避免阻塞其他 IPC
     // 全部完成：发送 { percent: 100, finished: true }
   }
   stopPhashBackfill() { this.backfillRunning!.stopped = true }  // 循环检查该标志
   ```
   - **续跑即停止**：基于 `phash IS NULL` 筛选，停止后再次启动自动从未完成处继续，无需持久化进度。
   - 扫描与回填并发：回填只写 `phash` 列，扫描写整行但 `UPDATE ... SET phash` 用独立条件，冲突窗口极小；回填的 UPDATE 前校验记录仍存在（`changes === 0` 跳过）。
2. `search-handlers.ts` 补 `startPhashBackfill`/`stopPhashBackfill` 两个 `ipcMain.handle`。
3. `preload.ts`：
   ```typescript
   startPhashBackfill: (libraryId: number) => ipcRenderer.invoke('startPhashBackfill', libraryId),
   stopPhashBackfill: () => ipcRenderer.invoke('stopPhashBackfill'),
   onPhashProgress: (cb: (p: PhashProgress) => void) => {
     const listener = (_e: any, data: PhashProgress) => cb(data);
     ipcRenderer.on('phashProgress', listener);
     return () => ipcRenderer.removeListener('phashProgress', listener);
   },
   ```
4. 手动验证：对 `test-data/huge-library`（7780 文件）启动回填，进度事件连续推送、中途停止、再启动从断点继续、完成后 `SELECT COUNT(*) FROM images WHERE phash IS NULL AND media_type='image'` 为 0；回填期间滚动浏览不掉帧。
5. **提交**：`feat: pHash 存量回填 — 后台任务、进度推送与断点续跑`

**验收**：上述 5 项手动验证全过。

---

### Task 8：相似图片查找 UI【风险：中｜1 天】

**目标**：右键「查找相似图片」→ 结果面板（相似度排序、阈值可调、支持多选与文件操作）。

**步骤**：

1. `image-service.ts` + `database.ts`：
   ```typescript
   // database.ts：getImagesWithPhash(): Array<{ id, relative_path, phash }>（WHERE phash IS NOT NULL AND is_deleted = 0 AND media_type='image'）
   // image-service.ts：
   findSimilarImages(libraryId: number, imagePath: string, threshold: number, limit = 200) {
     // 取基准图 phash（getImageByRelativePath）；无 phash 返回 { error: '该图片尚未计算指纹，请先完成回填' }
     // 拉取全库 phash 列表，逐一 hammingDistance，过滤 <= threshold
     // 按距离升序取 limit 条，映射 mapImageWithLibraryInfo，附 distance 字段
   }
   ```
   性能说明：百万条 `BigInt` 异或约 100-200ms，同步可接受；若实测超 500ms 再改 Worker（计划内不做）。
2. `search-handlers.ts` 补 `findSimilarImages` 通道；`preload.ts` 同步暴露。
3. `src/stores/similarStore.ts`：`{ open, sourceImage, threshold(默认 10), results, loading, findSimilar(), setThreshold(), close() }`；`stores/index.ts` 导出。
4. `src/components/file-ops/FileContextMenu.tsx`：`items` 数组追加 `{ id: 'findSimilar', label: '查找相似图片', icon: ScanSearch }`（仅图片项展示，视频/音频由调用方判断或面板内提示）。
5. `ImageGrid.tsx`/`MasonryGrid.tsx` 的 `handleMenuAction`：`findSimilar` 分支调 `similarStore.findSimilar(libraryId, imagePath)`。
6. 新建 `src/components/SimilarImagesPanel.tsx`：
   - 右侧滑出面板或替换网格区（与搜索结果同层级互斥：打开相似面板时关闭搜索）。
   - 顶部：基准图缩略图 + 阈值滑块（0-20，`input[type=range]`，变更自动重查，防抖 300ms）+ 结果数。
   - 结果区复用 `ImageGrid`（`images` 来自 `similarStore.results`），相似度百分比 = `(1 - distance / 64) × 100` 以角标显示（扩展 `ImageGridItem` 的可选 `badge` prop，默认不渲染，零侵入）。
   - 结果继承多选与右键文件操作（`ImageGrid` 自带）。
7. 手动回归：右键入口出结果、阈值收紧/放宽、基准图无 phash 时的提示、结果双击进查看器、面板关闭状态清理。
8. **提交**：`feat: 相似图片查找 — 右键入口与 SimilarImagesPanel`

**验收**：5 项手动回归全过；`findSimilarImages` 对 `huge-library` 实测 <500ms 并记录。

---

### Task 9：最终验证 + 文档收口【风险：低｜0.5 天】

**步骤**：

1. 全量测试：`npx vitest run`（目标 ≥ 71 + 22 新增 = 93 通过）、`npx tsc --noEmit`、`npm run build` 产出安装包。
2. 手动回归清单（8 项）：
   - Ctrl+F 打开搜索、组合条件命中、切库清空
   - 最近添加/修改排序正确、切回正常
   - 四种分组渲染 + 持久化
   - 相似图右键 → 面板 → 阈值 → 多选操作
   - 回填启动/停止/续跑
   - 性能红线：启动 <3s、内存 <500MB（任务管理器）、滚动不掉帧
3. `docs/roadmap.md` 回写：#1/#9/#10/#17 标 ✅（附实施日期与计划链接）；「推荐执行顺序」第三轮标记完成；进度注释行更新。
4. 本计划文档移入 `docs/archive/superpowers/plans/`，front matter 改 `status: archived`——**注意：复制与删除必须在同一次提交内完成**（Phase 1.5 归档曾遗漏删除导致 HEAD 双份）。
5. **提交**：`chore: Phase 2 收尾 — 文档归档与 roadmap 回写`

---

## 四、风险评估与应对

| 风险 | 等级 | 应对 |
|---|---|---|
| DCT pHash 实现错误导致相似图不可用 | 高 | Task 6 先落纯函数单测（已知图像对验证），再集成扫描 |
| 存量百万级回填耗时数小时 | 高 | 后台任务 + 断点续跑设计；用户可分多次挂机完成，不阻塞使用 |
| 收藏交集在超大收藏集下 SQL 膨胀 | 中 | >5 万条降级为 JS Set 过滤（Task 2 已内置） |
| 分组渲染拖累滚动帧率 | 中 | `none` 分支零开销；`useMemo` 缓存；手动回归含帧率目测 |
| `validateOrderBy` 白名单缺新字段导致最近视图加载失败 | 低 | Task 4 第 1 步显式核实并补齐 |
| phash 迁移在异常中断下不一致 | 低 | `PRAGMA` 检测幂等；回填以 `IS NULL` 为准，天然自愈 |

## 五、依赖与配置

- **零新增 npm 依赖**（pHash 自研，`sharp` 已有）。
- `vite.config.ts` 无需改动（无新 ESM 包）。
- 新增 IPC 通道 4 个：`searchImages`、`findSimilarImages`、`startPhashBackfill`、`stopPhashBackfill`；事件 1 个：`phashProgress`。

## 六、验收标准

1. 单元测试总数 ≥90 且全绿；`tsc` 零错误；安装包构建成功。
2. 百万级库：搜索 <2s、相似查找 <500ms、回填不阻塞浏览。
3. 性能红线三项不破：启动 <3s、内存 <500MB、滚动 ≥30FPS。
4. roadmap 回写完成，计划文档原子归档（复制+删除同一提交）。

## 七、分支与提交

- 分支：`phase-2-search-discovery`
- 每 Task 一次提交（9 个），消息前缀见各 Task；可单独回滚。
- 预估总工时：**6-7 天**（搜索 2.5 + 最近 0.5 + 分组 1 + 相似图 3 + 收口 0.5，含少量缓冲）。
