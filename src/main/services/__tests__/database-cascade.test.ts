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
    // getHistory() 和 getFavoriteFolders() JOIN libraries 且过滤 status='online'
    masterDB.updateLibraryStatus(1, 'online');

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
    expect(masterDB.getFavorites()[0].rating).toBe(5);
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
