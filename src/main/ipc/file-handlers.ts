// src/main/ipc/file-handlers.ts
import path from 'path';
import { ipcMain, dialog } from 'electron';
import { FileService } from '../services/file-service';
import { getMasterDB } from '../services/database';
import { getSetting } from '../services/settings-service';

const fileService = new FileService();

/** 校验 libraryId 对应的库是否存在 */
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
    if (!validateLibraryAccess(libraryId)) {
      return { succeeded: [], failed: renames.map(r => ({ ...r, error: '库不存在' })) };
    }
    return fileService.batchRename(libraryId, renames);
  });

  ipcMain.handle('moveFiles', async (_e, libraryId: number, paths: string[], targetDir: string) => {
    if (!validateLibraryAccess(libraryId)) {
      return { succeeded: [], failed: paths.map(p => ({ path: p, error: '库不存在' })) };
    }
    return fileService.moveFiles(libraryId, paths, targetDir);
  });

  ipcMain.handle('copyFiles', async (_e, libraryId: number, paths: string[], targetDir: string) => {
    if (!validateLibraryAccess(libraryId)) {
      return { succeeded: [], failed: paths.map(p => ({ path: p, error: '库不存在' })) };
    }
    return fileService.copyFiles(libraryId, paths, targetDir);
  });

  ipcMain.handle('deleteFiles', async (_e, libraryId: number, paths: string[]) => {
    if (!validateLibraryAccess(libraryId)) {
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
    if (!validateLibraryAccess(libraryId)) return { success: false, error: '库不存在' };
    return fileService.setWallpaper(libraryId, relativePath);
  });

  ipcMain.handle('showInExplorer', async (_e, libraryId: number, relativePath: string) => {
    if (!validateLibraryAccess(libraryId)) return { success: false, error: '库不存在' };
    return fileService.showInExplorer(libraryId, relativePath);
  });

  // 弹出文件夹选择对话框，限制目标必须在库目录内
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

    const absPath = path.resolve(result.filePaths[0]);
    const rootPath = path.resolve(library.rootPath);
    if (!absPath.startsWith(rootPath + path.sep) && absPath !== rootPath) {
      return { error: '目标目录必须在库目录内' };
    }
    const relativePath = path.relative(rootPath, absPath).replace(/\\/g, '/');
    return relativePath;
  });

  ipcMain.handle('getDeletedFiles', async (_e, limit?: number) => {
    return getMasterDB().getDeletedFiles(limit);
  });
}
