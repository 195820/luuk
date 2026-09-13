// src/main/ipc/file-handlers.ts
import path from 'path';
import { ipcMain, dialog } from 'electron';
import { FileService } from '../services/file-service';
import { getMasterDB } from '../services/database';
import { getSetting } from '../services/settings-service';
import { sendToRenderer } from '../utils/ipc';
import { isPathWithin } from '../utils/path-safe';
import { logger } from '../../utils/logger';

const fileService = new FileService();

/** 导出服务懒加载单例（首次导出时动态 import） */
let exportService: any = null;

/** 获取并校验库记录，不存在返回 null */
function getValidLibrary(libraryId: number) {
  return getMasterDB().getLibrary(libraryId);
}

export function registerFileHandlers(): void {
  ipcMain.handle('renameFile', async (_e, libraryId: number, oldPath: string, newPath: string) => {
    if (!getValidLibrary(libraryId)) return { success: false, error: '库不存在' };
    return fileService.renameFile(libraryId, oldPath, newPath);
  });

  ipcMain.handle('batchRename', async (_e, libraryId: number, renames: Array<{ oldPath: string; newPath: string }>) => {
    if (!getValidLibrary(libraryId)) {
      return { succeeded: [], failed: renames.map(r => ({ ...r, error: '库不存在' })) };
    }
    return fileService.batchRename(libraryId, renames);
  });

  ipcMain.handle('moveFiles', async (_e, libraryId: number, paths: string[], targetDir: string) => {
    if (!getValidLibrary(libraryId)) {
      return { succeeded: [], failed: paths.map(p => ({ path: p, error: '库不存在' })) };
    }
    return fileService.moveFiles(libraryId, paths, targetDir);
  });

  ipcMain.handle('copyFiles', async (_e, libraryId: number, paths: string[], targetDir: string) => {
    if (!getValidLibrary(libraryId)) {
      return { succeeded: [], failed: paths.map(p => ({ path: p, error: '库不存在' })) };
    }
    return fileService.copyFiles(libraryId, paths, targetDir);
  });

  ipcMain.handle('deleteFiles', async (_e, libraryId: number, paths: string[]) => {
    if (!getValidLibrary(libraryId)) {
      return { succeeded: [], failed: paths.map(p => ({ path: p, error: '库不存在' })) };
    }

    // 根据设置决定是否弹出确认对话框
    const needConfirm = getSetting('fileOps.confirmBeforeDelete');
    if (needConfirm) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['移入回收站', '取消'],
        defaultId: 1,
        title: '确认删除',
        message: `确定将 ${paths.length} 个文件移入回收站？`,
      });
      if (response === 1) return { succeeded: [], failed: [] };
    }

    return fileService.deleteFiles(libraryId, paths);
  });

  ipcMain.handle('setWallpaper', async (_e, libraryId: number, relativePath: string) => {
    if (!getValidLibrary(libraryId)) return { success: false, error: '库不存在' };
    return fileService.setWallpaper(libraryId, relativePath);
  });

  ipcMain.handle('showInExplorer', async (_e, libraryId: number, relativePath: string) => {
    if (!getValidLibrary(libraryId)) return { success: false, error: '库不存在' };
    return fileService.showInExplorer(libraryId, relativePath);
  });

  // 弹出文件夹选择对话框，限制目标必须在库目录内
  ipcMain.handle('selectDestinationFolder', async (_e, libraryId: number) => {
    const library = getValidLibrary(libraryId);
    if (!library) return null;

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择目标文件夹（必须在库目录内）',
      defaultPath: library.rootPath,
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const absPath = path.resolve(result.filePaths[0]);
    const rootPath = path.resolve(library.rootPath);
    if (!isPathWithin(rootPath, absPath)) {
      return { error: '目标目录必须在库目录内' };
    }
    // 返回绝对路径：ExportDialog 直接将其用作导出输出目录
    return absPath;
  });

  ipcMain.handle('getDeletedFiles', async (_e, libraryId?: number, limit?: number) => {
    return getMasterDB().getDeletedFiles(limit, libraryId);
  });

  // ==================== 导出功能 ====================

  // 导出单张图片
  ipcMain.handle('exportSingleImage', async (_event, libraryId: number, relativePath: string, options: any, taskId: string) => {
    try {
      if (!exportService) {
        const { ExportService } = await import('../services/export-service');
        exportService = new ExportService();
      }
      const library = getValidLibrary(libraryId);
      if (!library) {
        return { success: false, error: '库不存在' };
      }
      const absPath = path.join(library.rootPath, relativePath);
      // 安全检查：确保路径在库目录内
      const resolved = path.resolve(absPath);
      const libRoot = path.resolve(library.rootPath);
      if (!isPathWithin(libRoot, resolved)) {
        return { success: false, error: 'Access denied' };
      }
      const outputPath = await exportService.exportSingle(absPath, options, taskId);
      return { success: true, outputPath };
    } catch (err) {
      logger.error('FileHandlers', 'exportSingleImage 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // 批量导出为 ZIP
  ipcMain.handle('exportBatchImages', async (_event, libraryId: number, relativePaths: string[], options: any, taskId: string) => {
    try {
      if (!exportService) {
        const { ExportService } = await import('../services/export-service');
        exportService = new ExportService();
      }
      const library = getValidLibrary(libraryId);
      if (!library) {
        return { success: false, error: '库不存在' };
      }
      const libRoot = path.resolve(library.rootPath);
      // 携带库内相对路径作为 ZIP 条目名，避免不同目录下同名文件冲突
      const files = relativePaths.map(rp => {
        const absPath = path.join(library.rootPath, rp);
        const resolved = path.resolve(absPath);
        if (!isPathWithin(libRoot, resolved)) {
          throw new Error('Access denied');
        }
        return { absPath: resolved, name: rp };
      });
      let lastEmit = 0;
      await exportService.exportBatch(files, options, taskId, (done: number, total: number) => {
        const now = Date.now();
        // 100ms 节流，避免高频 IPC 事件导致渲染进程掉帧
        if (now - lastEmit >= 100 || done === total) {
          lastEmit = now;
          sendToRenderer('export-progress', { taskId, done, total, finished: done === total });
        }
      });
      sendToRenderer('export-progress', { taskId, done: relativePaths.length, total: relativePaths.length, finished: true });
      return { success: true };
    } catch (err) {
      logger.error('FileHandlers', 'exportBatchImages 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // 取消导出任务
  ipcMain.handle('cancelExport', async (_event, taskId: string) => {
    try {
      if (!exportService) {
        return { success: true }; // 服务未初始化，无需取消
      }
      exportService.cancel(taskId);
      return { success: true };
    } catch (err) {
      logger.error('FileHandlers', 'cancelExport 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });
}

/**
 * 已注册的 IPC 处理器名称（用于批量注销）
 */
const FILE_IPC_HANDLER_NAMES = [
  'renameFile', 'batchRename', 'moveFiles', 'copyFiles', 'deleteFiles',
  'setWallpaper', 'showInExplorer', 'selectDestinationFolder', 'getDeletedFiles',
  'exportSingleImage', 'exportBatchImages', 'cancelExport',
] as const;

/**
 * 清理文件操作相关的 IPC 处理器
 */
export function unregisterFileHandlers(): void {
  FILE_IPC_HANDLER_NAMES.forEach(name => ipcMain.removeHandler(name));
}
