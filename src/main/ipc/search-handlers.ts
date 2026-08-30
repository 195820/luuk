import { ipcMain } from 'electron';
import { getImageService } from '../services/image-service';
import type { SearchCriteria, SearchOptions } from '../../types';
import { logger } from '../../utils/logger';

const SEARCH_HANDLER_NAMES = [
  'searchImages',
  // Task 6/7 补充：findSimilarImages / startPhashBackfill / stopPhashBackfill
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
}

/**
 * 清理搜索 IPC 处理器
 */
export function unregisterSearchHandlers(): void {
  SEARCH_HANDLER_NAMES.forEach(name => ipcMain.removeHandler(name));
}
