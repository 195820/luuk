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
    console.log('[MasterDB] 初始化完成:', this.dbPath);
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
    return this.mapLibrary(stmt.get(result.lastInsertRowid) as any);
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
    const libDir = path.join(libraryPath, '.ivlib');
    if (!fs.existsSync(libDir)) {
      fs.mkdirSync(libDir, { recursive: true });
    }
    this.dbPath = path.join(libDir, 'thumbs.db');
    this.db = new Database(this.dbPath);
    this.createTables();
    console.log('[ThumbnailsDB] 初始化完成:', this.dbPath);
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

export function closeAllDatabases(): void {
  masterDBInstance?.close();
  masterDBInstance = null;
  for (const db of thumbnailsDBInstances.values()) {
    db.close();
  }
  thumbnailsDBInstances.clear();
}
