import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock electron（database.ts 顶部 import { app } from 'electron'）
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}));

import { MasterDB } from '../database';

describe('标签系统', () => {
  let masterDB: MasterDB;
  let tempDir: string;
  let libDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivtag-'));
    libDir = path.join(tempDir, 'library');
    fs.mkdirSync(libDir, { recursive: true });

    masterDB = new MasterDB();
    masterDB.initialize(tempDir);
    masterDB.addLibrary('测试库', libDir);
    masterDB.updateLibraryStatus(1, 'online');
  });

  afterEach(() => {
    masterDB.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ==================== CRUD ====================

  it('createTag 创建标签并返回完整对象', () => {
    const tag = masterDB.createTag('风景', '#ff0000');
    expect(tag).toMatchObject({ name: '风景', color: '#ff0000' });
    expect(tag.id).toBeGreaterThan(0);
  });

  it('createTag 默认颜色为 #888888', () => {
    const tag = masterDB.createTag('人物');
    expect(tag.color).toBe('#888888');
  });

  it('createTag 重名抛错（UNIQUE 约束）', () => {
    masterDB.createTag('风景');
    expect(() => masterDB.createTag('风景')).toThrow();
  });

  it('deleteTag 删除标签', () => {
    const tag = masterDB.createTag('临时');
    masterDB.deleteTag(tag.id);
    const tags = masterDB.getTagsWithCount(1);
    expect(tags.find(t => t.id === tag.id)).toBeUndefined();
  });

  it('deleteTag 级联清理 image_tags（ON DELETE CASCADE）', () => {
    const tag = masterDB.createTag('级联测试');
    masterDB.tagImages([tag.id], 1, ['a.jpg', 'b.jpg']);
    expect(masterDB.getTaggedPaths(1, [tag.id])).toHaveLength(2);

    masterDB.deleteTag(tag.id);
    expect(masterDB.getTaggedPaths(1, [tag.id])).toHaveLength(0);
  });

  it('renameTag 改名', () => {
    const tag = masterDB.createTag('旧名');
    masterDB.renameTag(tag.id, '新名');
    const tags = masterDB.getTagsWithCount(1);
    expect(tags.find(t => t.id === tag.id)?.name).toBe('新名');
  });

  it('renameTag 同时改颜色', () => {
    const tag = masterDB.createTag('配色', '#000000');
    masterDB.renameTag(tag.id, '配色', '#ffffff');
    const tags = masterDB.getTagsWithCount(1);
    expect(tags.find(t => t.id === tag.id)?.color).toBe('#ffffff');
  });

  // ==================== 打标/去标 ====================

  it('tagImages 批量打标多张图片', () => {
    const tag = masterDB.createTag('批量');
    masterDB.tagImages([tag.id], 1, ['a.jpg', 'b.jpg', 'c.jpg']);
    const paths = masterDB.getTaggedPaths(1, [tag.id]);
    expect(paths.sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('tagImages 多标签批量打标', () => {
    const t1 = masterDB.createTag('标签A');
    const t2 = masterDB.createTag('标签B');
    masterDB.tagImages([t1.id, t2.id], 1, ['x.jpg']);

    const tags = masterDB.getImageTags(1, 'x.jpg');
    expect(tags).toHaveLength(2);
    expect(tags.map(t => t.name).sort()).toEqual(['标签A', '标签B']);
  });

  it('tagImages 幂等（重复打标不报错）', () => {
    const tag = masterDB.createTag('幂等');
    masterDB.tagImages([tag.id], 1, ['a.jpg']);
    expect(() => masterDB.tagImages([tag.id], 1, ['a.jpg'])).not.toThrow();
    expect(masterDB.getTaggedPaths(1, [tag.id])).toHaveLength(1);
  });

  it('untagImages 去标', () => {
    const tag = masterDB.createTag('去标');
    masterDB.tagImages([tag.id], 1, ['a.jpg', 'b.jpg']);
    masterDB.untagImages([tag.id], 1, ['a.jpg']);
    const paths = masterDB.getTaggedPaths(1, [tag.id]);
    expect(paths).toEqual(['b.jpg']);
  });

  it('getTagsWithCount 计数正确', () => {
    const t1 = masterDB.createTag('热门');
    const t2 = masterDB.createTag('冷门');
    masterDB.tagImages([t1.id], 1, ['a.jpg', 'b.jpg', 'c.jpg']);
    masterDB.tagImages([t2.id], 1, ['a.jpg']);

    const tags = masterDB.getTagsWithCount(1);
    expect(tags.find(t => t.id === t1.id)?.count).toBe(3);
    expect(tags.find(t => t.id === t2.id)?.count).toBe(1);
  });

  it('getImageTags 返回图片的所有标签', () => {
    const t1 = masterDB.createTag('Alpha');
    const t2 = masterDB.createTag('Beta');
    masterDB.tagImages([t1.id, t2.id], 1, ['photo.jpg']);

    const tags = masterDB.getImageTags(1, 'photo.jpg');
    expect(tags).toHaveLength(2);
    // 按 name 排序
    expect(tags[0].name).toBe('Alpha');
    expect(tags[1].name).toBe('Beta');
  });

  // ==================== getTaggedPaths AND 语义 ====================

  it('getTaggedPaths 单标签返回所有命中路径', () => {
    const tag = masterDB.createTag('单标签');
    masterDB.tagImages([tag.id], 1, ['a.jpg', 'b.jpg']);
    expect(masterDB.getTaggedPaths(1, [tag.id]).sort()).toEqual(['a.jpg', 'b.jpg']);
  });

  it('getTaggedPaths 多标签 AND 语义（只返回同时拥有所有标签的图片）', () => {
    const t1 = masterDB.createTag('条件A');
    const t2 = masterDB.createTag('条件B');
    // a.jpg 同时有两个标签，b.jpg 只有一个
    masterDB.tagImages([t1.id, t2.id], 1, ['a.jpg']);
    masterDB.tagImages([t1.id], 1, ['b.jpg']);

    const result = masterDB.getTaggedPaths(1, [t1.id, t2.id]);
    expect(result).toEqual(['a.jpg']);
  });

  it('getTaggedPaths 空 tagIds 返回空数组', () => {
    expect(masterDB.getTaggedPaths(1, [])).toEqual([]);
  });

  // ==================== 级联回归 ====================

  it('updateImagePath 后标签跟随新路径', () => {
    const tag = masterDB.createTag('级联重命名');
    masterDB.tagImages([tag.id], 1, ['photos/old.jpg']);

    masterDB.updateImagePath(1, 'photos/old.jpg', 'photos/new.jpg');

    const paths = masterDB.getTaggedPaths(1, [tag.id]);
    expect(paths).toEqual(['photos/new.jpg']);
    // 旧路径不再命中
    expect(masterDB.getImageTags(1, 'photos/old.jpg')).toHaveLength(0);
  });

  it('updateFolderPath 后子路径图片标签跟随', () => {
    const tag = masterDB.createTag('文件夹级联');
    masterDB.tagImages([tag.id], 1, [
      '2024/day1/001.jpg',
      '2024/day1/002.jpg',
      '2024/day2/001.jpg',
    ]);

    masterDB.updateFolderPath(1, '2024/day1', '2024/renamed');

    const paths = masterDB.getTaggedPaths(1, [tag.id]).sort();
    expect(paths).toEqual([
      '2024/day2/001.jpg',
      '2024/renamed/001.jpg',
      '2024/renamed/002.jpg',
    ]);
  });

  it('removeLibrary 清理 image_tags', () => {
    const tag = masterDB.createTag('清理测试');
    masterDB.tagImages([tag.id], 1, ['a.jpg']);

    masterDB.removeLibrary(1);

    // 库已删除，标签关联也应清除
    // 注意：removeLibrary 后 tags 表记录仍在（不依赖库），但 image_tags 已清空
    const tags = masterDB.getTagsWithCount(1);
    // 库不存在后查询返回空（LEFT JOIN 无匹配行，但 tags 表记录仍在）
    // 实际行为：getTagsWithCount 按 libraryId 过滤 image_tags，库删了后计数为 0
    expect(tags.find(t => t.id === tag.id)?.count ?? 0).toBe(0);
  });
});
