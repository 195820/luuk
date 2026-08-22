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

  async renameFile(libraryId: number, oldRelativePath: string, newRelativePath: string): Promise<FileOperationResult> {
    const { rootPath, masterDB, thumbsDB } = this.resolveLibrary(libraryId);

    const pathError = this.validatePath(rootPath, oldRelativePath) || this.validatePath(rootPath, newRelativePath);
    if (pathError) return { success: false, error: pathError };

    const oldAbs = this.toAbsolute(rootPath, oldRelativePath);
    const newAbs = this.toAbsolute(rootPath, newRelativePath);

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
      logger.error('FileService', 'thumbs.db 更新失败，回滚物理操作', e);
      try { await fsp.rename(newAbs, oldAbs); } catch { logger.error('FileService', '回滚失败'); }
      return { success: false, error: '数据库更新失败，已回滚' };
    }

    // 步骤 3: master.db 更新
    try {
      masterDB.updateImagePath(libraryId, oldRelativePath, newRelativePath);
    } catch (e) {
      logger.error('FileService', 'master.db 更新失败，回滚所有操作', e);
      try { thumbsDB.updateRelativePath(newRelativePath, oldRelativePath); } catch { logger.error('FileService', 'thumbs.db 回滚失败'); }
      try { await fsp.rename(newAbs, oldAbs); } catch { logger.error('FileService', '物理回滚失败'); }
      return { success: false, error: '数据库更新失败，已回滚' };
    }

    logger.info('FileService', `重命名: ${oldRelativePath} -> ${newRelativePath}`);
    return { success: true };
  }

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
        // 先获取文件大小（trash 之后文件不在原位）
        let fileSize = 0;
        try {
          const stats = await fsp.stat(absPath);
          fileSize = stats.size;
        } catch { /* stat 失败不阻塞删除 */ }

        await trash(absPath);

        // trash 成功后，DB 操作失败需记录告警（文件已移入回收站，无法物理回滚）
        try {
          masterDB.addDeletedFile(libraryId, relativePath, fileSize);
        } catch (e) {
          logger.error('FileService', 'deleted_files 记录失败（文件已移入回收站）', e);
        }
        try {
          masterDB.removeFavorite(libraryId, relativePath);
        } catch (e) {
          logger.error('FileService', '收藏清理失败（文件已移入回收站）', e);
        }
        try {
          thumbsDB.markAsDeleted(relativePath);
        } catch (e) {
          logger.error('FileService', 'thumbs.db 软删除失败（文件已移入回收站）', e);
        }

        succeeded.push({ path: relativePath });
        logger.info('FileService', `已移入回收站: ${relativePath}`);
      } catch (e) {
        logger.error('FileService', '删除失败', e);
        failed.push({ path: relativePath, error: (e as Error).message });
      }
    }
    return { succeeded, failed };
  }

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
      const newRelativePath = targetRelativeDir ? `${targetRelativeDir}/${fileName}` : fileName;

      const newPathError = this.validatePath(rootPath, newRelativePath);
      if (newPathError) { failed.push({ path: relativePath, error: newPathError }); continue; }

      const newAbs = this.toAbsolute(rootPath, newRelativePath);

      try {
        try { await fsp.access(newAbs); failed.push({ path: relativePath, error: '目标已存在' }); continue; } catch { /* 预期 */ }

        await fsp.rename(oldAbs, newAbs);

        try {
          thumbsDB.updateRelativePath(relativePath, newRelativePath);
        } catch (e) {
          logger.error('FileService', 'thumbs.db 更新失败，回滚物理操作', e);
          try { await fsp.rename(newAbs, oldAbs); } catch { logger.error('FileService', '回滚失败'); }
          failed.push({ path: relativePath, error: '数据库更新失败，已回滚' });
          continue;
        }

        try {
          masterDB.updateImagePath(libraryId, relativePath, newRelativePath);
        } catch (e) {
          logger.error('FileService', 'master.db 更新失败，回滚所有操作', e);
          try { thumbsDB.updateRelativePath(newRelativePath, relativePath); } catch { logger.error('FileService', 'thumbs.db 回滚失败'); }
          try { await fsp.rename(newAbs, oldAbs); } catch { logger.error('FileService', '物理回滚失败'); }
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

  async copyFiles(libraryId: number, relativePaths: string[], targetRelativeDir: string): Promise<BatchResult> {
    const { rootPath } = this.resolveLibrary(libraryId);

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
        try { await fsp.access(newAbs); failed.push({ path: relativePath, error: '目标已存在' }); continue; } catch { /* 预期 */ }
        await fsp.copyFile(oldAbs, newAbs);
        succeeded.push({ path: relativePath });
      } catch (e) {
        failed.push({ path: relativePath, error: (e as Error).message });
      }
    }
    return { succeeded, failed };
  }

  async setWallpaper(libraryId: number, relativePath: string): Promise<FileOperationResult> {
    const { rootPath } = this.resolveLibrary(libraryId);
    const pathError = this.validatePath(rootPath, relativePath);
    if (pathError) return { success: false, error: pathError };

    try {
      const absPath = this.toAbsolute(rootPath, relativePath);
      await fsp.access(absPath);
      const setWallpaperFn = await getSetWallpaper();
      await setWallpaperFn(absPath);
      logger.info('FileService', `壁纸已设置: ${relativePath}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

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
