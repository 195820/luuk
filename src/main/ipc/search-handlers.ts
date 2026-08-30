import { ipcMain } from 'electron';
import { getImageService } from '../services/image-service';
import type { SearchCriteria, SearchOptions } from '../../types';
import { logger } from '../../utils/logger';

const SEARCH_HANDLER_NAMES = [
  'searchImages',
  'startPhashBackfill',
  'stopPhashBackfill',
  'findSimilarImages',
] as const;

/**
 * 注册搜索相关 IPC 处理器
 */
export function registerSearchHandlers(): void {
  const service = getImageService();

  ipcMain.handle('searchImages', async (
    _event,
    libraryId: number,
    criteria: SearchCriteria,
    options: SearchOptions
  ) => {
    try {
      const result = service.searchImages(libraryId, criteria, options);
      return { success: true, ...result };
    } catch (err) {
      logger.error('SearchHandlers', 'searchImages 失败', err);
      return { success: false, error: (err as Error).message, images: [], total: 0 };
    }
  });

  ipcMain.handle('startPhashBackfill', async (_event, libraryId: number) => {
    try {
      const result = await service.startPhashBackfill(libraryId);
      return result;
    } catch (err) {
      logger.error('SearchHandlers', 'startPhashBackfill 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('stopPhashBackfill', async () => {
    try {
      service.stopPhashBackfill();
      return { success: true };
    } catch (err) {
      logger.error('SearchHandlers', 'stopPhashBackfill 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('findSimilarImages', async (
    _event,
    libraryId: number,
    imagePath: string,
    threshold: number,
    limit: number
  ) => {
    try {
      const result = service.findSimilarImages(libraryId, imagePath, threshold, limit);
      return result;
    } catch (err) {
      logger.error('SearchHandlers', 'findSimilarImages 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });
}

/**
 * 清理搜索 IPC 处理器
 */
export function unregisterSearchHandlers(): void {
  SEARCH_HANDLER_NAMES.forEach(name => ipcMain.removeHandler(name));
}
