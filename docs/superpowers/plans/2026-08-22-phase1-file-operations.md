# 文件操作系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现安全的物理文件操作（复制/移动/重命名/删除/壁纸/在资源管理器中显示），配套路径引用级联更新机制，保证多库场景下收藏/历史/文件夹树的数据一致性。

**Spec:** `docs/roadmap.md` #3 + #2 + #7 + #8

**Architecture:**
- **FileService** 无状态单例，按 `libraryId` 动态解析库根路径和对应 `ThumbnailsDB`（复用 `ImageService.connectLibrary` 模式）
- **补偿式一致性**（非跨库事务 — master.db 和 thumbs.db 是两个独立 SQLite 文件，无法放入同一事务）：
  - 操作顺序：物理文件操作 → thumbs.db 更新 → master.db 更新
  - 每步失败有逆向补偿：物理操作失败 → 直接返回；thumbs.db 失败 → 回滚物理操作；master.db 失败 → 回滚 thumbs.db + 物理操作
  - 每种失败分支的最终状态在代码注释中明确记录
- **路径安全**：所有 handler 校验相对路径解析后的绝对路径在已注册库范围内（复用 `image-service.ts` 的安全校验模式）
- **回收站**：使用 `trash` 库移入系统回收站；`deleted_files` 表记录已删文件的原始路径（仅供视图展示，**不支持恢复** — trash 库不提供恢复 API）
- **多选机制**：ImageGrid 新增 Shift/Ctrl 勾选，供批量操作使用

**关键约束 — 路径存储格式：**
- `favorites.image_path`、`favorite_folders.folder_path`、`history.image_path`、`thumbs.db.images.relative_path` 均存储**相对于库根目录的路径**（如 `photos/2024/img.jpg`）
- 路径分隔符统一使用 `/`（跨平台兼容）

**Tech Stack:**
- trash ^8+ (ESM) — 跨平台回收站
- wallpaper ^7+ (ESM) — 跨平台壁纸设置，命名导出 `setWallpaper()`
- electron-store ^11+ — 配置持久化
- better-sqlite3 ^12 — 已有

## Global Constraints

- 启动时间 <3s，内存 <500MB，滚动帧率 ≥30 FPS
- 所有路径参数使用相对路径（相对于库根目录，`/` 分隔）
- UI 组件使用 shadcn/ui + Tailwind v4，禁止新建 .css 文件
- IPC 通道命名沿用现有 camelCase 风格（如 `renameFile`、`deleteFiles`，不加前缀）
- 所有 bash 命令前需 `conda activate imageviewer`
- Windows 环境：路径用 `\` 分隔，PowerShell 语法

## File Structure

```
新增：
├── src/main/services/file-service.ts          # 文件操作统一接口（无状态，按 libraryId 动态解析）
├── src/main/services/settings-service.ts      # 配置持久化（electron-store）
├── src/main/ipc/file-handlers.ts              # 文件操作 IPC handlers
├── src/components/file-ops/
│   ├── BatchRenameDialog.tsx                  # 批量重命名对话框
│   ├── RecycleBinView.tsx                     # 回收站视图（只读，不支持恢复）
│   ├── FileContextMenu.tsx                    # 文件右键菜单
│   └── RenamePatternInput.tsx                 # 重命名模式输入（子组件）
└── scripts/
    └── generate-test-data.js                  # 测试数据生成脚本

修改：
├── src/main/services/database.ts              # +级联更新方法、+deleted_files 表、+updateRelativePath
├── src/main/ipc/library-handlers.ts           # 注册 file-handlers
├── electron/preload.ts                        # +文件操作 API 暴露
├── electron/main.ts                           # +SettingsService 初始化
├── src/types/index.ts                         # +文件操作类型 + ElectronAPI 扩展
├── src/stores/imageStore.ts                   # +多选状态 + 文件操作方法
├── src/components/ImageViewer.tsx             # +右键菜单 + 壁纸/复制/资源管理器
├── src/components/ImageGrid.tsx               # +多选勾选 + 右键菜单
├── src/App.tsx                                # +回收站视图路由
└── vite.config.ts                             # +ESM-only 依赖加入主进程 externals
```

---

## Task 1: 依赖安装与测试数据脚本

**Files:**
- Create: `scripts/generate-test-data.js`
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
conda activate imageviewer
npm install trash wallpaper electron-store
```

- [ ] **Step 2: 验证依赖可导入**

trash/wallpaper/electron-store 均为 ESM-only，用动态 import 验证：

```bash
node --input-type=module -e "await import('trash'); await import('wallpaper'); console.log('OK')"
```

注意：electron-store 在 Electron 主进程中可用，Node.js CLI 中可能报错，只要 trash 和 wallpaper 通过即可。

- [ ] **Step 3: 创建测试数据生成脚本**

```javascript
// scripts/generate-test-data.js
const fs = require('fs');
const path = require('path');

async function main() {
  const targetDir = process.argv[2];
  const count = parseInt(process.argv[3]) || 100;
  if (!targetDir) {
    console.error('用法: node scripts/generate-test-data.js <目标路径> [数量]');
    process.exit(1);
  }

  const sharp = require('sharp');
  fs.mkdirSync(targetDir, { recursive: true });
  const folders = ['portrait', 'outdoor', 'studio'];
  folders.forEach(f => fs.mkdirSync(path.join(targetDir, f), { recursive: true }));

  for (let i = 0; i < count; i++) {
    const folder = folders[i % folders.length];
    const filePath = path.join(targetDir, folder, `IMG_${String(i + 1).padStart(4, '0')}.jpg`);
    if (!fs.existsSync(filePath)) {
      await sharp({
        create: {
          width: 1920, height: 1280, channels: 3,
          background: { r: Math.floor(Math.random() * 256), g: Math.floor(Math.random() * 256), b: Math.floor(Math.random() * 256) }
        }
      }).jpeg({ quality: 85 }).toFile(filePath);
    }
  }
  console.log(`已生成 ${count} 张测试图片到 ${targetDir}`);
}
main().catch(console.error);
```

- [ ] **Step 4: 测试脚本**

```powershell
node scripts/generate-test-data.js "$env:TEMP\test-library" 10
Get-ChildItem "$env:TEMP\test-library\portrait"
```

预期：生成 10 张 JPG 分布在 3 个子文件夹

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/generate-test-data.js
git commit -m "chore: 安装文件操作依赖并创建测试数据生成脚本"
```

---

## Task 2: 数据库级联更新 + deleted_files 表

**Files:**
- Modify: `src/main/services/database.ts`
- Test: `src/main/services/__tests__/database-cascade.test.ts`

**Interfaces:**
- Produces: `MasterDB.updateImagePath(libraryId, oldPath, newPath)` — 更新 favorites + history
- Produces: `MasterDB.updateFolderPath(libraryId, oldPath, newPath)` — 前缀匹配更新 favorite_folders + favorites + history
- Produces: `MasterDB.addDeletedFile/getDeletedFiles/removeDeletedFile` — deleted_files 表 CRUD
- Produces: `ThumbnailsDB.updateRelativePath(oldPath, newPath)` — 更新 images.relative_path

**设计要点：**
- `updateImagePath` 同步更新 favorites + history 中的相对路径
- `addDeletedFile` 在 `trash()` 成功后调用，不会留下假记录
- `deleted_files` 表仅记录已删除文件信息（供 RecycleBinView 只读展示）

- [ ] **Step 1: 编写测试**

创建 `src/main/services/__tests__/database-cascade.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock electron（database.ts 顶部 import { app } from 'electron'）
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}));

import { MasterDB, ThumbnailsDB } from '../database';

describe('路径级联更新', () => {
  let masterDB: MasterDB;
  let thumbsDB: ThumbnailsDB;
  let tempDir: string;
  let libDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivdb-'));
    libDir = path.join(tempDir, 'library');
    fs.mkdirSync(libDir, { recursive: true });

    masterDB = new MasterDB();
    masterDB.initialize(tempDir);
    masterDB.addLibrary('测试库', libDir);

    thumbsDB = new ThumbnailsDB();
    thumbsDB.initialize(libDir);
  });

  afterEach(() => {
    masterDB.close();
    thumbsDB.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('updateImagePath 同步更新 favorites 和 history', () => {
    masterDB.addFavorite(1, 'photos/IMG_001.jpg', ['标签'], 5);
    masterDB.addHistory(1, 'photos/IMG_001.jpg');

    masterDB.updateImagePath(1, 'photos/IMG_001.jpg', 'photos/IMG_renamed.jpg');

    expect(masterDB.getFavorites()[0].image_path).toBe('photos/IMG_renamed.jpg');
    expect(masterDB.getFavorites()[0].rating).toBe(5); // 保留原属性
    expect(masterDB.getHistory()[0].image_path).toBe('photos/IMG_renamed.jpg');
  });

  it('updateFolderPath 前缀匹配更新所有子路径', () => {
    masterDB.addFavorite(1, '2024/day1/001.jpg', [], 0);
    masterDB.addFavorite(1, '2024/day1/002.jpg', [], 0);
    masterDB.addFavorite(1, '2024/day2/001.jpg', [], 0);
    masterDB.addFavoriteFolder(1, '2024/day1');

    masterDB.updateFolderPath(1, '2024/day1', '2024/renamed');

    const paths = masterDB.getFavorites().map(f => f.image_path).sort();
    expect(paths).toEqual(['2024/day2/001.jpg', '2024/renamed/001.jpg', '2024/renamed/002.jpg']);
    expect(masterDB.getFavoriteFolders()[0].folder_path).toBe('2024/renamed');
  });

  it('ThumbnailsDB.updateRelativePath 更新图片路径', () => {
    thumbsDB.addImages([{
      relative_path: 'photos/IMG_001.jpg',
      file_hash: 'abc123',
      width: 1920, height: 1080, file_size: 1024, format: 'jpg',
      modified_time: new Date().toISOString(),
      media_type: 'image', duration: null, codec: null,
    }]);

    thumbsDB.updateRelativePath('photos/IMG_001.jpg', 'photos/IMG_new.jpg');

    const images = thumbsDB.getImages({ limit: 100, offset: 0 });
    expect(images[0].relative_path).toBe('photos/IMG_new.jpg');
  });

  it('deleted_files 表记录与查询', () => {
    masterDB.addDeletedFile(1, 'photos/deleted.jpg', 2048);
    const files = masterDB.getDeletedFiles();
    expect(files).toHaveLength(1);
    expect(files[0].original_path).toBe('photos/deleted.jpg');
  });

  it('路径不存在时幂等（不抛错）', () => {
    expect(() => masterDB.updateImagePath(1, 'nonexistent.jpg', 'new.jpg')).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
conda activate imageviewer
npx vitest run src/main/services/__tests__/database-cascade.test.ts
```

- [ ] **Step 3: 实现 MasterDB 级联更新方法**

在 `database.ts` 的 `MasterDB.clearHistory()` 之后添加：

```typescript
// ==================== 路径级联更新 ====================

updateImagePath(libraryId: number, oldPath: string, newPath: string): void {
  if (!this.db) return;
  const normalizedOld = oldPath.replace(/\\/g, '/');
  const normalizedNew = newPath.replace(/\\/g, '/');

  const tx = this.db.transaction(() => {
    this.db!.prepare(
      'UPDATE favorites SET image_path = ? WHERE library_id = ? AND image_path = ?'
    ).run(normalizedNew, libraryId, normalizedOld);

    this.db!.prepare(
      'UPDATE history SET image_path = ? WHERE library_id = ? AND image_path = ?'
    ).run(normalizedNew, libraryId, normalizedOld);
  });
  tx();
}

updateFolderPath(libraryId: number, oldFolderPath: string, newFolderPath: string): void {
  if (!this.db) return;
  const normalizedOld = oldFolderPath.replace(/\\/g, '/');
  const normalizedNew = newFolderPath.replace(/\\/g, '/');
  const likePattern = normalizedOld + '/%';

  const tx = this.db.transaction(() => {
    // favorite_folders 前缀匹配
    const folders = this.db!.prepare(
      'SELECT id, folder_path FROM favorite_folders WHERE library_id = ? AND (folder_path = ? OR folder_path LIKE ?)'
    ).all(libraryId, normalizedOld, likePattern) as Array<{ id: number; folder_path: string }>;

    const updateFolder = this.db!.prepare('UPDATE favorite_folders SET folder_path = ? WHERE id = ?');
    for (const row of folders) {
      const fp = row.folder_path.replace(/\\/g, '/');
      const newPath = fp === normalizedOld ? normalizedNew : normalizedNew + fp.slice(normalizedOld.length);
      updateFolder.run(newPath, row.id);
    }

    // favorites/history 前缀匹配（两表的路径列均为 image_path）
    for (const table of ['favorites', 'history']) {
      this.db!.prepare(
        `UPDATE ${table} SET image_path = ? || SUBSTR(image_path, LENGTH(?) + 1)
         WHERE library_id = ? AND (image_path = ? OR image_path LIKE ?)`
      ).run(normalizedNew, normalizedOld, libraryId, normalizedOld, likePattern);
    }
  });
  tx();
}

// ==================== 已删除文件记录 ====================

addDeletedFile(libraryId: number, originalPath: string, fileSize: number): void {
  if (!this.db) return;
  this.db.prepare(
    'INSERT INTO deleted_files (library_id, original_path, file_size) VALUES (?, ?, ?)'
  ).run(libraryId, originalPath.replace(/\\/g, '/'), fileSize);
}

getDeletedFiles(limit: number = 100): Array<{ id: number; library_id: number; original_path: string; deleted_at: string; file_size: number }> {
  if (!this.db) return [];
  return this.db.prepare('SELECT * FROM deleted_files ORDER BY deleted_at DESC LIMIT ?').all(limit) as any[];
}

removeDeletedFile(id: number): void {
  if (!this.db) return;
  this.db.prepare('DELETE FROM deleted_files WHERE id = ?').run(id);
}
```

在 `createTables()` 的 SQL 末尾添加 deleted_files 表：

```sql
CREATE TABLE IF NOT EXISTS deleted_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  original_path TEXT NOT NULL,
  file_size INTEGER,
  deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (library_id) REFERENCES libraries(id)
);
CREATE INDEX IF NOT EXISTS idx_deleted_time ON deleted_files(deleted_at DESC);
```

在 `ThumbnailsDB` 类中（`close()` 之前）添加：

```typescript
updateRelativePath(oldPath: string, newPath: string): void {
  if (!this.db) return;
  this.db.prepare('UPDATE images SET relative_path = ? WHERE relative_path = ?')
    .run(newPath.replace(/\\/g, '/'), oldPath.replace(/\\/g, '/'));
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run src/main/services/__tests__/database-cascade.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts src/main/services/__tests__/database-cascade.test.ts
git commit -m "feat: 实现路径级联更新（favorites/history/favorite_folders）+ deleted_files 表"
```

---

## Task 3: FileService 核心实现

**Files:**
- Create: `src/main/services/file-service.ts`
- Test: `src/main/services/__tests__/file-service.test.ts`

**Interfaces:**
- Consumes: `getMasterDB()`, `getThumbnailsDB(libraryPath)`
- Produces: `FileService.renameFile/moveFiles/copyFiles/deleteFiles/setWallpaper/showInExplorer`

**关键设计：**
- **无状态**：不保存 thumbsDB/libraryRootPath，每次操作按 libraryId 动态解析
- **补偿顺序**：物理操作 → thumbs.db → master.db，每步失败有逆向补偿
- **路径安全**：所有路径校验限制在库根目录内

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}));

// Mock trash 和 wallpaper 避免真实系统操作
vi.mock('trash', () => ({ default: async (p: string) => { await fsp.rm(p, { force: true }); } }));
vi.mock('wallpaper', () => ({ setWallpaper: async () => {} }));

import { FileService } from '../file-service';
import { MasterDB, ThumbnailsDB, getThumbnailsDB, closeThumbnailsDB } from '../database';

describe('FileService', () => {
  let fileService: FileService;
  let masterDB: MasterDB;
  let tempDir: string;
  let libDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivfs-'));
    libDir = path.join(tempDir, 'library');
    fs.mkdirSync(path.join(libDir, 'photos'), { recursive: true });

    masterDB = new MasterDB();
    masterDB.initialize(tempDir);
    masterDB.addLibrary('测试库', libDir);

    // 初始化 thumbs.db
    const thumbsDB = getThumbnailsDB(libDir);

    fileService = new FileService();
  });

  afterEach(() => {
    masterDB.close();
    closeThumbnailsDB(libDir);  // 关闭 getThumbnailsDB 打开的连接，避免 Windows EBUSY
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('renameFile', () => {
    it('重命名文件并同步两个数据库', async () => {
      const oldAbs = path.join(libDir, 'photos', 'test.jpg');
      fs.writeFileSync(oldAbs, 'test');

      masterDB.addFavorite(1, 'photos/test.jpg', ['标签'], 5);
      const thumbsDB = getThumbnailsDB(libDir);
      thumbsDB.addImages([{
        relative_path: 'photos/test.jpg', file_hash: 'def456',
        width: 1920, height: 1080, file_size: 1024, format: 'jpg',
        modified_time: new Date().toISOString(),
        media_type: 'image', duration: null, codec: null,
      }]);

      const result = await fileService.renameFile(1, 'photos/test.jpg', 'photos/renamed.jpg');

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(libDir, 'photos', 'renamed.jpg'))).toBe(true);
      expect(masterDB.getFavorites()[0].image_path).toBe('photos/renamed.jpg');
      expect(thumbsDB.getImages({ limit: 10, offset: 0 })[0].relative_path).toBe('photos/renamed.jpg');
    });

    it('目标已存在时返回失败且不改动原文件', async () => {
      fs.writeFileSync(path.join(libDir, 'a.jpg'), 'a');
      fs.writeFileSync(path.join(libDir, 'b.jpg'), 'b');

      const result = await fileService.renameFile(1, 'a.jpg', 'b.jpg');
      expect(result.success).toBe(false);
      expect(fs.existsSync(path.join(libDir, 'a.jpg'))).toBe(true);
    });

    it('路径越界（../ 逃逸）时拒绝', async () => {
      const result = await fileService.renameFile(1, '../../../etc/passwd', 'hack.jpg');
      expect(result.success).toBe(false);
      expect(result.error).toContain('路径越界');
    });
  });

  describe('deleteFiles', () => {
    it('删除成功后记录到 deleted_files', async () => {
      const absPath = path.join(libDir, 'del.jpg');
      fs.writeFileSync(absPath, 'delete me');
      masterDB.addFavorite(1, 'del.jpg', [], 0);

      const result = await fileService.deleteFiles(1, ['del.jpg']);

      expect(result.succeeded).toHaveLength(1);
      expect(fs.existsSync(absPath)).toBe(false);
      expect(masterDB.getDeletedFiles()).toHaveLength(1);
      // 收藏已清理
      expect(masterDB.getFavorites()).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run src/main/services/__tests__/file-service.test.ts
```

- [ ] **Step 3: 实现 FileService**

```typescript
// src/main/services/file-service.ts
import fsp from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger';
import { getMasterDB, getThumbnailsDB } from './database';
import type { MasterDB, ThumbnailsDB } from './database';

const execAsync = promisify(exec);

// ESM 动态导入（trash 和 wallpaper 是 ESM-only）
let _trash: ((path: string) => Promise<void>) | null = null;
let _setWallpaper: ((path: string) => Promise<void>) | null = null;

async function getTrash() {
  if (!_trash) {
    const mod = await import('trash');
    _trash = mod.default;
  }
  return _trash!;
}

async function getSetWallpaper() {
  if (!_setWallpaper) {
    const mod = await import('wallpaper');
    _setWallpaper = mod.setWallpaper;
  }
  return _setWallpaper!;
}

import type { FileOperationResult, BatchResult, BatchRenameResult } from '../../types';

/**
 * 文件操作统一服务（无状态）
 *
 * 所有方法接收 libraryId + 相对路径，内部动态解析库根路径和 thumbsDB。
 *
 * 补偿顺序（重命名/移动为例）：
 *   1. 物理文件操作
 *   2. thumbs.db 更新 relative_path
 *   3. master.db 更新 favorites/history/favorite_folders
 *
 * 失败补偿：
 *   - 步骤 1 失败 → 直接返回，DB 无变更
 *   - 步骤 2 失败 → 回滚步骤 1（物理还原），返回
 *   - 步骤 3 失败 → 回滚步骤 2（thumbs.db 还原）+ 回滚步骤 1（物理还原），返回
 *
 * 最终状态：任一失败分支下，文件系统 + master.db + thumbs.db 保持一致
 * （极端情况：回滚本身失败时，记录 error 日志并返回错误，由用户介入）
 */
export class FileService {
  /** 按 libraryId 解析库根路径和 thumbsDB */
  private resolveLibrary(libraryId: number): { rootPath: string; masterDB: MasterDB; thumbsDB: ThumbnailsDB } {
    const masterDB = getMasterDB();
    const library = masterDB.getLibrary(libraryId);
    if (!library) throw new Error(`库不存在: ${libraryId}`);
    const thumbsDB = getThumbnailsDB(library.rootPath);
    return { rootPath: library.rootPath, masterDB, thumbsDB };
  }

  /** 相对路径转绝对路径 */
  private toAbsolute(rootPath: string, relativePath: string): string {
    return path.join(rootPath, relativePath.replace(/\//g, path.sep));
  }

  /** 路径安全校验：确保解析后的绝对路径在库根目录内 */
  private validatePath(rootPath: string, relativePath: string): string | null {
    const absPath = path.resolve(this.toAbsolute(rootPath, relativePath));
    const normalizedRoot = path.resolve(rootPath);
    if (!absPath.startsWith(normalizedRoot + path.sep) && absPath !== normalizedRoot) {
      return '路径越界：不允许访问库目录外的路径';
    }
    return null;
  }

  /**
   * 重命名单个文件
   */
  async renameFile(libraryId: number, oldRelativePath: string, newRelativePath: string): Promise<FileOperationResult> {
    const { rootPath, masterDB, thumbsDB } = this.resolveLibrary(libraryId);

    // 路径安全校验
    const pathError = this.validatePath(rootPath, oldRelativePath) || this.validatePath(rootPath, newRelativePath);
    if (pathError) return { success: false, error: pathError };

    const oldAbs = this.toAbsolute(rootPath, oldRelativePath);
    const newAbs = this.toAbsolute(rootPath, newRelativePath);

    // 前置校验
    try { await fsp.access(oldAbs); } catch { return { success: false, error: '源文件不存在' }; }
    try { await fsp.access(newAbs); return { success: false, error: '目标路径已存在' }; } catch { /* 预期 */ }

    // 步骤 1: 物理重命名
    try {
      await fsp.mkdir(path.dirname(newAbs), { recursive: true });
      await fsp.rename(oldAbs, newAbs);
    } catch (e) {
      return { success: false, error: `文件操作失败: ${(e as Error).message}` };
    }

    // 步骤 2: thumbs.db 更新
    try {
      thumbsDB.updateRelativePath(oldRelativePath, newRelativePath);
    } catch (e) {
      // 回滚步骤 1
      logger.error('thumbs.db 更新失败，回滚物理操作', e);
      try { await fsp.rename(newAbs, oldAbs); } catch { logger.error('回滚失败'); }
      return { success: false, error: '数据库更新失败，已回滚' };
    }

    // 步骤 3: master.db 更新
    try {
      masterDB.updateImagePath(libraryId, oldRelativePath, newRelativePath);
    } catch (e) {
      // 回滚步骤 2 + 步骤 1
      logger.error('master.db 更新失败，回滚所有操作', e);
      try { thumbsDB.updateRelativePath(newRelativePath, oldRelativePath); } catch { logger.error('thumbs.db 回滚失败'); }
      try { await fsp.rename(newAbs, oldAbs); } catch { logger.error('物理回滚失败'); }
      return { success: false, error: '数据库更新失败，已回滚' };
    }

    logger.info(`重命名: ${oldRelativePath} -> ${newRelativePath}`);
    return { success: true };
  }

  /**
   * 批量重命名（逐个执行，支持部分成功）
   */
  async batchRename(libraryId: number, renames: Array<{ oldPath: string; newPath: string }>): Promise<BatchRenameResult> {
    const succeeded: Array<{ oldPath: string; newPath: string }> = [];
    const failed: Array<{ oldPath: string; newPath: string; error: string }> = [];

    for (const { oldPath, newPath } of renames) {
      const result = await this.renameFile(libraryId, oldPath, newPath);
      if (result.success) {
        succeeded.push({ oldPath, newPath });
      } else {
        failed.push({ oldPath, newPath, error: result.error || '未知错误' });
      }
    }
    return { succeeded, failed };
  }

  /**
   * 删除文件到系统回收站
   * 成功后清理收藏记录并记录到 deleted_files 表
   */
  async deleteFiles(libraryId: number, relativePaths: string[]): Promise<BatchResult> {
    const { rootPath, masterDB, thumbsDB } = this.resolveLibrary(libraryId);
    const trash = await getTrash();

    const succeeded: Array<{ path: string }> = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const relativePath of relativePaths) {
      const pathError = this.validatePath(rootPath, relativePath);
      if (pathError) { failed.push({ path: relativePath, error: pathError }); continue; }

      const absPath = this.toAbsolute(rootPath, relativePath);
      try {
        await fsp.access(absPath);
      } catch {
        failed.push({ path: relativePath, error: '文件不存在' });
        continue;
      }

      try {
        // 先获取文件大小（trash 之后文件不在原位，stat 会失败）
        let fileSize = 0;
        try {
          const stats = await fsp.stat(absPath);
          fileSize = stats.size;
        } catch { /* stat 失败不阻塞删除 */ }

        // 物理删除到回收站
        await trash(absPath);

        // 记录到 deleted_files（仅在 trash 成功后）
        masterDB.addDeletedFile(libraryId, relativePath, fileSize);

        // 清理 master.db 收藏记录
        masterDB.removeFavorite(libraryId, relativePath);

        // thumbs.db 软删除
        thumbsDB.markAsDeleted(relativePath);

        succeeded.push({ path: relativePath });
        logger.info(`已移入回收站: ${relativePath}`);
      } catch (e) {
        logger.error('删除失败', e);
        failed.push({ path: relativePath, error: (e as Error).message });
      }
    }
    return { succeeded, failed };
  }

  /**
   * 移动文件到目标目录
   */
  async moveFiles(libraryId: number, relativePaths: string[], targetRelativeDir: string): Promise<BatchResult> {
    const { rootPath, masterDB, thumbsDB } = this.resolveLibrary(libraryId);

    const pathError = this.validatePath(rootPath, targetRelativeDir);
    if (pathError) return { succeeded: [], failed: relativePaths.map(p => ({ path: p, error: pathError })) };

    const targetAbs = this.toAbsolute(rootPath, targetRelativeDir);
    try { await fsp.mkdir(targetAbs, { recursive: true }); } catch {
      return { succeeded: [], failed: relativePaths.map(p => ({ path: p, error: '目标目录创建失败' })) };
    }

    const succeeded: Array<{ path: string }> = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const relativePath of relativePaths) {
      const oldAbs = this.toAbsolute(rootPath, relativePath);
      const fileName = path.basename(relativePath);
      // targetRelativeDir 为 '' 表示库根目录，避免出现 './file.jpg' 形式的存储路径
      const newRelativePath = targetRelativeDir ? `${targetRelativeDir}/${fileName}` : fileName;
      const newAbs = this.toAbsolute(rootPath, newRelativePath);

      try {
        try { await fsp.access(newAbs); failed.push({ path: relativePath, error: '目标已存在' }); continue; } catch { /* 预期 */ }

        // 步骤 1: 物理移动
        await fsp.rename(oldAbs, newAbs);

        // 步骤 2: thumbs.db 更新
        try {
          thumbsDB.updateRelativePath(relativePath, newRelativePath);
        } catch (e) {
          logger.error('thumbs.db 更新失败，回滚物理操作', e);
          try { await fsp.rename(newAbs, oldAbs); } catch { logger.error('回滚失败'); }
          failed.push({ path: relativePath, error: '数据库更新失败，已回滚' });
          continue;
        }

        // 步骤 3: master.db 更新
        try {
          masterDB.updateImagePath(libraryId, relativePath, newRelativePath);
        } catch (e) {
          logger.error('master.db 更新失败，回滚所有操作', e);
          try { thumbsDB.updateRelativePath(newRelativePath, relativePath); } catch { logger.error('thumbs.db 回滚失败'); }
          try { await fsp.rename(newAbs, oldAbs); } catch { logger.error('物理回滚失败'); }
          failed.push({ path: relativePath, error: '数据库更新失败，已回滚' });
          continue;
        }

        succeeded.push({ path: relativePath });
      } catch (e) {
        failed.push({ path: relativePath, error: (e as Error).message });
      }
    }
    return { succeeded, failed };
  }

  /**
   * 复制文件到目标目录（不涉及路径级联 — 复制生成新文件，不影响原引用）
   */
  async copyFiles(libraryId: number, relativePaths: string[], targetRelativeDir: string): Promise<BatchResult> {
    const { rootPath } = this.resolveLibrary(libraryId);

    // 路径安全校验（与 moveFiles 一致）
    const pathError = this.validatePath(rootPath, targetRelativeDir);
    if (pathError) return { succeeded: [], failed: relativePaths.map(p => ({ path: p, error: pathError })) };

    const targetAbs = this.toAbsolute(rootPath, targetRelativeDir);
    await fsp.mkdir(targetAbs, { recursive: true });

    const succeeded: Array<{ path: string }> = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const relativePath of relativePaths) {
      const oldAbs = this.toAbsolute(rootPath, relativePath);
      const fileName = path.basename(relativePath);
      const newAbs = path.join(targetAbs, fileName);
      try {
        // 检查目标是否已存在（防止覆盖）
        try { await fsp.access(newAbs); failed.push({ path: relativePath, error: '目标已存在' }); continue; } catch { /* 预期 */ }
        await fsp.copyFile(oldAbs, newAbs);
        succeeded.push({ path: relativePath });
      } catch (e) {
        failed.push({ path: relativePath, error: (e as Error).message });
      }
    }
    return { succeeded, failed };
  }

  /**
   * 设置壁纸
   */
  async setWallpaper(libraryId: number, relativePath: string): Promise<FileOperationResult> {
    const { rootPath } = this.resolveLibrary(libraryId);
    const pathError = this.validatePath(rootPath, relativePath);
    if (pathError) return { success: false, error: pathError };

    try {
      const absPath = this.toAbsolute(rootPath, relativePath);
      await fsp.access(absPath);
      const setWallpaper = await getSetWallpaper();
      await setWallpaper(absPath);
      logger.info(`壁纸已设置: ${relativePath}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /**
   * 在资源管理器中显示文件
   */
  async showInExplorer(libraryId: number, relativePath: string): Promise<FileOperationResult> {
    const { rootPath } = this.resolveLibrary(libraryId);
    const pathError = this.validatePath(rootPath, relativePath);
    if (pathError) return { success: false, error: pathError };

    try {
      const absPath = this.toAbsolute(rootPath, relativePath);
      if (process.platform === 'win32') {
        await execAsync(`explorer.exe /select,"${absPath}"`);
      } else if (process.platform === 'darwin') {
        await execAsync(`open -R "${absPath}"`);
      } else {
        await execAsync(`xdg-open "${path.dirname(absPath)}"`);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run src/main/services/__tests__/file-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/file-service.ts src/main/services/__tests__/file-service.test.ts
git commit -m "feat: 实现 FileService（重命名/移动/复制/删除/壁纸/资源管理器）及补偿式一致性"
```

---

## Task 4: Settings Service

**Files:**
- Create: `src/main/services/settings-service.ts`

**Interfaces:**
- Consumes: electron-store ^11
- Produces: `SettingsService.get/set/getStore` 方法

- [ ] **Step 1: 实现 SettingsService**

```typescript
// src/main/services/settings-service.ts
import Store from 'electron-store';

interface SettingsSchema {
  'fileOps.lastRenamePattern': string;
  'fileOps.confirmBeforeDelete': boolean;
  'theme.mode': 'dark' | 'light' | 'system';
  'theme.accentColor': string;
  'performance.lowEffectsMode': boolean;
}

const DEFAULTS: SettingsSchema = {
  'fileOps.lastRenamePattern': '{name}_{counter}',
  'fileOps.confirmBeforeDelete': true,
  'theme.mode': 'dark',
  'theme.accentColor': '#7c6ef0',
  'performance.lowEffectsMode': false,
};

let instance: Store<SettingsSchema> | null = null;

export function getSettingsStore(): Store<SettingsSchema> {
  if (!instance) {
    instance = new Store<SettingsSchema>({ name: 'settings', defaults: DEFAULTS });
  }
  return instance;
}

export function getSetting<K extends keyof SettingsSchema>(key: K): SettingsSchema[K] {
  return getSettingsStore().get(key);
}

export function setSetting<K extends keyof SettingsSchema>(key: K, value: SettingsSchema[K]): void {
  getSettingsStore().set(key, value);
}
```

- [ ] **Step 2: vite.config.ts 主进程 externals 补充 ESM-only 依赖**

`electron-store`/`trash`/`wallpaper` 均为 ESM-only 包，若被打包进 CJS 主进程产物会导致 `require()` 失败，需加入 `rollupOptions.external`（运行时由 Electron 从 node_modules 加载，Node 22.12+ / Electron 40 支持 ESM 动态导入）：

```typescript
// vite.config.ts 主进程 entry 配置内
rollupOptions: {
  external: ['better-sqlite3', 'sharp', 'chokidar', 'electron-store', 'trash', 'wallpaper'],
},
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/settings-service.ts vite.config.ts
git commit -m "feat: 新增 SettingsService（electron-store 配置持久化）+ ESM 依赖 externals"
```

---

## Task 5: 类型定义扩展

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 扩展类型和 ElectronAPI**

在 `src/types/index.ts` 末尾添加类型定义：

```typescript
// ==================== 文件操作类型 ====================

export interface FileOperationResult {
  success: boolean;
  error?: string;
}

export interface BatchResult {
  succeeded: Array<{ path: string }>;
  failed: Array<{ path: string; error: string }>;
}

export interface BatchRenameResult {
  succeeded: Array<{ oldPath: string; newPath: string }>;
  failed: Array<{ oldPath: string; newPath: string; error: string }>;
}

export interface DeletedFileRecord {
  id: number;
  library_id: number;
  original_path: string;
  deleted_at: string;
  file_size: number;
}
```

在 `ElectronAPI` 接口中添加：

```typescript
  // 文件操作
  renameFile: (libraryId: number, oldPath: string, newPath: string) => Promise<FileOperationResult>
  batchRename: (libraryId: number, renames: Array<{ oldPath: string; newPath: string }>) => Promise<BatchRenameResult>
  moveFiles: (libraryId: number, paths: string[], targetDir: string) => Promise<BatchResult>
  copyFiles: (libraryId: number, paths: string[], targetDir: string) => Promise<BatchResult>
  deleteFiles: (libraryId: number, paths: string[]) => Promise<BatchResult>
  setWallpaper: (libraryId: number, relativePath: string) => Promise<FileOperationResult>
  showInExplorer: (libraryId: number, relativePath: string) => Promise<FileOperationResult>
  selectDestinationFolder: (libraryId: number) => Promise<string | null | { error: string }>
  getDeletedFiles: (limit?: number) => Promise<DeletedFileRecord[]>
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: 扩展文件操作相关类型定义"
```

---

## Task 6: IPC Handlers + Preload 接线

**Files:**
- Create: `src/main/ipc/file-handlers.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/main/ipc/library-handlers.ts`

- [ ] **Step 1: 创建 file-handlers.ts**

```typescript
// src/main/ipc/file-handlers.ts
import path from 'path';
import { ipcMain, dialog } from 'electron';
import { FileService } from '../services/file-service';
import { getMasterDB } from '../services/database';
import { getSetting } from '../services/settings-service';

const fileService = new FileService();

/** 校验路径在已注册库范围内 */
function validateLibraryAccess(libraryId: number): boolean {
  const library = getMasterDB().getLibrary(libraryId);
  return library !== null;
}

export function registerFileHandlers(): void {
  ipcMain.handle('renameFile', async (_e, libraryId: number, oldPath: string, newPath: string) => {
    if (!validateLibraryAccess(libraryId)) return { success: false, error: '库不存在' };
    return fileService.renameFile(libraryId, oldPath, newPath);
  });

  ipcMain.handle('batchRename', async (_e, libraryId: number, renames: Array<{ oldPath: string; newPath: string }>) => {
    if (!validateLibraryAccess(libraryId)) return { succeeded: [], failed: renames.map(r => ({ ...r, error: '库不存在' })) };
    return fileService.batchRename(libraryId, renames);
  });

  ipcMain.handle('moveFiles', async (_e, libraryId: number, paths: string[], targetDir: string) => {
    if (!validateLibraryAccess(libraryId)) return { succeeded: [], failed: paths.map(p => ({ path: p, error: '库不存在' })) };
    return fileService.moveFiles(libraryId, paths, targetDir);
  });

  ipcMain.handle('copyFiles', async (_e, libraryId: number, paths: string[], targetDir: string) => {
    if (!validateLibraryAccess(libraryId)) return { succeeded: [], failed: paths.map(p => ({ path: p, error: '库不存在' })) };
    return fileService.copyFiles(libraryId, paths, targetDir);
  });

  ipcMain.handle('deleteFiles', async (_e, libraryId: number, paths: string[]) => {
    if (!validateLibraryAccess(libraryId)) return { succeeded: [], failed: paths.map(p => ({ path: p, error: '库不存在' })) };

    // 消费 confirmBeforeDelete 设置
    const needConfirm = getSetting('fileOps.confirmBeforeDelete');
    if (needConfirm) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['移入回收站', '取消'],
        defaultId: 1,
        title: '确认删除',
        message: `确定将 ${paths.length} 个文件移入回收站？`,
      });
      if (response === 1) return { succeeded: [], failed: [] }; // 用户取消
    }

    return fileService.deleteFiles(libraryId, paths);
  });

  ipcMain.handle('setWallpaper', async (_e, libraryId: number, relativePath: string) => {
    if (!validateLibraryAccess(libraryId)) return { success: false, error: '库不存在' };
    return fileService.setWallpaper(libraryId, relativePath);
  });

  ipcMain.handle('showInExplorer', async (_e, libraryId: number, relativePath: string) => {
    if (!validateLibraryAccess(libraryId)) return { success: false, error: '库不存在' };
    return fileService.showInExplorer(libraryId, relativePath);
  });

  ipcMain.handle('selectDestinationFolder', async (_e, libraryId: number) => {
    if (!validateLibraryAccess(libraryId)) return null;
    const library = getMasterDB().getLibrary(libraryId);
    if (!library) return null;

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择目标文件夹（必须在库目录内）',
      defaultPath: library.rootPath,
    });
    if (result.canceled || !result.filePaths[0]) return null;

    // 将绝对路径转为库内相对路径
    const absPath = path.resolve(result.filePaths[0]);
    const rootPath = path.resolve(library.rootPath);
    if (!absPath.startsWith(rootPath + path.sep) && absPath !== rootPath) {
      return { error: '目标目录必须在库目录内' };
    }
    const relativePath = path.relative(rootPath, absPath).replace(/\\/g, '/');
    return relativePath;  // 选择库根目录时返回空字符串 ''
  });

  ipcMain.handle('getDeletedFiles', async (_e, limit?: number) => {
    return getMasterDB().getDeletedFiles(limit);
  });
}
```

- [ ] **Step 2: 在 library-handlers.ts 中注册**

在 `registerLibraryHandlers()` 函数末尾（或 `electron/main.ts` 中注册 handlers 的位置）添加：

```typescript
import { registerFileHandlers } from './file-handlers';

// 在已有的 handler 注册代码附近
registerFileHandlers();
```

- [ ] **Step 3: 在 electron/preload.ts 中暴露 API**

在 `fileExists` 行之后添加：

```typescript
  // 文件操作
  renameFile: (libraryId: number, oldPath: string, newPath: string) =>
    ipcRenderer.invoke('renameFile', libraryId, oldPath, newPath),
  batchRename: (libraryId: number, renames: Array<{ oldPath: string; newPath: string }>) =>
    ipcRenderer.invoke('batchRename', libraryId, renames),
  moveFiles: (libraryId: number, paths: string[], targetDir: string) =>
    ipcRenderer.invoke('moveFiles', libraryId, paths, targetDir),
  copyFiles: (libraryId: number, paths: string[], targetDir: string) =>
    ipcRenderer.invoke('copyFiles', libraryId, paths, targetDir),
  deleteFiles: (libraryId: number, paths: string[]) =>
    ipcRenderer.invoke('deleteFiles', libraryId, paths),
  setWallpaper: (libraryId: number, relativePath: string) =>
    ipcRenderer.invoke('setWallpaper', libraryId, relativePath),
  showInExplorer: (libraryId: number, relativePath: string) =>
    ipcRenderer.invoke('showInExplorer', libraryId, relativePath),
  selectDestinationFolder: (libraryId: number) => ipcRenderer.invoke('selectDestinationFolder', libraryId),
  getDeletedFiles: (limit?: number) => ipcRenderer.invoke('getDeletedFiles', limit),
```

- [ ] **Step 4: 验证编译通过**

```bash
conda activate imageviewer
npm run build
```

注意：使用 `npm run build`（非 `build:dir`），确保主进程代码也编译通过。

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/file-handlers.ts src/main/ipc/library-handlers.ts electron/preload.ts
git commit -m "feat: 注册文件操作 IPC handlers 并暴露到前端 API"
```

---

## Task 7: imageStore 多选状态 + 文件操作方法

**Files:**
- Modify: `src/stores/imageStore.ts`

- [ ] **Step 1: 添加多选状态**

在 imageStore 中添加：

```typescript
// 多选状态
selectedPaths: Set<string>;
toggleSelection: (path: string) => void;
selectAll: () => void;
clearSelection: () => void;
getSelectedPaths: () => string[];
```

实现：

```typescript
selectedPaths: new Set<string>(),

toggleSelection: (path: string) => {
  const next = new Set(get().selectedPaths);
  if (next.has(path)) next.delete(path); else next.add(path);
  set({ selectedPaths: next });
},

selectAll: () => {
  const allPaths = get().images.map(img => img.relative_path);
  set({ selectedPaths: new Set(allPaths) });
},

clearSelection: () => set({ selectedPaths: new Set() }),

getSelectedPaths: () => Array.from(get().selectedPaths),
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/imageStore.ts
git commit -m "feat: imageStore 新增多选状态（selectedPaths）"
```

---

## Task 8: ImageGrid 多选勾选 + 右键菜单

**Files:**
- Modify: `src/components/ImageGrid.tsx`
- Create: `src/components/file-ops/FileContextMenu.tsx`

- [ ] **Step 1: 实现 FileContextMenu**

```tsx
// src/components/file-ops/FileContextMenu.tsx
import { useEffect, useRef } from 'react';
import { Rename, FolderInput, Copy, Image as WallpaperIcon, Trash2, FolderSearch, ClipboardCopy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileContextMenuProps {
  x: number;
  y: number;
  relativePath: string;
  libraryId: number;
  onAction: (action: string) => void;
  onClose: () => void;
}

export function FileContextMenu({ x, y, onAction, onClose }: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const items = [
    { id: 'rename', label: '重命名', icon: Rename, shortcut: 'F2' },
    { id: 'move', label: '移动到...', icon: FolderInput },
    { id: 'copy', label: '复制到...', icon: Copy },
    { id: 'showInExplorer', label: '在资源管理器中显示', icon: FolderSearch },
    { id: 'copyPath', label: '复制路径', icon: ClipboardCopy },
    { id: 'setWallpaper', label: '设为壁纸', icon: WallpaperIcon },
    { type: 'separator' as const },
    { id: 'delete', label: '移入回收站', icon: Trash2, shortcut: 'Delete', variant: 'destructive' },
  ];

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[200px] rounded-lg border border-border/40 bg-popover shadow-lg py-1"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 280) }}
    >
      {items.map((item, i) => {
        if ('type' in item && item.type === 'separator') return <div key={i} className="my-1 h-px bg-border/40" />;
        const Icon = (item as any).icon;
        return (
          <button
            key={(item as any).id}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-1.5 text-sm hover:bg-accent/10',
              (item as any).variant === 'destructive' && 'text-destructive hover:bg-destructive/10'
            )}
            onClick={() => { onAction((item as any).id); onClose(); }}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1 text-left">{(item as any).label}</span>
            {(item as any).shortcut && <span className="text-xs text-muted-foreground">{(item as any).shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: ImageGrid 添加多选和右键菜单**

在 `ImageGrid.tsx` 中添加：

```typescript
import { FileContextMenu } from './file-ops/FileContextMenu';
import { useImageStore } from '@/stores/imageStore';

// 在组件中
const { selectedPaths, toggleSelection, clearSelection } = useImageStore();
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

// 网格项 checkbox（Ctrl/Shift 多选）
const handleItemClick = (e: React.MouseEvent, relativePath: string) => {
  if (e.ctrlKey || e.shiftKey) {
    e.preventDefault();
    toggleSelection(relativePath);
  }
};

// 右键菜单
const handleContextMenu = (e: React.MouseEvent, relativePath: string) => {
  e.preventDefault();
  setContextMenu({ x: e.clientX, y: e.clientY, path: relativePath });
};

// 菜单动作处理
const handleMenuAction = async (action: string) => {
  if (!contextMenu) return;
  const path = contextMenu.path;
  const libraryId = currentLibraryId; // 从 store 获取

  switch (action) {
    case 'copyPath':
      await navigator.clipboard.writeText(path);
      break;
    case 'setWallpaper':
      await window.electronAPI.setWallpaper(libraryId, path);
      break;
    case 'showInExplorer':
      await window.electronAPI.showInExplorer(libraryId, path);
      break;
    case 'delete':
      // 确认对话框由 IPC handler 内的 confirmBeforeDelete 设置控制
      await window.electronAPI.deleteFiles(libraryId, [path]);
      await useImageStore.getState().loadImages(); // 刷新列表
      useImageStore.getState().clearSelection();
      break;
    // rename/move/copy 在 Task 9 的对话框中处理
  }
  setContextMenu(null);
};
```

在 JSX 渲染区域添加 `onContextMenu` 和 `onClick` 到网格项，以及：

```tsx
{contextMenu && (
  <FileContextMenu
    x={contextMenu.x} y={contextMenu.y}
    relativePath={contextMenu.path} libraryId={currentLibraryId}
    onAction={handleMenuAction} onClose={() => setContextMenu(null)}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/file-ops/FileContextMenu.tsx src/components/ImageGrid.tsx
git commit -m "feat: ImageGrid 多选勾选 + 文件右键菜单"
```

---

## Task 9: ImageViewer 右键菜单 + 工具栏集成

**Files:**
- Modify: `src/components/ImageViewer.tsx`

- [ ] **Step 1: 在 ImageViewer 中集成 FileContextMenu**

与 Task 8 类似的逻辑 — 在查看器中添加右键菜单和工具栏按钮（壁纸、在资源管理器中显示）。

- [ ] **Step 2: Commit**

```bash
git add src/components/ImageViewer.tsx
git commit -m "feat: ImageViewer 集成右键菜单和工具栏操作按钮"
```

---

## Task 10: 批量重命名对话框

**Files:**
- Create: `src/components/file-ops/BatchRenameDialog.tsx`
- Create: `src/components/file-ops/RenamePatternInput.tsx`

- [ ] **Step 1: 实现 RenamePatternInput**

（代码同前版计划，含 `{name}_{counter}` 等预设模式和实时预览）

- [ ] **Step 2: 实现 BatchRenameDialog**

关键点：
- 从 `imageStore.selectedPaths` 获取选中文件列表
- 支持"模式重命名"和"逐个编辑"两种模式
- 预览面板显示重命名前后对比
- 调用 `window.electronAPI.batchRename`

- [ ] **Step 3: 在 FileContextMenu 的 rename action 中触发**

在 `handleMenuAction` 中 `case 'rename'` 打开 BatchRenameDialog。

- [ ] **Step 4: Commit**

```bash
git add src/components/file-ops/BatchRenameDialog.tsx src/components/file-ops/RenamePatternInput.tsx
git commit -m "feat: 批量重命名对话框（模式/手动两种模式 + 实时预览）"
```

---

## Task 11: 回收站视图 + 侧边栏入口 + 视图路由

**Files:**
- Create: `src/components/file-ops/RecycleBinView.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`（添加入口）
- Modify: `src/App.tsx`（视图路由，根据当前视图切换主内容区）

**设计要点：**
- 只读视图，展示 `deleted_files` 表中的记录
- **不提供恢复功能**（trash 库不支持）
- 侧边栏添加"回收站"入口，点击时切换主内容区为 RecycleBinView
- 删除操作后通过 `useEffect` 监听或 imageStore 事件刷新列表

- [ ] **Step 1: 实现 RecycleBinView**

```tsx
// src/components/file-ops/RecycleBinView.tsx
import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatFileSize } from '@/utils/format';
import type { DeletedFileRecord } from '@/types';

export function RecycleBinView() {
  const [files, setFiles] = useState<DeletedFileRecord[]>([]);

  useEffect(() => {
    window.electronAPI.getDeletedFiles(100).then(setFiles);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-border/40">
        <Trash2 className="h-5 w-5" />
        <h2 className="text-lg font-semibold">回收站</h2>
        <span className="text-sm text-muted-foreground">（{files.length} 项，不支持恢复）</span>
      </div>
      <ScrollArea className="flex-1 p-4">
        {files.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">回收站为空</div>
        ) : (
          <div className="space-y-2">
            {files.map(file => (
              <div key={file.id} className="p-3 rounded-lg border border-border/40">
                <div className="font-mono text-sm truncate">{file.original_path}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(file.deleted_at).toLocaleString()} · {formatFileSize(file.file_size)}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: 在 AppSidebar 中添加入口**

在侧边栏的导航区域添加"回收站"入口项，点击时切换主内容区域为 RecycleBinView。

- [ ] **Step 3: Commit**

```bash
git add src/components/file-ops/RecycleBinView.tsx src/components/layout/AppSidebar.tsx src/App.tsx
git commit -m "feat: 回收站视图（只读）+ 侧边栏入口 + App 视图路由"
```

---

## Task 12: 集成测试与验证

- [ ] **Step 1: 端到端流程测试**

```bash
conda activate imageviewer
npm run dev
```

测试场景：
1. 右键单图 → 重命名 → 验证文件名和收藏引用更新
2. Ctrl 多选 → 批量重命名 → 验证预览和实际效果
3. 右键 → 移入回收站 → 验证文件消失、收藏清理、回收站视图显示
4. 右键 → 移动到... → 验证路径级联
5. 右键 → 复制到... → 验证文件复制（原文件不变）
6. 右键 → 设为壁纸 → 验证系统壁纸更换
7. 右键 → 在资源管理器中显示 → 验证打开且定位到文件
8. 路径安全：尝试 `../` 路径逃逸 → 验证拒绝

- [ ] **Step 2: 性能验证**

在 1000+ 图片库中批量重命名，验证操作响应时间 <500ms/文件，内存 <500MB，帧率 ≥30。

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat: 文件操作系统完成（复制/移动/重命名/删除/壁纸/资源管理器/回收站/多选）"
```

---

## 完成标准

1. ✅ 所有 12 个 Task 合并
2. ✅ 数据库级联测试 + FileService 测试全部通过
3. ✅ 端到端 8 个测试场景无 bug
4. ✅ 收藏/历史/文件夹树的路径引用在文件操作后保持一致
5. ✅ 路径安全校验阻止 `../` 逃逸
6. ✅ `npm run build` 无编译错误
7. ✅ 性能验证通过

## 与 roadmap.md 的对应关系

| roadmap.md # | 本计划 Task | 状态 |
|---|---|---|
| #2 设置壁纸 | Task 3, 6, 9 | ⬜ → 待实现 |
| #3 图片文件操作（复制/移动/重命名/删除/资源管理器） | Task 3, 6, 8, 9, 10 | ⬜ → 待实现 |
| #7 批量重命名 | Task 10 | ⬜ → 待实现 |
| #8 回收站 | Task 2, 3, 11 | ⬜ → 待实现（注：不支持恢复） |
