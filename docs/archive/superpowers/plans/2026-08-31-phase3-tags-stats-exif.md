---
title: Phase 3 实施计划 — 标签 / 库统计 / EXIF
description: 标签系统（独立标签表）、库统计面板（recharts）、EXIF 查看器（exifreader）三项功能的完整实施计划
type: plan
status: archived
updated: 2026-08-31
archived: 2026-08-31
---

# Phase 3 实施计划：标签 / 库统计 / EXIF

> 对应 `roadmap.md` 推荐执行顺序第四轮：标签系统（#18）→ 库统计（#16）→ EXIF 查看器（#15）。
> 前置状态：Phase 2（搜索与发现）已完成并合并主干，99/99 测试通过。

---

## 一、背景与范围

### 1.1 范围确认（已与用户确认）

| 功能 | roadmap 条目 | 预估工时 | 风险 |
|---|---|---|---|
| 标签系统（编辑/筛选/标签云） | #18 | 2.5 天 | 高（触及级联核心） |
| 库统计面板（总数/大小/格式分布/时间线） | #16 | 1 天 | 低 |
| EXIF 信息查看器（拍摄时间/相机参数/GPS） | #15 | 1 天 | 低 |

测试完善（9 个待手动执行的归档用例）按用户决定继续留待人工，不纳入本阶段。

### 1.2 关键设计决策

1. **独立标签表（已确认）**：`master.db` 新建 `tags` + `image_tags` 两张表，标签可打任意图片（不限于收藏），与收藏/评分解耦。`favorites.tags` 旧 JSON 列**保留只读不迁移**（收藏视图旧标签展示不受影响，避免数据搬迁风险）。
2. **路径级联扩展（本阶段最高风险）**：`image_tags` 以 `library_id + image_path` 为键，与 `favorites` 同构。`updateImagePath`（`database.ts` L518）与 `updateFolderPath`（L536）现有事务内必须追加 `image_tags` 的级联 UPDATE，否则重命名/移动/批量重命名后标签全部失联。这是触碰 Phase 1 核心机制的改动，放在 Task 1 最先做、测试先行。
3. **标签筛选复用搜索交集机制**：`SearchCriteria` 扩展 `tagIds?: number[]`，服务层查 `image_tags` 得路径集，与现有 `favoritePaths` 链路（`image-service.ts` L263-288 的分块 IN + >5 万 JS 降级）**合并后走同一通道**，前端标签云筛选复用搜索结果视图，零新渲染路径。
4. **库统计走单库聚合**：`thumbs.db` 上四条聚合查询（总量/格式分布/媒体类型/月度时间线），百万级单查询 <2s 可接受；不预计算、不缓存（首版求简，面板打开时实时查）。
5. **EXIF 惰性解析**：`exifreader` 在主进程按需解析（信息面板打开时请求），不入库不预扫。只读文件头 1MB（EXIF 几乎总在文件头），避免大文件全量读入内存。
6. **EXIF 入口复用**：`ImageViewer` 已有 Info 按钮与信息面板（L475-481、`showInfo` 状态），EXIF 是**扩展该面板**追加字段区，不新增按钮。
7. **依赖新增两个**：`recharts`（渲染端，无 externals 问题）、`exifreader`（主进程，双格式发布无 ESM 风险，仍按惯例验证打包产物）。

### 1.3 性能红线（来自 requirements.md，不得突破）

- 启动时间 < 3s
- 内存占用 < 500MB
- 滚动帧率 ≥ 30 FPS
- 附加约束：百万级库统计查询 <2s；EXIF 单图解析 <500ms；标签筛选响应与普通搜索同级（<2s）

---

## 二、文件结构总览

```
新增：
  src/main/ipc/tag-handlers.ts             # 标签 IPC（registerTagHandlers）
  src/main/utils/exif.ts                   # exifreader 解析封装（纯函数化提取逻辑）
  src/main/services/__tests__/tag.test.ts  # 标签 CRUD + 级联测试
  src/main/services/__tests__/stats.test.ts
  src/components/TagDialog.tsx             # 打标 + 标签管理双标签页对话框
  src/components/TagCloudPanel.tsx         # 标签云面板
  src/components/StatsPanel.tsx            # 库统计面板（recharts）
  src/stores/tagStore.ts                   # 标签列表与筛选状态

修改：
  src/main/services/database.ts            # MasterDB：tags/image_tags 建表、7 个方法、级联扩展
                                           # ThumbnailsDB：getLibraryStats
  src/main/services/image-service.ts       # searchImages 合并 tagPaths 与 favoritePaths
  electron/main.ts                         # registerTagHandlers（含反注册）
  electron/preload.ts                      # 标签 7 通道 + getLibraryStats + getExifInfo
  src/types/index.ts                       # Tag/TaggedImage/LibraryStats/ExifInfo 类型
                                           # SearchCriteria 扩展 tagIds；ElectronAPI 接口补新通道声明
  src/stores/index.ts                      # 导出 useTagStore
  src/stores/searchStore.ts                # criteria 支持 tagIds
  src/components/file-ops/FileContextMenu.tsx  # 「标签...」菜单项
  src/components/ImageGrid.tsx / MasonryGrid.tsx  # 菜单动作分发 + 缩略图角标（已打标标记）
  src/components/ImageViewer.tsx           # 信息面板追加 EXIF 区
  src/App.tsx                              # 标签云入口（工具栏）、统计入口（库面板）、对话框挂载
  package.json                             # + recharts + exifreader
```

---

## 三、Task 分解（8 个，按执行顺序）

### Task 1：标签数据层 + 路径级联扩展【风险：高｜1 天】

**目标**：标签表落地、CRUD 完备、路径级联覆盖 `image_tags`，测试先行。

**步骤**：

1. `src/main/services/database.ts` 的 `MasterDB.initSchema` 追加：
   ```sql
   CREATE TABLE IF NOT EXISTS tags (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT UNIQUE NOT NULL,
     color TEXT DEFAULT '#888888',
     created_at TEXT DEFAULT CURRENT_TIMESTAMP
   );
   CREATE TABLE IF NOT EXISTS image_tags (
     tag_id INTEGER NOT NULL,
     library_id INTEGER NOT NULL,
     image_path TEXT NOT NULL,
     created_at TEXT DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (tag_id, library_id, image_path),
     FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
   );
   CREATE INDEX IF NOT EXISTS idx_image_tags_path ON image_tags(library_id, image_path);
   ```
2. `MasterDB` 新增方法（全部参数化）：
   - `createTag(name, color): Tag`（重名抛错，由 handler 转友好提示）
   - `deleteTag(id)` / `renameTag(id, name, color?)`
   - `tagImages(tagIds: number[], libraryId, paths: string[])`（INSERT OR IGNORE 批量）
   - `untagImages(tagIds, libraryId, paths)`
   - `getImageTags(libraryId, imagePath): Tag[]`
   - `getTagsWithCount(libraryId): Array<Tag & { count: number }>`（LEFT JOIN 计数）
   - `getTaggedPaths(libraryId, tagIds): string[]`——**AND 语义**：`WHERE tag_id IN (...) GROUP BY library_id, image_path HAVING COUNT(DISTINCT tag_id) = ?`（参数为 tagIds 长度）
3. **级联扩展（核心改动）**：
   - `updateImagePath`（L518 起）事务内追加第三条：
     ```sql
     UPDATE image_tags SET image_path = ? WHERE library_id = ? AND image_path = ?
     ```
     同步更新事务注释（现为「favorites + history 两条 UPDATE」，改为三条）。
   - `updateFolderPath`（L536 起）对 `image_tags` 做与 `favorites` 相同的前缀匹配更新（`image_path = ? OR image_path LIKE 'old/%'`），并入现有事务。
4. 单元测试 `src/main/services/__tests__/tag.test.ts`（复用现有临时主库模式）：
   - CRUD：建/删/改名、重名报错、`ON DELETE CASCADE` 验证（删标签后 image_tags 清空）
   - 打标/去标：多标签批量、幂等（重复打标不报错）、`getTagsWithCount` 计数正确
   - `getTaggedPaths`：单标签、多标签 AND 语义（只含部分标签的图片不返回）
   - **级联回归（关键）**：`updateImagePath` 后标签跟随新路径；`updateFolderPath` 后子路径图片标签跟随；对照现有 `database-cascade.test.ts` 断言风格
5. **提交**：`feat: 标签数据层 — tags/image_tags 表、CRUD 与路径级联扩展`

**验收**：≥12 个用例全绿；现有 `database-cascade.test.ts` 不回归。

---

### Task 2：标签 IPC + preload + 类型【风险：低｜0.5 天】

**目标**：七个标签通道打通主进程链路。

**步骤**：

1. 新建 `src/main/ipc/tag-handlers.ts`（仿 `search-handlers.ts` 结构，含 `IPC_HANDLER_NAMES` 数组 + `unregisterTagHandlers`）：
   - `createTag` / `deleteTag` / `renameTag` / `tagImages` / `untagImages` / `getImageTags` / `getAllTags`（即 `getTagsWithCount`，按库）
   - 统一 `{ success, data?, error? }` 返回风格，重名错误映射为「标签已存在」。
2. `electron/main.ts`：`registerTagHandlers()` 与两处反注册（对照 `registerSearchHandlers` 现有位置）。
3. `electron/preload.ts` 暴露七接口；`src/types/index.ts` 的 `ElectronAPI` 接口同步补声明（项目惯例，勿漏——此前多次漏改接口声明）。
4. `src/types/index.ts`：
   ```typescript
   export interface Tag { id: number; name: string; color: string; count?: number }
   ```
   `SearchCriteria` 增加 `tagIds?: number[]`（渲染层可传，服务层消费）。
5. 手动冒烟：console 调 `createTag`/`tagImages`/`getImageTags` 全链路。
6. **提交**：`feat: 标签 IPC 链路 — 七个通道与类型定义`

**验收**：冒烟通过；`tsc` 零错误。

---

### Task 3：打标 UI — 右键入口与标签对话框【风险：中｜1 天】

**目标**：单张/多张图片打标签，标签可管理。

**步骤**：

1. `FileContextMenu.tsx` 的 `items` 追加 `{ id: 'tag', label: '标签...', icon: TagIcon }`（lucide 的 `Tag`，与现有 `ScanSearch` 引入方式一致）。
2. 新建 `src/stores/tagStore.ts`：`{ tags, loadTags(libraryId), dialogOpen, targetPaths, openDialog(paths), closeDialog }`；`stores/index.ts` 导出。
3. `ImageGrid.tsx` / `MasonryGrid.tsx` 的 `handleMenuAction` 加 `tag` 分支：
   - 目标路径 = 右键图片在多选集中 ? `selectionStore.getSelectedPaths()` : 单张（与现有复制/移动的多选行为一致）。
4. 新建 `src/components/TagDialog.tsx`（双标签页）：
   - **分配标签页**：全量标签列表带勾选框（多选目标为所有图片共有标签时预勾）+ 新建标签输入框（含颜色选择，预设 8 色）+ 保存时 diff 出新增/移除，分别调 `tagImages`/`untagImages`。
   - **管理标签页**：列表（名称/计数/颜色）支持改名、删除（二次确认）、换色。
   - 复用项目对话框样式（对照 `BatchRenameDialog` 的模态写法）。
5. 缩略图角标：`ImageGridItem` 增加可选 `tagCount` prop，>0 时左下角显示小圆点（默认不渲染，零侵入，仿 Phase 2 `badge` 的做法）；数据由加载链路附带（`getImages` 结果不查标签，角标走懒加载：网格内可视图片批量 `getImageTags` 成本高——**决策：角标首版不做**，推迟到有性能方案时，避免 N+1 查询。此处仅记录结论，不实现）。
6. 手动回归：单选/多选打标、去标、新建/改名/删标签、删除标签后图片关联清除、对话框开关状态清理。
7. **提交**：`feat: 打标 UI — 右键入口、TagDialog 分配与管理`

**验收**：上述回归项全过。

---

### Task 4：标签筛选 + 标签云【风险：中｜0.5 天】

**目标**：按标签筛选图片，复用搜索链路。

**步骤**：

1. `image-service.ts` `searchImages`（L263-288 区域）：
   ```typescript
   // 标签路径集（AND 语义）
   let tagPaths: string[] | null = null;
   if (criteria.tagIds?.length) {
     tagPaths = this.masterDB.getTaggedPaths(libraryId, criteria.tagIds);
   }
   // 与收藏路径集合并（两者同时存在取交集）
   let merged = favoritePaths;
   if (tagPaths !== null) {
     merged = merged === null ? tagPaths : merged.filter(p => new Set(tagPaths).has(p));
   }
   ```
   合并后沿用现有 `>5 万降级` 与 `favoritePaths` 分块逻辑（字段名保持 `favoritePaths` 传入 DB 层，注释说明其含义已是「收藏 ∩ 标签」交集）。
2. `searchStore.ts`：`criteria` 支持 `tagIds`；新增 `searchByTags(libraryId, tagIds)` 便捷方法（清空其他条件，只按标签搜）。
3. 新建 `src/components/TagCloudPanel.tsx`：
   - 顶部下拉面板（与 `SearchPanel` 同层级、互斥——打开标签云关闭搜索，反之亦然）。
   - 标签按计数倒序展示，字号/透明度随计数变化（简易标签云）；多选标签 → 实时 `searchByTags`（AND）。
   - 空态：「暂无标签，右键图片添加」。
4. `App.tsx`：工具栏加 `Tag` 图标按钮（搜索按钮旁）；`hasSearched` 的结果渲染区复用现有搜索结果视图（含清空恢复逻辑）。
5. 手动回归：单标签/多标签筛选、与其他搜索条件组合、删除标签后筛选结果更新、面板互斥。
6. **提交**：`feat: 标签筛选 — SearchCriteria.tagIds 交集与标签云面板`

**验收**：5 项回归全过；标签 + 评分组合条件命中正确。

---

### Task 5：库统计数据层 + IPC【风险：低｜0.5 天】

**目标**：四条聚合查询 + 通道打通。

**步骤**：

1. `ThumbnailsDB.getLibraryStats()`：
   ```typescript
   // 1) 总量：SELECT COUNT(*) total, COALESCE(SUM(file_size),0) totalSize FROM images WHERE is_deleted=0
   // 2) 格式：SELECT format, COUNT(*) count, SUM(file_size) size FROM images WHERE is_deleted=0 GROUP BY format
   // 3) 媒体类型：SELECT media_type, COUNT(*) count ... GROUP BY media_type
   // 4) 时间线：SELECT substr(created_time,1,7) month, COUNT(*) count ... WHERE created_time IS NOT NULL GROUP BY month ORDER BY month
   ```
   返回类型 `LibraryStats`（写入 `types/index.ts`）。时间线数据量控制：前端渲染时截断最近 60 个月（查询不限制，库内月份数天然有限）。
2. `library-handlers.ts` 新增 `getLibraryStats` handler，并把通道名加入该文件 `IPC_HANDLER_NAMES` 数组（漏加会导致窗口关闭时句柄泄漏——此前审查确认过该机制）。
3. `preload.ts` + `types/index.ts` 的 `ElectronAPI` 接口同步。
4. 单元测试 `stats.test.ts`：空库、混合媒体、已删除图片不计入、时间线分组正确。
5. **提交**：`feat: 库统计数据层 — getLibraryStats 聚合查询与 IPC`

**验收**：≥6 个用例全绿。

---

### Task 6：库统计面板 UI【风险：低｜0.5 天】

**目标**：统计可视化面板。

**步骤**：

1. 安装 `recharts`（渲染端依赖，确认版本与 React 19 兼容；打包后验证主进程 externals 无需改动）。
2. 新建 `src/components/StatsPanel.tsx`：
   - 模态面板（对照 `BatchRenameDialog` 模态骨架），标题显示库名。
   - 概览卡片行：总数量 / 总大小（`formatFileSize` 格式化）/ 图片 / 视频 / 音频。
   - `PieChart`：格式分布（占比 <2% 的合并为「其他」）。
   - `BarChart`：月度时间线（最近 60 个月，超出截断并提示）。
   - 配色沿用液态玻璃暗色系（`bg-glass-l1`/`text-text-secondary` 等既有 token）。
3. `App.tsx`：库管理面板（`showLibraryPanel`，L1164 区域）头部加「统计」按钮打开 `StatsPanel`；仅当存在当前库时可用。
4. 手动回归：大库打开面板 <2s（用 `huge-library` 实测）、图表渲染正确、关闭面板状态清理。
5. **提交**：`feat: 库统计面板 — recharts 可视化（格式分布/时间线/概览）`

**验收**：`huge-library` 实测查询+渲染 <2s。

---

### Task 7：EXIF 查看器【风险：低｜1 天】

**目标**：信息面板展示拍摄参数与 GPS。

**步骤**：

1. 安装 `exifreader`。新建 `src/main/utils/exif.ts`：
   ```typescript
   export interface ExifInfo {
     dateTimeOriginal?: string   // EXIF.DateTimeOriginal
     make?: string; model?: string; lensModel?: string
     exposureTime?: string; fNumber?: number; iso?: number; focalLength?: number
     gps?: { latitude: number; longitude: number }
   }
   export async function readExif(absPath: string): Promise<ExifInfo>
   // 实现：fs.open + read 前 1MB 到 Buffer → ExifReader.parse(buffer)
   // 所有字段缺失容错（?. 链），解析异常返回 {}，不抛给渲染层
   ```
   注意 `exifreader` 的导入方式以实际构建验证为准（双格式包，CJS 可直接 `require`/默认导入，若打包异常按既有经验加 externals）。
2. `library-handlers.ts` 新增 `getImageExif(libraryId, relativePath)`：解析库根路径拼接绝对路径（复用现有 `validatePath` 同款库范围校验思路），调 `readExif`。通道名加入 `IPC_HANDLER_NAMES`。
3. `preload.ts` + `types/index.ts` 的 `ElectronAPI` 接口同步。
4. `ImageViewer.tsx`：现有 `showInfo` 面板（L627 区域）内追加「拍摄信息」区块：
   - `useEffect`：`showInfo && mediaType === 'image'` 时请求 `getImageExif`，按 `imagePath` 缓存于组件内 `useRef`（同一会话翻页回看不重复请求）。
   - 字段键值对列表（无数据时显示「无 EXIF 信息」）；GPS 显示原始坐标 + 「在地图中查看」链接（`https://www.openstreetmap.org/?mlat=..&mlon=..` 系统浏览器打开）。
   - 视频/音频不显示该区块。
5. 手动回归：JPG（含 EXIF）/PNG（无 EXIF）/视频三类文件面板表现；大文件（>50MB）解析不卡顿（1MB 截断生效）；翻页时请求不重复。
6. **提交**：`feat: EXIF 查看器 — exifreader 惰性解析与信息面板扩展`

**验收**：6 项回归全过；单图解析 <500ms。

---

### Task 8：最终验证 + 文档收口【风险：低｜0.5 天】

**步骤**：

1. 全量验证：`npx vitest run`（目标 ≥115 通过）、`npx tsc --noEmit`、`npm run build` 产出安装包。
2. 手动回归清单（8 项）：
   - 多选批量打标/去标、标签管理增删改
   - **重命名/移动/批量重命名后标签不丢失（级联回归，本阶段核心风险项）**
   - 标签云筛选单/多标签、与评分组合
   - 统计面板大库 <2s
   - EXIF 三类文件表现
   - 性能红线：启动 <3s、内存 <500MB、滚动不掉帧
3. `docs/roadmap.md` 回写：#15/#16/#18 标 ✅（附实施说明）；「推荐执行顺序」第四轮标记完成；进度注释行更新（注意表格列数与轮次编号规范，勿重复 Phase 2 的格式错误）。
4. 本计划文档移入 `docs/archive/superpowers/plans/`，front matter 改 `status: archived` 并加归档日期——**复制与删除必须在同一次提交内完成**（沿用已建立的原子归档纪律）。
5. **提交**：`chore: Phase 3 收尾 — 文档归档与 roadmap 回写`

---

## 四、风险评估与应对

| 风险 | 等级 | 应对 |
|---|---|---|
| 级联扩展破坏 Phase 1 文件操作（最高风险） | 高 | Task 1 最先执行、测试先行；级联回归用例同时覆盖单文件与文件夹级；全量回归 `file-service.test.ts`/`database-cascade.test.ts` |
| 多标签路径集过大导致 SQL 膨胀 | 中 | 复用 `>5 万降级 JS Set` 既有机制（Task 4 合并后统一走该通道） |
| recharts 与 React 19 兼容/包体增大 | 低 | Task 6 首步验证版本兼容；统计为低频面板，包体影响可接受 |
| exifreader 解析损坏/特殊格式文件抛错 | 低 | `readExif` 全量 try/catch 返回空对象，1MB 截断限制内存 |
| 缩略图标签角标引发 N+1 查询 | 中 | 首版明确不做（Task 3 已决策），留待虚拟滚动/批量接口方案 |
| 标签重名/改名并发冲突 | 低 | `tags.name UNIQUE` 约束 + handler 友好错误提示 |

## 五、依赖与配置

- 新增依赖：`recharts`（渲染端）、`exifreader`（主进程）。
- `vite.config.ts`：预计无需改动；构建后核验 `dist-electron/main.js` 无 exifreader 打包异常，若出现按既有经验加入 `rollupOptions.external`。
- 新增 IPC 通道 9 个：`createTag`、`deleteTag`、`renameTag`、`tagImages`、`untagImages`、`getImageTags`、`getAllTags`、`getLibraryStats`、`getImageExif`。

## 六、验收标准

1. 单元测试总数 ≥115 且全绿（新增 ≥16：标签 12 + 统计 4 起步）；`tsc` 零错误；安装包构建成功。
2. 级联回归：重命名/移动/批量重命名三种操作后标签引用零丢失。
3. 性能：统计查询 <2s、EXIF 解析 <500ms、标签筛选 <2s；三项红线不破。
4. roadmap 回写完成（表格格式与轮次编号规范），计划文档原子归档。

## 七、分支与提交

- 分支：`phase-3-tags-stats-exif`
- 每 Task 一次提交（8 个），消息前缀见各 Task；可单独回滚。
- 预估总工时：**5 天**（标签 3 + 统计 1 + EXIF 1 + 收口 0.5，含少量缓冲；按顺序执行时高风险的级联改动最先落地，避免后置阻塞）。
