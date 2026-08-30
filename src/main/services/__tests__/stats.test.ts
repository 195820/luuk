import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}));

import { ThumbnailsDB } from '../database';

describe('库统计', () => {
  let thumbsDB: ThumbnailsDB;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivstats-'));

    thumbsDB = new ThumbnailsDB();
    thumbsDB.initialize(tempDir);
  });

  afterEach(() => {
    thumbsDB.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('空库返回零值', () => {
    const stats = thumbsDB.getLibraryStats();
    expect(stats.total).toBe(0);
    expect(stats.totalSize).toBe(0);
    expect(stats.formats).toEqual([]);
    expect(stats.mediaTypes).toEqual([]);
    expect(stats.timeline).toEqual([]);
  });

  it('统计总量和总大小', () => {
    thumbsDB.addImages([
      { relative_path: 'a.jpg', file_hash: 'h1', width: 100, height: 100, file_size: 1000, format: 'jpg', modified_time: new Date().toISOString(), media_type: 'image', duration: null, codec: null },
      { relative_path: 'b.png', file_hash: 'h2', width: 200, height: 200, file_size: 2000, format: 'png', modified_time: new Date().toISOString(), media_type: 'image', duration: null, codec: null },
    ]);

    const stats = thumbsDB.getLibraryStats();
    expect(stats.total).toBe(2);
    expect(stats.totalSize).toBe(3000);
  });

  it('格式分布正确', () => {
    thumbsDB.addImages([
      { relative_path: 'a.jpg', file_hash: 'h1', width: 100, height: 100, file_size: 1000, format: 'jpg', modified_time: new Date().toISOString(), media_type: 'image', duration: null, codec: null },
      { relative_path: 'b.jpg', file_hash: 'h2', width: 100, height: 100, file_size: 1500, format: 'jpg', modified_time: new Date().toISOString(), media_type: 'image', duration: null, codec: null },
      { relative_path: 'c.png', file_hash: 'h3', width: 100, height: 100, file_size: 2000, format: 'png', modified_time: new Date().toISOString(), media_type: 'image', duration: null, codec: null },
    ]);

    const stats = thumbsDB.getLibraryStats();
    expect(stats.formats).toHaveLength(2);
    const jpg = stats.formats.find(f => f.format === 'jpg');
    expect(jpg?.count).toBe(2);
    expect(jpg?.size).toBe(2500);
  });

  it('媒体类型分布正确', () => {
    thumbsDB.addImages([
      { relative_path: 'a.jpg', file_hash: 'h1', width: 100, height: 100, file_size: 1000, format: 'jpg', modified_time: new Date().toISOString(), media_type: 'image', duration: null, codec: null },
      { relative_path: 'b.mp4', file_hash: 'h2', width: 1920, height: 1080, file_size: 50000, format: 'mp4', modified_time: new Date().toISOString(), media_type: 'video', duration: 60, codec: 'h264' },
    ]);

    const stats = thumbsDB.getLibraryStats();
    expect(stats.mediaTypes).toHaveLength(2);
    const image = stats.mediaTypes.find(m => m.mediaType === 'image');
    expect(image?.count).toBe(1);
    const video = stats.mediaTypes.find(m => m.mediaType === 'video');
    expect(video?.count).toBe(1);
  });

  it('已删除图片不计入统计', () => {
    thumbsDB.addImages([
      { relative_path: 'a.jpg', file_hash: 'h1', width: 100, height: 100, file_size: 1000, format: 'jpg', modified_time: new Date().toISOString(), media_type: 'image', duration: null, codec: null },
      { relative_path: 'b.jpg', file_hash: 'h2', width: 100, height: 100, file_size: 2000, format: 'jpg', modified_time: new Date().toISOString(), media_type: 'image', duration: null, codec: null },
    ]);
    thumbsDB.markAsDeleted('b.jpg');

    const stats = thumbsDB.getLibraryStats();
    expect(stats.total).toBe(1);
    expect(stats.totalSize).toBe(1000);
  });

  it('月度时间线分组正确', () => {
    thumbsDB.addImages([
      { relative_path: 'a.jpg', file_hash: 'h1', width: 100, height: 100, file_size: 1000, format: 'jpg', modified_time: new Date().toISOString(), created_time: '2024-01-15T10:00:00', media_type: 'image', duration: null, codec: null },
      { relative_path: 'b.jpg', file_hash: 'h2', width: 100, height: 100, file_size: 1000, format: 'jpg', modified_time: new Date().toISOString(), created_time: '2024-01-20T10:00:00', media_type: 'image', duration: null, codec: null },
      { relative_path: 'c.jpg', file_hash: 'h3', width: 100, height: 100, file_size: 1000, format: 'jpg', modified_time: new Date().toISOString(), created_time: '2024-02-10T10:00:00', media_type: 'image', duration: null, codec: null },
    ]);

    const stats = thumbsDB.getLibraryStats();
    expect(stats.timeline).toHaveLength(2);
    expect(stats.timeline[0]).toEqual({ month: '2024-01', count: 2 });
    expect(stats.timeline[1]).toEqual({ month: '2024-02', count: 1 });
  });
});
