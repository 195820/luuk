import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { Library, ThumbnailSize } from '../../types';

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
}

/**
 * 主数据库服务 - 管理 master.db
 */
export class MasterDB {
  private db: DatabaseType | null = null;
  private dbPath: string = '';

  initialize(): void {
    const userDataPath = app.getPath('userData');
    const dataDir = path.join(userDataPath, 'data');
    
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

      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER,
        image_path TEXT,
        viewed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (library_id) REFERENCES libraries(id)
      );

      CREATE INDEX IF NOT EXISTS idx_history_time ON history(viewed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_libraries_status ON libraries(status);
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
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      root_path: row.root_path,
      status: row.status,
      lastScan: row.last_scan,
      last_scan: row.last_scan,
      imageCount: row.image_count,
      image_count: row.image_count,
      createdAt: row.created_at,
      created_at: row.created_at,
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
    const stmt = this.db.prepare('DELETE FROM libraries WHERE id = ?');
    stmt.run(id);
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

  getFavorites(): Array<{ library_id: number; image_path: string; tags: string[]; rating: number }> {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM favorites');
    return (stmt.all() as any[]).map(row => ({ ...row, tags: JSON.parse(row.tags || '[]') }));
  }

  addHistory(libraryId: number, imagePath: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare('INSERT INTO history (library_id, image_path) VALUES (?, ?)');
    stmt.run(libraryId, imagePath);
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
        is_deleted INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_images_path ON images(relative_path);
      CREATE INDEX IF NOT EXISTS idx_images_hash ON images(file_hash);
      CREATE INDEX IF NOT EXISTS idx_images_deleted ON images(is_deleted);

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

      CREATE TABLE IF NOT EXISTS previews (
        image_id INTEGER PRIMARY KEY,
        data BLOB NOT NULL,
        width INTEGER,
        height INTEGER,
        generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS folders (
        path TEXT PRIMARY KEY,
        parent_path TEXT,
        image_count INTEGER DEFAULT 0,
        cover_image_path TEXT,
        last_modified TEXT
      );
    `);
  }

  addImages(images: Array<{
    relative_path: string;
    file_hash: string;
    width: number;
    height: number;
    file_size: number;
    format: string;
    modified_time: string;
  }>): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(
      'INSERT INTO images (relative_path, file_hash, width, height, file_size, format, modified_time, indexed_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertMany = this.db.transaction((imgs: typeof images) => {
      for (const img of imgs) {
        stmt.run(img.relative_path, img.file_hash, img.width, img.height, img.file_size, img.format, img.modified_time, new Date().toISOString());
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
  }): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(
      'INSERT INTO images (relative_path, file_hash, width, height, file_size, format, modified_time, indexed_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(image.relative_path, image.file_hash, image.width, image.height, image.file_size, image.format, image.modified_time, new Date().toISOString());
    return result.lastInsertRowid as number;
  }

  updateImage(id: number, updates: Partial<{
    file_hash: string;
    width: number;
    height: number;
    file_size: number;
    modified_time: string;
  }>): void {
    if (!this.db) return;
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.file_hash) { fields.push('file_hash = ?'); values.push(updates.file_hash); }
    if (updates.width) { fields.push('width = ?'); values.push(updates.width); }
    if (updates.height) { fields.push('height = ?'); values.push(updates.height); }
    if (updates.file_size) { fields.push('file_size = ?'); values.push(updates.file_size); }
    if (updates.modified_time) { fields.push('modified_time = ?'); values.push(updates.modified_time); }
    fields.push('indexed_time = ?');
    values.push(new Date().toISOString(), id);
    const stmt = this.db.prepare(`UPDATE images SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  getImageByPath(relativePath: string): Image | null {
    if (!this.db) return null;
    const stmt = this.db.prepare('SELECT * FROM images WHERE relative_path = ? AND is_deleted = 0');
    return stmt.get(relativePath) as Image | null;
  }

  getImage(id: number): Image | null {
    if (!this.db) return null;
    const stmt = this.db.prepare('SELECT * FROM images WHERE id = ? AND is_deleted = 0');
    return stmt.get(id) as Image | null;
  }

  getImages(options: { limit: number; offset: number; orderBy?: string; order?: string }): Image[] {
    if (!this.db) return [];
    const { limit, offset, orderBy = 'relative_path', order = 'ASC' } = options;
    const stmt = this.db.prepare(`SELECT * FROM images WHERE is_deleted = 0 ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`);
    return stmt.all(limit, offset) as Image[];
  }

  getImageCount(): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM images WHERE is_deleted = 0');
    return (stmt.get() as { count: number }).count;
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

  getAllPaths(): string[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT relative_path FROM images WHERE is_deleted = 0');
    return (stmt.all() as { relative_path: string }[]).map(row => row.relative_path);
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
    
    if (folderPath === null) {
      // 获取所有图片
      const stmt = this.db.prepare(`
        SELECT * FROM images 
        WHERE is_deleted = 0 
        ORDER BY ${orderBy} ${order} 
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
      ORDER BY ${orderBy} ${order} 
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

export function getMasterDB(): MasterDB {
  if (!masterDBInstance) {
    masterDBInstance = new MasterDB();
    masterDBInstance.initialize();
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
