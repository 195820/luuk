import { ipcMain } from 'electron';
import { getMasterDB } from '../services/database';
import { logger } from '../../utils/logger';

const TAG_HANDLER_NAMES = [
  'createTag',
  'deleteTag',
  'renameTag',
  'tagImages',
  'untagImages',
  'getImageTags',
  'getAllTags',
] as const;

/**
 * 注册标签相关 IPC 处理器
 */
export function registerTagHandlers(): void {
  ipcMain.handle('createTag', async (
    _event,
    name: string,
    color?: string
  ) => {
    try {
      const db = getMasterDB();
      const tag = db.createTag(name, color);
      return { success: true, data: tag };
    } catch (err) {
      const message = (err as Error).message;
      // UNIQUE 约束冲突转为友好提示
      if (message.includes('UNIQUE')) {
        return { success: false, error: '标签已存在' };
      }
      logger.error('TagHandlers', 'createTag 失败', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('deleteTag', async (_event, id: number) => {
    try {
      const db = getMasterDB();
      db.deleteTag(id);
      return { success: true };
    } catch (err) {
      logger.error('TagHandlers', 'deleteTag 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('renameTag', async (
    _event,
    id: number,
    name: string,
    color?: string
  ) => {
    try {
      const db = getMasterDB();
      db.renameTag(id, name, color);
      return { success: true };
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('UNIQUE')) {
        return { success: false, error: '标签已存在' };
      }
      logger.error('TagHandlers', 'renameTag 失败', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('tagImages', async (
    _event,
    tagIds: number[],
    libraryId: number,
    paths: string[]
  ) => {
    try {
      const db = getMasterDB();
      db.tagImages(tagIds, libraryId, paths);
      return { success: true };
    } catch (err) {
      logger.error('TagHandlers', 'tagImages 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('untagImages', async (
    _event,
    tagIds: number[],
    libraryId: number,
    paths: string[]
  ) => {
    try {
      const db = getMasterDB();
      db.untagImages(tagIds, libraryId, paths);
      return { success: true };
    } catch (err) {
      logger.error('TagHandlers', 'untagImages 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('getImageTags', async (
    _event,
    libraryId: number,
    imagePath: string
  ) => {
    try {
      const db = getMasterDB();
      const tags = db.getImageTags(libraryId, imagePath);
      return { success: true, data: tags };
    } catch (err) {
      logger.error('TagHandlers', 'getImageTags 失败', err);
      return { success: false, error: (err as Error).message, data: [] };
    }
  });

  ipcMain.handle('getAllTags', async (_event, libraryId: number) => {
    try {
      const db = getMasterDB();
      const tags = db.getTagsWithCount(libraryId);
      return { success: true, data: tags };
    } catch (err) {
      logger.error('TagHandlers', 'getAllTags 失败', err);
      return { success: false, error: (err as Error).message, data: [] };
    }
  });
}

/**
 * 清理标签 IPC 处理器
 */
export function unregisterTagHandlers(): void {
  TAG_HANDLER_NAMES.forEach(name => ipcMain.removeHandler(name));
}
