import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}));

vi.mock('trash', () => ({ default: async (p: string) => { await fsp.rm(p, { force: true }); } }));
vi.mock('wallpaper', () => ({ setWallpaper: async () => {} }));

import { FileService } from '../file-service';
import { MasterDB, getMasterDB, getThumbnailsDB, closeAllDatabases } from '../database';

describe('FileService', () => {
  let fileService: FileService;
  let masterDB: MasterDB;
  let tempDir: string;
  let libDir: string;

  beforeEach(() => {
    // 重置全局单例，确保 FileService 使用测试的 masterDB
    closeAllDatabases();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivfs-'));
    libDir = path.join(tempDir, 'library');
    fs.mkdirSync(path.join(libDir, 'photos'), { recursive: true });

    // 通过全局单例初始化，FileService.resolveLibrary 调用 getMasterDB() 时拿到同一个实例
    masterDB = getMasterDB(tempDir);
    masterDB.addLibrary('测试库', libDir);
    masterDB.updateLibraryStatus(1, 'online');

    getThumbnailsDB(libDir);

    fileService = new FileService();
  });

  afterEach(() => {
    closeAllDatabases();
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
      expect(masterDB.getFavorites()).toHaveLength(0);
    });
  });
});
