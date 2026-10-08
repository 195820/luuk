// src/main/ipc/file-handlers.ts
import path from 'path';
import { ipcMain, dialog } from 'electron';
import { FileService } from '../services/file-service';
import { getMasterDB } from '../services/database';
import { getSetting } from '../services/settings-service';
import { getJobRunner } from '../services/job-runner';
import { sendToRenderer } from '../utils/ipc';
import { isPathWithin } from '../utils/path-safe';
import { logger } from '../../utils/logger';

const fileService = new FileService();

/** 导出服务懒加载单例（首次导出时动态 import） */
let exportService: any = null;

// ==================== T25：批量导出复合作业（收编 JobRunner） ====================

/** jobId → 复合作业参数（内存表；作业台账持久化但重启不承诺续跑导出，进度回调需内存引用） */
const exportJobParams: Map<string, {
  files: Array<{ absPath: string; name: string }>;
  options: any;
  taskId: string;
}> = new Map();

/** taskId → jobId 反查表（供 cancelExport 桥接 JobRunner 取消） */
const exportBatchJobs: Map<string, string> = new Map();

/** 注册 export.batch 复合处理器（幂等覆盖；单复合项，实际批次在 onProgress 观察点桥接取消） */
function registerExportHandler(runner: ReturnType<typeof getJobRunner>): void {
  runner.registerHandler('export.batch', async (item) => {
    const jobId = item.jobId;
    const params = exportJobParams.get(jobId);
    if (!params) return; // 参数丢失（如主进程重启后误续跑）：静默跳过复合项，作业自然收口
    let lastEmit = 0;
    try {
      await exportService.exportBatch(params.files, params.options, params.taskId, (done: number, total: number) => {
        const now = Date.now();
        // ① 取消观察点：handler 拿不到 abort signal，靠台账状态感知（cancel 会同步写库 'cancelled'）
        const job = getMasterDB().getJob(jobId);
        if (job?.state === 'cancelled') {
          exportService.cancel(params.taskId);
          throw new Error('导出已取消');
        }
        // ② 台账映射：单复合项无法逐项落库，用四参 updateJobState 覆写 done 计数
        getMasterDB().updateJobState(jobId, 'running', done, 0);
        // ③ UI 兼容事件：100ms 节流，保持旧 'export-progress' 载荷不变（ExportDialog 零改动）
        if (now - lastEmit >= 100 || done === total) {
          lastEmit = now;
          sendToRenderer('export-progress', { taskId: params.taskId, done, total, finished: done === total });
        }
      });
      // 成功收口：台账 full done；补发 finished 事件（与旧实现一致）
      getMasterDB().updateJobState(jobId, 'running', params.files.length, 0);
      sendToRenderer('export-progress', { taskId: params.taskId, done: params.files.length, total: params.files.length, finished: true });
    } finally {
      // 收口清理内存参数表，避免 jobId/taskId 映射泄漏（取消后旧 taskId 重试会建新作业新映射）
      exportJobParams.delete(jobId);
      if (exportBatchJobs.get(params.taskId) === jobId) exportBatchJobs.delete(params.taskId);
    }
  });
}

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

  // 批量导出为 ZIP（T25：同步校验后入队 JobRunner 立即返回，长任务不阻塞 IPC；进度由复合处理器事件驱动）
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
      if (files.length === 0) {
        return { success: false, error: '没有可导出的文件' };
      }

      const runner = getJobRunner();
      registerExportHandler(runner);
      // 单复合项：导出进度是批次级（done/total），不拆为图片级 job_items
      const jobId = await runner.enqueue('export.batch', { libraryId, taskId }, {
        items: [{ libraryId, imageId: null }],
      });
      exportJobParams.set(jobId, { files, options, taskId });
      exportBatchJobs.set(taskId, jobId);
      await runner.start(jobId);
      return { success: true, data: { jobId } };
    } catch (err) {
      logger.error('FileHandlers', 'exportBatchImages 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // 取消导出任务（T25：双路桥接——交互式 exportService.cancel + 作业层 runner.cancel；单张导出不入队，前者即足够）
  ipcMain.handle('cancelExport', async (_event, taskId: string) => {
    try {
      const jobId = exportBatchJobs.get(taskId);
      if (jobId) {
        try {
          await getJobRunner().cancel(jobId);
        } catch (err) {
          logger.warn('FileHandlers', `cancelExport 作业层取消失败（回退直接 cancel）: ${taskId}`, err);
        }
      }
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
