import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { Library, ThumbnailSize, SearchCriteria, SearchOptions, Tag } from '../../types';
import { logger } from '../../utils/logger';

const ALLOWED_ORDER_BY = ['relative_path', 'created_time', 'modified_time', 'indexed_time'] as const;
const ALLOWED_ORDER = ['ASC', 'DESC'] as const;

function validateOrderBy(orderBy: string, order: string): { orderBy: string; order: string } {
  const validatedOrderBy = ALLOWED_ORDER_BY.includes(orderBy as any) ? orderBy : 'relative_path';
  const validatedOrder = ALLOWED_ORDER.includes(order as any) ? order : 'ASC';
  return { orderBy: validatedOrderBy, order: validatedOrder };
}

// 本地 Image 类型定义（用于数据库操作）
export interface Image {
  id: number;
  relative_path: string;
  file_hash?: string;
  width: number;
  height: number;
  file_size: number;
  format: string;
  orientation: number;
  created_time?: string;
  modified_time?: string;
  indexed_time: string;
  is_deleted: number;
  // 多媒体字段
  media_type: string;  // 'image' | 'video' | 'audio'
  duration: number | null;
  codec: string | null;
  // pHash 感知哈希（用于相似图片查找）
  phash?: string | null;
}

/**
 * 主数据库服务 - 管理 master.db
 */
export class MasterDB {
  private db: DatabaseType | null = null;
  private dbPath: string = '';

  /**
   * 初始化数据库
   * @param userDataPath 可选的用户数据路径，如果不提供则使用 Electron 的 app.getPath('userData')
   */
  initialize(userDataPath?: string): void {
    const resolvedUserDataPath = userDataPath || app.getPath('userData');
    const dataDir = path.join(resolvedUserDataPath, 'data');
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = path.join(dataDir, 'master.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    this.createTables();
  }

  private createTables(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS libraries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        root_path TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'offline',
        last_scan TEXT,
        image_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        tags TEXT,
        rating INTEGER DEFAULT 0,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(library_id, image_path),
        FOREIGN KEY (library_id) REFERENCES libraries(id)
      );

      CREATE TABLE IF NOT EXISTS favorite_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        folder_path TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(library_id, folder_path),
        FOREIGN KEY (library_id) REFERENCES libraries(id)
      );

      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER,
        image_path TEXT,
        viewed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (library_id) REFERENCES libraries(id)
      );

      CREATE INDEX IF NOT EXISTS idx_history_time ON history(viewed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_libraries_status ON libraries(status);

      CREATE TABLE IF NOT EXISTS deleted_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        original_path TEXT NOT NULL,
        file_size INTEGER,
        deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (library_id) REFERENCES libraries(id)
      );
      CREATE INDEX IF NOT EXISTS idx_deleted_time ON deleted_files(deleted_at DESC);

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#888888',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS image_tags (
        tag_id INTEGER NOT NULL,
        library_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tag_id, library_id, image_path),
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_image_tags_path ON image_tags(library_id, image_path);

      CREATE TABLE IF NOT EXISTS folder_covers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        folder_path TEXT NOT NULL,
        cover_path TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(library_id, folder_path),
        FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_folder_covers_lib ON folder_covers(library_id);
    `);
  }

  addLibrary(name: string, rootPath: string): Library {
    if (!this.db) throw new Error('MasterDB 未初始化');
    const stmt = this.db.prepare('INSERT INTO libraries (name, root_path, status) VALUES (?, ?, ?)');
    const result = stmt.run(name, rootPath, 'offline');
    const row = this.db.prepare('SELECT * FROM libraries WHERE id = ?').get(result.lastInsertRowid) as any;
    return this.mapLibrary(row);
  }

  getLibrary(id: number): Library | null {
    if (!this.db) return null;
    const stmt = this.db.prepare('SELECT * FROM libraries WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapLibrary(row) : null;
  }

  getLibraries(): Library[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM libraries ORDER BY created_at DESC');
    return (stmt.all() as any[]).map(row => this.mapLibrary(row));
  }

  private mapLibrary(row: any): Library {
    const cleanPath = (row.root_path || '').trim().replace(/\r/g, '');
    return {
      id: row.id,
      name: (row.name || '').trim(),
      rootPath: cleanPath,
      status: row.status,
      lastScan: row.last_scan,
      imageCount: row.image_count,
      createdAt: row.created_at,
    };
  }

  updateLibraryStatus(id: number, status: 'online' | 'offline', imageCount?: number): void {
    if (!this.db) return;
    const updates: string[] = ['status = ?', 'last_scan = ?'];
    const params: any[] = [status, new Date().toISOString()];
    if (imageCount !== undefined) {
      updates.push('image_count = ?');
      params.push(imageCount);
    }
    params.push(id);
    const stmt = this.db.prepare(`UPDATE libraries SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...params);
  }

  removeLibrary(id: number): void {
    if (!this.db) return;
    const db = this.db;
    // 先删除依赖的外键行，否则 FOREIGN KEY 约束会导致删除失败
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM favorites WHERE library_id = ?').run(id);
      db.prepare('DELETE FROM favorite_folders WHERE library_id = ?').run(id);
      db.prepare('DELETE FROM history WHERE library_id = ?').run(id);
      db.prepare('DELETE FROM image_tags WHERE library_id = ?').run(id);
      db.prepare('DELETE FROM libraries WHERE id = ?').run(id);
    });
    tx();
  }

  addFavorite(libraryId: number, imagePath: string, tags?: string[], rating?: number): void {
    if (!this.db) return;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO favorites (library_id, image_path, tags, rating) VALUES (?, ?, ?, ?)');
    stmt.run(libraryId, imagePath, JSON.stringify(tags || []), rating || 0);
  }

  removeFavorite(libraryId: number, imagePath: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare('DELETE FROM favorites WHERE library_id = ? AND image_path = ?');
    stmt.run(libraryId, imagePath);
  }

  removeHistoryByPath(libraryId: number, imagePath: string): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM history WHERE library_id = ? AND image_path = ?')
      .run(libraryId, imagePath);
  }

  /**
   * 设置图片评分（评分隐含收藏：不存在收藏记录时自动创建）
   * 已存在的收藏保留 tags，仅更新 rating
   */
  setFavoriteRating(libraryId: number, imagePath: string, rating: number): void {
    if (!this.db) return;
    const existing = this.db.prepare('SELECT tags FROM favorites WHERE library_id = ? AND image_path = ?')
      .get(libraryId, imagePath) as { tags: string } | undefined;
    if (existing) {
      this.db.prepare('UPDATE favorites SET rating = ? WHERE library_id = ? AND image_path = ?')
        .run(rating, libraryId, imagePath);
    } else {
      this.addFavorite(libraryId, imagePath, [], rating);
    }
  }

  getFavorites(): Array<{ library_id: number; image_path: string; tags: string[]; rating: number }> {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM favorites');
    return (stmt.all() as any[]).map(row => ({ ...row, tags: JSON.parse(row.tags || '[]') }));
  }

  /**
   * 获取所有收藏的图片（带库信息和图片元数据）
   */
  getFavoriteImages(): Array<{
    library_id: number;
    library_name: string;
    library_root_path: string;
    image_path: string;
    tags: string[];
    rating: number;
    created_at: string;
    image_id?: number;
    width?: number;
    height?: number;
    file_size?: number;
    format?: string;
    media_type?: string;
    duration?: number | null;
    codec?: string | null;
  }> {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT f.library_id, l.name as library_name, l.root_path as library_root_path,
             f.image_path, f.tags, f.rating, f.created_at
      FROM favorites f
      JOIN libraries l ON f.library_id = l.id
      WHERE l.status = 'online'
      ORDER BY f.created_at DESC
    `);
    return (stmt.all() as any[]).map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]')
    }));
  }

  /**
   * 获取收藏数量
   */
  getFavoriteCount(): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM favorites');
    return (stmt.get() as { count: number }).count;
  }

  /**
   * 获取指定库中评分 >= minRating 的收藏图片路径集合
   * 供搜索服务的收藏/评分交集逻辑使用
   */
  getFavoritePathsByMinRating(libraryId: number, minRating: number): string[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      'SELECT image_path FROM favorites WHERE library_id = ? AND rating >= ?'
    );
    return (stmt.all(libraryId, minRating) as Array<{ image_path: string }>).map(r => r.image_path);
  }

  /**
   * 获取单图收藏（所有单独收藏的图片）
   */
  getSingleFavoriteImages(): Array<{
    library_id: number;
    library_name: string;
    library_root_path: string;
    image_path: string;
    tags: string[];
    rating: number;
    created_at: string;
  }> {
    if (!this.db) return [];
    // 查询所有单独收藏的图片（包括属于收藏文件夹的图片）
    const stmt = this.db.prepare(`
      SELECT f.library_id, l.name as library_name, l.root_path as library_root_path,
             f.image_path, f.tags, f.rating, f.created_at
      FROM favorites f
      JOIN libraries l ON f.library_id = l.id
      WHERE l.status = 'online'
      ORDER BY f.created_at DESC
    `);
    return (stmt.all() as any[]).map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]')
    }));
  }

  /**
   * 获取单图收藏数量
   */
  getSingleFavoriteCount(): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM favorites f
      JOIN libraries l ON f.library_id = l.id
      WHERE l.status = 'online'
    `);
    return (stmt.get() as { count: number }).count;
  }

  // ==================== 收藏文件夹相关方法 ====================

  /**
   * 添加收藏文件夹
   */
  addFavoriteFolder(libraryId: number, folderPath: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO favorite_folders (library_id, folder_path) VALUES (?, ?)');
    stmt.run(libraryId, folderPath);
  }

  /**
   * 移除收藏文件夹
   */
  removeFavoriteFolder(libraryId: number, folderPath: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare('DELETE FROM favorite_folders WHERE library_id = ? AND folder_path = ?');
    stmt.run(libraryId, folderPath);
  }

  /**
   * 获取所有收藏的文件夹（带库信息）
   */
  getFavoriteFolders(): Array<{ 
    id: number;
    library_id: number; 
    library_name: string;
    library_root_path: string;
    folder_path: string;
    created_at: string;
  }> {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT ff.id, ff.library_id, l.name as library_name, l.root_path as library_root_path,
             ff.folder_path, ff.created_at
      FROM favorite_folders ff
      JOIN libraries l ON ff.library_id = l.id
      WHERE l.status = 'online'
      ORDER BY ff.created_at DESC
    `);
    return stmt.all() as any[];
  }

  /**
   * 获取收藏的文件夹树（按文件夹层级显示）
   */
  getFavoriteFolderTree(): Array<{
    path: string;
    name: string;
    imageCount: number;
    children?: any[];
    depth: number;
    library_id: number;
    library_name: string;
  }> {
    if (!this.db) return [];
    
    // 获取所有收藏的文件夹
    const stmt = this.db.prepare(`
      SELECT ff.library_id, l.name as library_name, l.root_path as library_root_path,
             ff.folder_path
      FROM favorite_folders ff
      JOIN libraries l ON ff.library_id = l.id
      WHERE l.status = 'online'
    `);
    const favoriteFolders = stmt.all() as any[];
    
    // 构建文件夹树
    const folderMap = new Map<string, { 
      path: string; 
      name: string; 
      imageCount: number; 
      library_id: number;
      library_name: string;
      children: Set<string>;
      depth: number;
      parentPath: string | null;
    }>();

    for (const fav of favoriteFolders) {
      const folderPath = fav.folder_path;
      if (!folderPath) continue; // 跳过根目录

      const parts = folderPath.split(/[\\/]/).filter((p: string) => p);
      
      // 构建每一级文件夹
      let currentPath = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const prevPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        if (!folderMap.has(currentPath)) {
          folderMap.set(currentPath, {
            path: currentPath,
            name: part,
            imageCount: 0,
            library_id: fav.library_id,
            library_name: fav.library_name,
            children: new Set(),
            depth: i,
            parentPath: prevPath || null,
          });
          
          // 添加到父节点的 children
          if (prevPath && folderMap.has(prevPath)) {
            folderMap.get(prevPath)!.children.add(currentPath);
          }
        }
        
        // 如果是收藏的文件夹（不是中间路径），计数 +1
        if (i === parts.length - 1) {
          folderMap.get(currentPath)!.imageCount++;
        }
      }
    }
    
    // 构建树形结构
    const buildTree = (path: string): any => {
      const node = folderMap.get(path);
      if (!node) return null;
      
      const children = Array.from(node.children)
        .map(childPath => buildTree(childPath))
        .filter(Boolean);
      
      return {
        path: node.path,
        name: node.name,
        imageCount: node.imageCount,
        children,
        depth: node.depth,
        library_id: node.library_id,
        library_name: node.library_name,
      };
    };
    
    // 找到所有根节点
    const rootPaths = Array.from(folderMap.keys()).filter(path => {
      const node = folderMap.get(path);
      return node?.parentPath === null;
    });
    
    return rootPaths.map(path => buildTree(path)).filter(Boolean);
  }

  /**
   * 检查文件夹是否已收藏
   */
  isFavoriteFolder(libraryId: number, folderPath: string): boolean {
    if (!this.db) return false;
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM favorite_folders WHERE library_id = ? AND folder_path = ?');
    const result = stmt.get(libraryId, folderPath) as { count: number };
    return result.count > 0;
  }

  // 历史记录容量上限
  private static readonly HISTORY_LIMIT = 500;

  addHistory(libraryId: number, imagePath: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare('INSERT INTO history (library_id, image_path) VALUES (?, ?)');
    stmt.run(libraryId, imagePath);
    // 只保留最近 HISTORY_LIMIT 条，防止无限增长
    this.db.prepare(
      'DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY viewed_at DESC LIMIT ?)'
    ).run(MasterDB.HISTORY_LIMIT);
  }

  /**
   * 获取最近浏览历史（带库信息）
   */
  getHistory(limit: number = 50): Array<{
    library_id: number;
    library_name: string;
    library_root_path: string;
    image_path: string;
    viewed_at: string;
  }> {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT h.library_id, l.name as library_name, l.root_path as library_root_path,
             h.image_path, h.viewed_at
      FROM history h
      JOIN libraries l ON h.library_id = l.id
      ORDER BY h.viewed_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  clearHistory(): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM history').run();
  }

  // ==================== 标签系统 ====================

  createTag(name: string, color: string = '#888888'): Tag {
    if (!this.db) throw new Error('MasterDB 未初始化');
    const stmt = this.db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)');
    const result = stmt.run(name, color);
    return { id: result.lastInsertRowid as number, name, color };
  }

  deleteTag(id: number): void {
    if (!this.db) return;
    // ON DELETE CASCADE 会自动清理 image_tags
    this.db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  }

  renameTag(id: number, name: string, color?: string): void {
    if (!this.db) return;
    if (color !== undefined) {
      this.db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(name, color, id);
    } else {
      this.db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id);
    }
  }

  tagImages(tagIds: number[], libraryId: number, paths: string[]): void {
    if (!this.db || tagIds.length === 0 || paths.length === 0) return;
    const normalizedPaths = paths.map(p => p.replace(/\\/g, '/'));
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO image_tags (tag_id, library_id, image_path) VALUES (?, ?, ?)'
    );
    const tx = this.db.transaction(() => {
      for (const tagId of tagIds) {
        for (const p of normalizedPaths) {
          stmt.run(tagId, libraryId, p);
        }
      }
    });
    tx();
  }

  untagImages(tagIds: number[], libraryId: number, paths: string[]): void {
    if (!this.db || tagIds.length === 0 || paths.length === 0) return;
    const normalizedPaths = paths.map(p => p.replace(/\\/g, '/'));
    const placeholders = normalizedPaths.map(() => '?').join(',');
    const tagPlaceholders = tagIds.map(() => '?').join(',');
    const tx = this.db.transaction(() => {
      this.db!.prepare(
        `DELETE FROM image_tags WHERE tag_id IN (${tagPlaceholders}) AND library_id = ? AND image_path IN (${placeholders})`
      ).run(...tagIds, libraryId, ...normalizedPaths);
    });
    tx();
  }

  getImageTags(libraryId: number, imagePath: string): Tag[] {
    if (!this.db) return [];
    const normalizedPath = imagePath.replace(/\\/g, '/');
    const stmt = this.db.prepare(`
      SELECT t.id, t.name, t.color
      FROM tags t
      JOIN image_tags it ON t.id = it.tag_id
      WHERE it.library_id = ? AND it.image_path = ?
      ORDER BY t.name
    `);
    return stmt.all(libraryId, normalizedPath) as Tag[];
  }

  getTagsWithCount(libraryId: number): Array<Tag & { count: number }> {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT t.id, t.name, t.color, COUNT(it.image_path) as count
      FROM tags t
      LEFT JOIN image_tags it ON t.id = it.tag_id AND it.library_id = ?
      GROUP BY t.id, t.name, t.color
      ORDER BY count DESC, t.name
    `);
    return stmt.all(libraryId) as Array<Tag & { count: number }>;
  }

  /**
   * 获取同时拥有所有指定标签的图片路径（AND 语义）
   */
  getTaggedPaths(libraryId: number, tagIds: number[]): string[] {
    if (!this.db || tagIds.length === 0) return [];
    const placeholders = tagIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT image_path
      FROM image_tags
      WHERE tag_id IN (${placeholders}) AND library_id = ?
      GROUP BY image_path
      HAVING COUNT(DISTINCT tag_id) = ?
    `);
    return (stmt.all(...tagIds, libraryId, tagIds.length) as Array<{ image_path: string }>)
      .map(r => r.image_path);
  }

  // ==================== 路径级联更新 ====================

  updateImagePath(libraryId: number, oldPath: string, newPath: string): void {
    if (!this.db) return;
    const normalizedOld = oldPath.replace(/\\/g, '/');
    const normalizedNew = newPath.replace(/\\/g, '/');

    // 事务保证 favorites + history + image_tags + folder_covers 四条 UPDATE 的原子性
    const tx = this.db.transaction(() => {
      this.db!.prepare(
        'UPDATE favorites SET image_path = ? WHERE library_id = ? AND image_path = ?'
      ).run(normalizedNew, libraryId, normalizedOld);

      this.db!.prepare(
        'UPDATE history SET image_path = ? WHERE library_id = ? AND image_path = ?'
      ).run(normalizedNew, libraryId, normalizedOld);

      this.db!.prepare(
        'UPDATE image_tags SET image_path = ? WHERE library_id = ? AND image_path = ?'
      ).run(normalizedNew, libraryId, normalizedOld);

      // 封面图片路径也需要级联更新
      this.db!.prepare(
        'UPDATE folder_covers SET cover_path = ? WHERE library_id = ? AND cover_path = ?'
      ).run(normalizedNew, libraryId, normalizedOld);
    });
    tx();
  }

  updateFolderPath(libraryId: number, oldFolderPath: string, newFolderPath: string): void {
    if (!this.db) return;
    const normalizedOld = oldFolderPath.replace(/\\/g, '/');
    const normalizedNew = newFolderPath.replace(/\\/g, '/');
    const likePattern = normalizedOld + '/%';

    // 事务保证多表级联更新的原子性（favorite_folders + favorites + history + image_tags）
    const tx = this.db.transaction(() => {
      // favorite_folders 前缀匹配
      const folders = this.db!.prepare(
        'SELECT id, folder_path FROM favorite_folders WHERE library_id = ? AND (folder_path = ? OR folder_path LIKE ?)'
      ).all(libraryId, normalizedOld, likePattern) as Array<{ id: number; folder_path: string }>;

      const updateFolder = this.db!.prepare('UPDATE favorite_folders SET folder_path = ? WHERE id = ?');
      for (const row of folders) {
        const fp = row.folder_path.replace(/\\/g, '/');
        const newPath = fp === normalizedOld ? normalizedNew : normalizedNew + fp.slice(normalizedOld.length);
        updateFolder.run(newPath, row.id);
      }

      // favorites/history/image_tags 前缀匹配
      for (const table of ['favorites', 'history', 'image_tags']) {
        this.db!.prepare(
          `UPDATE ${table} SET image_path = ? || SUBSTR(image_path, LENGTH(?) + 1)
           WHERE library_id = ? AND (image_path = ? OR image_path LIKE ?)`
        ).run(normalizedNew, normalizedOld, libraryId, normalizedOld, likePattern);
      }

      // folder_covers 文件夹路径级联
      const covers = this.db!.prepare(
        'SELECT id, folder_path FROM folder_covers WHERE library_id = ? AND (folder_path = ? OR folder_path LIKE ?)'
      ).all(libraryId, normalizedOld, likePattern) as Array<{ id: number; folder_path: string }>;
      const updateCover = this.db!.prepare('UPDATE folder_covers SET folder_path = ? WHERE id = ?');
      for (const row of covers) {
        const newPath = row.folder_path === normalizedOld
          ? normalizedNew
          : normalizedNew + row.folder_path.slice(normalizedOld.length);
        updateCover.run(newPath, row.id);
      }
    });
    tx();
  }

  // ==================== 已删除文件记录 ====================

  addDeletedFile(libraryId: number, originalPath: string, fileSize: number): void {
    if (!this.db) return;
    this.db.prepare(
      'INSERT INTO deleted_files (library_id, original_path, file_size) VALUES (?, ?, ?)'
    ).run(libraryId, originalPath.replace(/\\/g, '/'), fileSize);
  }

  getDeletedFiles(limit: number = 100, libraryId?: number): Array<{ id: number; library_id: number; library_name: string; original_path: string; deleted_at: string; file_size: number }> {
    if (!this.db) return [];
    if (libraryId !== undefined) {
      return this.db.prepare(
        'SELECT d.*, l.name AS library_name FROM deleted_files d LEFT JOIN libraries l ON d.library_id = l.id WHERE d.library_id = ? ORDER BY d.deleted_at DESC LIMIT ?'
      ).all(libraryId, limit) as any[];
    }
    return this.db.prepare(
      'SELECT d.*, l.name AS library_name FROM deleted_files d LEFT JOIN libraries l ON d.library_id = l.id ORDER BY d.deleted_at DESC LIMIT ?'
    ).all(limit) as any[];
  }

  removeDeletedFile(id: number): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM deleted_files WHERE id = ?').run(id);
  }

  // ==================== 文件夹封面 ====================

  /**
   * 设置文件夹封面图片
   */
  setFolderCover(libraryId: number, folderPath: string, coverPath: string): void {
    if (!this.db) return;
    const normalizedFolder = folderPath.replace(/\\/g, '/');
    const normalizedCover = coverPath.replace(/\\/g, '/');
    this.db.prepare(
      'INSERT OR REPLACE INTO folder_covers (library_id, folder_path, cover_path) VALUES (?, ?, ?)'
    ).run(libraryId, normalizedFolder, normalizedCover);
  }

  /**
   * 移除文件夹封面
   */
  removeFolderCover(libraryId: number, folderPath: string): void {
    if (!this.db) return;
    const normalizedFolder = folderPath.replace(/\\/g, '/');
    this.db.prepare('DELETE FROM folder_covers WHERE library_id = ? AND folder_path = ?')
      .run(libraryId, normalizedFolder);
  }

  /**
   * 获取库的所有文件夹封面映射
   */
  getFolderCovers(libraryId: number): Record<string, string> {
    if (!this.db) return {};
    const rows = this.db.prepare(
      'SELECT folder_path, cover_path FROM folder_covers WHERE library_id = ?'
    ).all(libraryId) as Array<{ folder_path: string; cover_path: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.folder_path] = row.cover_path;
    }
    return result;
  }

  /**
   * 获取单个文件夹的封面路径
   */
  getFolderCover(libraryId: number, folderPath: string): string | null {
    if (!this.db) return null;
    const normalizedFolder = folderPath.replace(/\\/g, '/');
    const row = this.db.prepare(
      'SELECT cover_path FROM folder_covers WHERE library_id = ? AND folder_path = ?'
    ).get(libraryId, normalizedFolder) as { cover_path: string } | undefined;
    return row?.cover_path ?? null;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }
}

/**
 * 分库数据库服务 - 管理 thumbs.db
 */
export class ThumbnailsDB {
  private db: DatabaseType | null = null;
  private dbPath: string = '';

  initialize(libraryPath: string): void {
    // 检查库路径是否存在
    if (!fs.existsSync(libraryPath)) {
      throw new Error(`库路径不存在：${libraryPath}`);
    }

    const libDir = path.join(libraryPath, '.ivlib');
    if (!fs.existsSync(libDir)) {
      fs.mkdirSync(libDir, { recursive: true });
    }
    this.dbPath = path.join(libDir, 'thumbs.db');
    this.db = new Database(this.dbPath);
    this.createTables();
  }

  private createTables(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relative_path TEXT UNIQUE NOT NULL,
        file_hash TEXT,
        width INTEGER,
        height INTEGER,
        file_size INTEGER,
        format TEXT,
        orientation INTEGER DEFAULT 1,
        created_time TEXT,
        modified_time TEXT,
        indexed_time TEXT,
        is_deleted INTEGER DEFAULT 0,
        media_type TEXT DEFAULT 'image',
        duration REAL,
        codec TEXT,
        phash TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_images_path ON images(relative_path);
      CREATE INDEX IF NOT EXISTS idx_images_hash ON images(file_hash);
      CREATE INDEX IF NOT EXISTS idx_images_deleted ON images(is_deleted);
      CREATE INDEX IF NOT EXISTS idx_images_created_time ON images(created_time);
      CREATE INDEX IF NOT EXISTS idx_images_modified_time ON images(modified_time);
      CREATE INDEX IF NOT EXISTS idx_images_indexed_time ON images(indexed_time);
      CREATE INDEX IF NOT EXISTS idx_images_phash ON images(phash);

      CREATE TABLE IF NOT EXISTS thumbnails (
        image_id INTEGER NOT NULL,
        size TEXT NOT NULL,
        data BLOB NOT NULL,
        width INTEGER,
        height INTEGER,
        generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (image_id, size),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

    `);

    // 迁移：为已存在的 images 表添加多媒体字段
    this.migrateMediaColumns();
    // 迁移：为已存在的 images 表添加 phash 字段
    this.migratePhashColumn();
  }

  /**
   * 迁移：添加 media_type, duration, codec 字段（如果不存在）
   */
  private migrateMediaColumns(): void {
    if (!this.db) return;
    try {
      const columns = this.db.pragma("table_info('images')") as Array<{ name: string }>;
      const columnNames = columns.map(c => c.name);
      if (!columnNames.includes('media_type')) {
        this.db.exec("ALTER TABLE images ADD COLUMN media_type TEXT DEFAULT 'image'");
      }
      if (!columnNames.includes('duration')) {
        this.db.exec('ALTER TABLE images ADD COLUMN duration REAL DEFAULT NULL');
      }
      if (!columnNames.includes('codec')) {
        this.db.exec('ALTER TABLE images ADD COLUMN codec TEXT DEFAULT NULL');
      }
    } catch (e) {
      logger.error('ThumbnailsDB', '迁移多媒体字段失败', e);
    }
  }

  /**
   * 迁移：添加 phash 字段（如果不存在）
   */
  private migratePhashColumn(): void {
    if (!this.db) return;
    try {
      const columns = this.db.pragma("table_info('images')") as Array<{ name: string }>;
      const columnNames = columns.map(c => c.name);
      if (!columnNames.includes('phash')) {
        this.db.exec('ALTER TABLE images ADD COLUMN phash TEXT');
      }
    } catch (e) {
      logger.error('ThumbnailsDB', '迁移 phash 字段失败', e);
    }
  }

  addImages(images: Array<{
    relative_path: string;
    file_hash: string;
    width: number;
    height: number;
    file_size: number;
    format: string;
    modified_time: string;
    created_time?: string;
    media_type?: string;
    duration?: number | null;
    codec?: string | null;
    phash?: string | null;
  }>): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(
      'INSERT INTO images (relative_path, file_hash, width, height, file_size, format, created_time, modified_time, indexed_time, media_type, duration, codec, phash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertMany = this.db.transaction((imgs: typeof images) => {
      for (const img of imgs) {
        stmt.run(img.relative_path, img.file_hash, img.width, img.height, img.file_size, img.format, img.created_time ?? null, img.modified_time, new Date().toISOString(), img.media_type || 'image', img.duration ?? null, img.codec ?? null, img.phash ?? null);
      }
    });
    insertMany(images);
    return images.length;
  }

  addImage(image: {
    relative_path: string;
    file_hash: string;
    width: number;
    height: number;
    file_size: number;
    format: string;
    modified_time: string;
    created_time?: string;
    media_type?: string;
    duration?: number | null;
    codec?: string | null;
    phash?: string | null;
  }): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(
      'INSERT INTO images (relative_path, file_hash, width, height, file_size, format, created_time, modified_time, indexed_time, media_type, duration, codec, phash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(image.relative_path, image.file_hash, image.width, image.height, image.file_size, image.format, image.created_time ?? null, image.modified_time, new Date().toISOString(), image.media_type || 'image', image.duration ?? null, image.codec ?? null, image.phash ?? null);
    return result.lastInsertRowid as number;
  }

  updateImage(id: number, updates: Partial<{
    file_hash: string;
    width: number;
    height: number;
    file_size: number;
    created_time: string;
    modified_time: string;
    duration: number | null;
    codec: string | null;
    media_type: string;
    phash: string | null;
  }>): void {
    if (!this.db) return;
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.file_hash) { fields.push('file_hash = ?'); values.push(updates.file_hash); }
    if (updates.width) { fields.push('width = ?'); values.push(updates.width); }
    if (updates.height) { fields.push('height = ?'); values.push(updates.height); }
    if (updates.file_size !== undefined) { fields.push('file_size = ?'); values.push(updates.file_size); }
    if (updates.created_time) { fields.push('created_time = ?'); values.push(updates.created_time); }
    if (updates.modified_time) { fields.push('modified_time = ?'); values.push(updates.modified_time); }
    if (updates.duration !== undefined) { fields.push('duration = ?'); values.push(updates.duration); }
    if (updates.codec !== undefined) { fields.push('codec = ?'); values.push(updates.codec); }
    if (updates.media_type) { fields.push('media_type = ?'); values.push(updates.media_type); }
    if (updates.phash !== undefined) { fields.push('phash = ?'); values.push(updates.phash); }
    fields.push('indexed_time = ?');
    values.push(new Date().toISOString(), id);
    const stmt = this.db.prepare(`UPDATE images SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * 获取无 phash 的图片列表（用于回填）
   */
  getImagesWithoutPhash(limit: number): Array<{ id: number; relative_path: string }> {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      'SELECT id, relative_path FROM images WHERE phash IS NULL AND is_deleted = 0 AND media_type = ? LIMIT ?'
    );
    return stmt.all('image', limit) as Array<{ id: number; relative_path: string }>;
  }

  /**
   * 统计无 phash 的图片数量
   */
  countImagesWithoutPhash(): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM images WHERE phash IS NULL AND is_deleted = 0 AND media_type = ?'
    );
    return (stmt.get('image') as { count: number }).count;
  }

  /**
   * 更新图片的 pHash
   */
  updateImagePhash(id: number, phash: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare('UPDATE images SET phash = ? WHERE id = ?');
    stmt.run(phash, id);
  }

  /**
   * 获取所有有 pHash 的图片（用于相似图查找）
   */
  getImagesWithPhash(): Array<{ id: number; relative_path: string; phash: string }> {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      'SELECT id, relative_path, phash FROM images WHERE phash IS NOT NULL AND phash != \'\' AND is_deleted = 0 AND media_type = ?'
    );
    return stmt.all('image') as Array<{ id: number; relative_path: string; phash: string }>;
  }

  getImage(id: number): Image | null {
    if (!this.db) return null;
    const stmt = this.db.prepare('SELECT * FROM images WHERE id = ? AND is_deleted = 0');
    return stmt.get(id) as Image | null;
  }

  getImageByRelativePath(relativePath: string): Image | null {
    if (!this.db) return null;
    const stmt = this.db.prepare('SELECT * FROM images WHERE relative_path = ? AND is_deleted = 0');
    return stmt.get(relativePath) as Image | null;
  }

  getImages(options: { limit: number; offset: number; orderBy?: string; order?: string }): Image[] {
    if (!this.db) return [];
    const { limit, offset, orderBy = 'relative_path', order = 'ASC' } = options;
    const { orderBy: safeOrderBy, order: safeOrder } = validateOrderBy(orderBy, order);
    const stmt = this.db.prepare(`SELECT * FROM images WHERE is_deleted = 0 ORDER BY ${safeOrderBy} ${safeOrder} LIMIT ? OFFSET ?`);
    return stmt.all(limit, offset) as Image[];
  }

  getImageCount(): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM images WHERE is_deleted = 0');
    return (stmt.get() as { count: number }).count;
  }

  /**
   * 库统计聚合查询：总量/总大小、格式分布、媒体类型分布、月度时间线
   */
  getLibraryStats(): {
    total: number;
    totalSize: number;
    formats: Array<{ format: string; count: number; size: number }>;
    mediaTypes: Array<{ mediaType: string; count: number; size: number }>;
    timeline: Array<{ month: string; count: number }>;
  } {
    if (!this.db) {
      return { total: 0, totalSize: 0, formats: [], mediaTypes: [], timeline: [] };
    }

    // 1) 总量 + 总大小
    const overview = this.db.prepare(
      'SELECT COUNT(*) as total, COALESCE(SUM(file_size), 0) as totalSize FROM images WHERE is_deleted = 0'
    ).get() as { total: number; totalSize: number };

    // 2) 格式分布
    const formats = this.db.prepare(
      'SELECT format, COUNT(*) as count, COALESCE(SUM(file_size), 0) as size FROM images WHERE is_deleted = 0 GROUP BY format ORDER BY count DESC'
    ).all() as Array<{ format: string; count: number; size: number }>;

    // 3) 媒体类型分布
    const mediaTypes = this.db.prepare(
      'SELECT media_type, COUNT(*) as count, COALESCE(SUM(file_size), 0) as size FROM images WHERE is_deleted = 0 GROUP BY media_type ORDER BY count DESC'
    ).all() as Array<{ media_type: string; count: number; size: number }>;

    // 4) 月度时间线（取 created_time 前 7 字符 YYYY-MM）
    const timeline = this.db.prepare(
      "SELECT SUBSTR(created_time, 1, 7) as month, COUNT(*) as count FROM images WHERE is_deleted = 0 AND created_time IS NOT NULL AND created_time != '' GROUP BY month ORDER BY month"
    ).all() as Array<{ month: string; count: number }>;

    return {
      total: overview.total,
      totalSize: overview.totalSize,
      formats,
      mediaTypes: mediaTypes.map(m => ({ mediaType: m.media_type, count: m.count, size: m.size })),
      timeline,
    };
  }

  /**
   * 多条件组合搜索
   * 固定前置条件：is_deleted = 0
   * favoritePaths 语义：
   *   - null / undefined：不加收藏条件
   *   - 空数组 []：收藏条件下无命中，直接返回空
   *   - 非空数组：按 900 条/批拆分为多个 IN (...) 子句，OR 拼接
   */
  searchImages(
    criteria: SearchCriteria,
    options: SearchOptions
  ): { images: Image[]; total: number } {
    if (!this.db) return { images: [], total: 0 };

    // 空收藏路径集 → 收藏条件下无命中
    if (criteria.favoritePaths !== null && criteria.favoritePaths !== undefined
        && criteria.favoritePaths.length === 0) {
      return { images: [], total: 0 };
    }

    const { where, params } = this.buildSearchWhere(criteria);
    const sql = `SELECT * FROM images WHERE is_deleted = 0${where} ORDER BY created_time DESC LIMIT ? OFFSET ?`;
    const countSql = `SELECT COUNT(*) as count FROM images WHERE is_deleted = 0${where}`;

    const allParams = [...params, options.limit, options.offset];
    const countParams = [...params];

    const stmt = this.db.prepare(sql);
    const countStmt = this.db.prepare(countSql);
    const images = stmt.all(...allParams) as Image[];
    const total = (countStmt.get(...countParams) as { count: number }).count;

    return { images, total };
  }

  /**
   * 构造搜索 WHERE 子句（不含 is_deleted 前置条件）
   * 返回 { where, params }：where 为带前导 AND 的字符串片段，params 为对应参数数组
   */
  private buildSearchWhere(criteria: SearchCriteria): { where: string; params: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];

    // 文件名模糊匹配：LIKE %keyword%，前缀 % 无法走索引，百万级实测 <1s 可接受
    if (criteria.fileName && criteria.fileName.trim()) {
      clauses.push('relative_path LIKE ?');
      params.push(`%${criteria.fileName.trim()}%`);
    }

    // 格式过滤：formats 为小写无点扩展名数组
    if (criteria.formats && criteria.formats.length > 0) {
      const placeholders = criteria.formats.map(() => '?').join(',');
      clauses.push(`LOWER(format) IN (${placeholders})`);
      params.push(...criteria.formats);
    }

    // 尺寸范围
    if (criteria.minWidth !== undefined) {
      clauses.push('width >= ?');
      params.push(criteria.minWidth);
    }
    if (criteria.maxWidth !== undefined) {
      clauses.push('width <= ?');
      params.push(criteria.maxWidth);
    }
    if (criteria.minHeight !== undefined) {
      clauses.push('height >= ?');
      params.push(criteria.minHeight);
    }
    if (criteria.maxHeight !== undefined) {
      clauses.push('height <= ?');
      params.push(criteria.maxHeight);
    }

    // 文件大小范围（字节）
    if (criteria.minFileSize !== undefined) {
      clauses.push('file_size >= ?');
      params.push(criteria.minFileSize);
    }
    if (criteria.maxFileSize !== undefined) {
      clauses.push('file_size <= ?');
      params.push(criteria.maxFileSize);
    }

    // 拍摄日期范围（ISO 日期字符串直接比较，格式固定 YYYY-MM-DD）
    if (criteria.createdFrom) {
      clauses.push('created_time >= ?');
      params.push(criteria.createdFrom);
    }
    if (criteria.createdTo) {
      clauses.push('created_time <= ?');
      params.push(criteria.createdTo + 'T23:59:59');
    }

    // 媒体类型
    if (criteria.mediaType) {
      clauses.push('media_type = ?');
      params.push(criteria.mediaType);
    }

    // 收藏路径交集：按 900 条/批拆分，多批 OR 拼接
    const favPaths = criteria.favoritePaths;
    if (favPaths !== null && favPaths !== undefined && favPaths.length > 0) {
      const BATCH_SIZE = 900;
      const batchClauses: string[] = [];
      for (let i = 0; i < favPaths.length; i += BATCH_SIZE) {
        const batch = favPaths.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(',');
        batchClauses.push(`relative_path IN (${placeholders})`);
        params.push(...batch);
      }
      clauses.push(`(${batchClauses.join(' OR ')})`);
    }

    const where = clauses.length > 0 ? ' AND ' + clauses.join(' AND ') : '';
    return { where, params };
  }

  saveThumbnail(imageId: number, size: ThumbnailSize, data: Buffer, width?: number, height?: number): void {
    if (!this.db) return;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO thumbnails (image_id, size, data, width, height) VALUES (?, ?, ?, ?, ?)');
    stmt.run(imageId, size, data, width, height);
  }

  getThumbnail(imageId: number, size: ThumbnailSize): Buffer | null {
    if (!this.db) return null;
    const stmt = this.db.prepare('SELECT data FROM thumbnails WHERE image_id = ? AND size = ?');
    const result = stmt.get(imageId, size) as { data: Buffer } | undefined;
    return result?.data || null;
  }

  getThumbnails(imageIds: number[], size: ThumbnailSize): Map<number, Buffer> {
    const result = new Map<number, Buffer>();
    if (!this.db || imageIds.length === 0) return result;
    const placeholders = imageIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`SELECT image_id, data FROM thumbnails WHERE image_id IN (${placeholders}) AND size = ?`);
    const rows = stmt.all(...imageIds, size) as Array<{ image_id: number; data: Buffer }>;
    for (const row of rows) {
      result.set(row.image_id, row.data);
    }
    return result;
  }

  markAsDeleted(relativePath: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare('UPDATE images SET is_deleted = 1 WHERE relative_path = ?');
    stmt.run(relativePath);
  }

  cleanupDeleted(): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare('DELETE FROM images WHERE is_deleted = 1');
    return stmt.run().changes;
  }

  /**
   * 获取全部未删除图片记录（供扫描器批量预载，避免逐条查询）
   */
  getAllImages(): Image[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM images WHERE is_deleted = 0');
    return stmt.all() as Image[];
  }

  /**
   * 获取文件夹树（只展示文件夹层级，不展示文件）
   */
  getFolders(): Array<{ path: string; name: string; imageCount: number; parentPath: string | null }> {
    if (!this.db) return [];
    
    // 查询所有有图片的文件夹
    const stmt = this.db.prepare(`
      SELECT 
        CASE 
          WHEN INSTR(relative_path, '/') > 0 THEN SUBSTR(relative_path, 1, INSTR(relative_path, '/') - 1)
          ELSE NULL
        END as folder_path,
        CASE 
          WHEN INSTR(relative_path, '/') > 0 THEN SUBSTR(relative_path, INSTR(relative_path, '/') + 1)
          ELSE relative_path
        END as file_name,
        COUNT(*) as image_count
      FROM images 
      WHERE is_deleted = 0
      GROUP BY folder_path
    `);
    
    const rows = stmt.all() as Array<{ folder_path: string | null; image_count: number }>;
    
    // 过滤掉根目录（folder_path 为 NULL 的记录表示图片在根目录）
    const folders = rows
      .filter(row => row.folder_path !== null)
      .map(row => ({
        path: row.folder_path as string,
        name: (row.folder_path as string).split('/').pop() || row.folder_path as string,
        imageCount: row.image_count,
        parentPath: null
      }));
    
    // 去重并合并计数
    const folderMap = new Map<string, { path: string; name: string; imageCount: number; parentPath: string | null }>();
    for (const folder of folders) {
      if (folderMap.has(folder.path)) {
        folderMap.get(folder.path)!.imageCount += folder.imageCount;
      } else {
        folderMap.set(folder.path, folder);
      }
    }
    
    return Array.from(folderMap.values());
  }

  /**
   * 获取完整的文件夹树（递归构建）
   */
  getFolderTree(): Array<{ path: string; name: string; imageCount: number; children: any[]; depth: number }> {
    if (!this.db) return [];

    // 获取所有图片的相对路径
    const allPathsStmt = this.db.prepare('SELECT relative_path FROM images WHERE is_deleted = 0');
    const allPaths = (allPathsStmt.all() as Array<{ relative_path: string }>).map(row => row.relative_path);

    // 构建文件夹树
    const folderMap = new Map<string, { path: string; name: string; imageCount: number; children: Set<string>; depth: number; parentPath: string | null }>();

    for (const relativePath of allPaths) {
      // 同时支持 Windows 和 Unix 路径分隔符
      const parts = relativePath.split(/[\\/]/);

      // 只取文件夹部分（不包含文件名）
      const folderParts = parts.slice(0, -1);

      if (folderParts.length === 0) {
        // 图片在根目录，不计入文件夹树
        continue;
      }

      // 构建每一级文件夹（统一使用 / 作为路径分隔符）
      let currentPath = '';
      for (let i = 0; i < folderParts.length; i++) {
        const part = folderParts[i];
        const prevPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!folderMap.has(currentPath)) {
          folderMap.set(currentPath, {
            path: currentPath,
            name: part,
            imageCount: 0,
            children: new Set(),
            depth: i,
            parentPath: prevPath || null
          });

          // 添加到父节点的 children
          if (prevPath && folderMap.has(prevPath)) {
            folderMap.get(prevPath)!.children.add(currentPath);
          }
        }

        // 每一级文件夹都计数 +1（因为这张图片属于这个文件夹路径）
        folderMap.get(currentPath)!.imageCount++;
      }
    }

    // 构建树形结构
    const buildTree = (path: string): any => {
      const node = folderMap.get(path);
      if (!node) return null;

      const children = Array.from(node.children)
        .map(childPath => buildTree(childPath))
        .filter(Boolean);

      return {
        path: node.path,
        name: node.name,
        imageCount: node.imageCount,
        children,
        depth: node.depth
      };
    };

    // 找到所有根节点（没有父节点的文件夹，即第一级文件夹）
    const rootPaths = Array.from(folderMap.keys()).filter(path => {
      const node = folderMap.get(path);
      return node?.parentPath === null;
    });

    return rootPaths.map(path => buildTree(path)).filter(Boolean);
  }

  /**
   * 获取指定文件夹下的图片数量
   */
  getFolderImageCount(folderPath: string | null): number {
    if (!this.db) return 0;
    
    if (folderPath === null) {
      // 返回所有图片数量
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM images WHERE is_deleted = 0');
      return (stmt.get() as { count: number }).count;
    }
    
    // 返回指定文件夹下的图片数量（包括子文件夹）
    // 需要同时匹配 / 和 \ 分隔符
    const normalizedPath = folderPath.replace(/\//g, '\\');
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM images 
      WHERE is_deleted = 0 
        AND (relative_path LIKE ? OR relative_path LIKE ? OR relative_path LIKE ? OR relative_path LIKE ?)
    `);
    const result = stmt.get(
      `${normalizedPath}\\%`,
      `${normalizedPath}%`,
      `${folderPath}\\%`,
      `${folderPath}%`
    ) as { count: number };
    return result.count;
  }

  /**
   * 获取指定文件夹下的图片列表
   */
  getImagesByFolder(
    folderPath: string | null,
    options: { limit: number; offset: number; orderBy?: string; order?: string }
  ): Image[] {
    if (!this.db) return [];

    const { limit, offset, orderBy = 'relative_path', order = 'ASC' } = options;
    const { orderBy: safeOrderBy, order: safeOrder } = validateOrderBy(orderBy, order);

    if (folderPath === null) {
      // 获取所有图片
      const stmt = this.db.prepare(`
        SELECT * FROM images
        WHERE is_deleted = 0
        ORDER BY ${safeOrderBy} ${safeOrder}
        LIMIT ? OFFSET ?
      `);
      return stmt.all(limit, offset) as Image[];
    }

    // 获取指定文件夹下的图片（包括子文件夹）
    // 需要同时匹配 / 和 \ 分隔符
    const normalizedPath = folderPath.replace(/\//g, '\\');
    const stmt = this.db.prepare(`
      SELECT * FROM images
      WHERE is_deleted = 0
        AND (relative_path LIKE ? OR relative_path LIKE ? OR relative_path LIKE ? OR relative_path = ? OR relative_path = ?)
      ORDER BY ${safeOrderBy} ${safeOrder}
      LIMIT ? OFFSET ?
    `);
    return stmt.all(
      `${normalizedPath}\\%`,
      `${normalizedPath}%`,
      `${folderPath}\\%`,
      normalizedPath,
      folderPath,
      limit,
      offset
    ) as Image[];
  }

  /**
   * 获取指定文件夹下的图片总数
   */
  getImagesCountByFolder(folderPath: string | null): number {
    if (!this.db) return 0;
    
    if (folderPath === null) {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM images WHERE is_deleted = 0');
      return (stmt.get() as { count: number }).count;
    }
    
    // 需要同时匹配 / 和 \ 分隔符
    const normalizedPath = folderPath.replace(/\//g, '\\');
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM images 
      WHERE is_deleted = 0 
        AND (relative_path LIKE ? OR relative_path LIKE ? OR relative_path LIKE ? OR relative_path = ? OR relative_path = ?)
    `);
    return (stmt.get(
      `${normalizedPath}\\%`,
      `${normalizedPath}%`,
      `${folderPath}\\%`,
      normalizedPath,
      folderPath
    ) as { count: number }).count;
  }

  updateRelativePath(oldPath: string, newPath: string): void {
    if (!this.db) return;
    this.db.prepare('UPDATE images SET relative_path = ? WHERE relative_path = ?')
      .run(newPath.replace(/\\/g, '/'), oldPath.replace(/\\/g, '/'));
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }
}

let masterDBInstance: MasterDB | null = null;
const thumbnailsDBInstances = new Map<string, ThumbnailsDB>();

export function getMasterDB(userDataPath?: string): MasterDB {
  if (!masterDBInstance) {
    masterDBInstance = new MasterDB();
    masterDBInstance.initialize(userDataPath);
  }
  return masterDBInstance;
}

export function getThumbnailsDB(libraryPath: string): ThumbnailsDB {
  if (!thumbnailsDBInstances.has(libraryPath)) {
    const db = new ThumbnailsDB();
    db.initialize(libraryPath);
    thumbnailsDBInstances.set(libraryPath, db);
  }
  return thumbnailsDBInstances.get(libraryPath)!;
}

/**
 * 关闭并移除指定路径的数据库实例
 */
export function closeThumbnailsDB(libraryPath: string): void {
  const db = thumbnailsDBInstances.get(libraryPath);
  if (db) {
    db.close();
    thumbnailsDBInstances.delete(libraryPath);
  }
}

export function closeAllDatabases(): void {
  masterDBInstance?.close();
  masterDBInstance = null;
  for (const db of thumbnailsDBInstances.values()) {
    db.close();
  }
  thumbnailsDBInstances.clear();
}
