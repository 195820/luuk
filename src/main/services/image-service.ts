import path from 'path';
import fs from 'fs';
import { 
  MasterDB, 
  ThumbnailsDB, 
  getMasterDB, 
  getThumbnailsDB,
  closeAllDatabases 
} from './database';
import { getThumbnailer, generateThumbnail } from './thumbnailer';
import { LibraryScanner, ScanResult } from './scanner';
import { getLRUCache, LRUCache } from './cache';
import type { Library, ThumbnailSize } from '../../types';

/**
 * 图片查询选项
 */
export interface ImageQueryOptions {
  limit: number;
  offset: number;
  orderBy?: 'created_time' | 'modified_time' | 'relative_path';
  order?: 'ASC' | 'DESC';
}

/**
 * 添加库选项
 */
export interface AddLibraryOptions {
  name: string;
  rootPath: string;
  autoScan?: boolean;
}

/**
 * 图片服务 - 统一接口
 * 整合所有底层服务，提供简洁的 API
 */
export class ImageService {
  private masterDB: MasterDB;
  private thumbnailsDBs: Map<string, ThumbnailsDB> = new Map();
  private scanners: Map<string, LibraryScanner> = new Map();
  private cache: LRUCache;
  private initialized: boolean = false;

  constructor() {
    this.masterDB = getMasterDB();
    this.cache = getLRUCache(200);
  }

  /**
   * 初始化服务
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[ImageService] 初始化...');
    
    // 恢复已注册的库
    const libraries = this.masterDB.getLibraries();
    for (const lib of libraries) {
      if (fs.existsSync(lib.rootPath)) {
        this.connectLibrary(lib.id);
        this.masterDB.updateLibraryStatus(lib.id, 'online', lib.imageCount);
      }
    }

    this.initialized = true;
    console.log('[ImageService] 初始化完成，已加载', libraries.length, '个库');
  }

  /**
   * 连接分库数据库
   */
  private connectLibrary(libraryId: number): ThumbnailsDB {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    if (!this.thumbnailsDBs.has(library.rootPath)) {
      const db = getThumbnailsDB(library.rootPath);
      this.thumbnailsDBs.set(library.rootPath, db);
      this.scanners.set(library.rootPath, new LibraryScanner(db, library.rootPath));
    }

    return this.thumbnailsDBs.get(library.rootPath)!;
  }

  /**
   * 添加图片库
   */
  async addLibrary(options: AddLibraryOptions): Promise<Library> {
    // 验证路径
    if (!fs.existsSync(options.rootPath)) {
      throw new Error(`目录不存在：${options.rootPath}`);
    }

    // 添加到主数据库
    const library = this.masterDB.addLibrary(options.name, options.rootPath);
    
    // 连接分库
    this.connectLibrary(library.id);

    // 自动扫描
    if (options.autoScan !== false) {
      // 异步扫描，不阻塞返回
      this.scanLibrary(library.id).catch(console.error);
    }

    return library;
  }

  /**
   * 删除图片库
   */
  async removeLibrary(libraryId: number): Promise<void> {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    // 关闭分库数据库
    const db = this.thumbnailsDBs.get(library.rootPath);
    if (db) {
      db.close();
      this.thumbnailsDBs.delete(library.rootPath);
      this.scanners.delete(library.rootPath);
    }

    // 从主数据库删除
    this.masterDB.removeLibrary(libraryId);
  }

  /**
   * 获取所有库
   */
  getLibraries(): Library[] {
    return this.masterDB.getLibraries();
  }

  /**
   * 扫描库
   */
  async scanLibrary(libraryId: number): Promise<ScanResult> {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    const scanner = new LibraryScanner(db, library.rootPath);
    
    const result = await scanner.scan();
    
    // 更新库状态
    this.masterDB.updateLibraryStatus(libraryId, 'online', result.total);
    
    return result;
  }

  /**
   * 获取图片列表
   */
  getImages(libraryId: number, options: ImageQueryOptions): any[] {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    const images = db.getImages(options);

    // 附加库信息
    return images.map(img => ({
      ...img,
      library_id: libraryId,
      library_name: library.name
    }));
  }

  /**
   * 获取图片总数
   */
  getImageCount(libraryId: number): number {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    return db.getImageCount();
  }

  /**
   * 获取单张图片
   */
  getImage(libraryId: number, imageId: number): any | null {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    const image = db.getImage(imageId);

    if (image) {
      return {
        ...image,
        library_id: libraryId,
        library_name: library.name
      };
    }

    return null;
  }

  /**
   * 获取缩略图 (带缓存)
   */
  async getThumbnail(
    libraryId: number,
    imageId: number,
    size: ThumbnailSize = 'medium'
  ): Promise<string> {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);

    // ① 检查内存缓存 - 使用 libraryId-imageId 作为 key
    const cached = this.cache.get(`${libraryId}-${imageId}`, size);
    if (cached) {
      return cached;
    }

    // ② 检查数据库缓存
    const thumbnailData = db.getThumbnail(imageId, size);
    if (thumbnailData) {
      const base64 = `data:image/webp;base64,${thumbnailData.toString('base64')}`;
      this.cache.set(`${libraryId}-${imageId}`, size, base64);
      return base64;
    }

    // ③ 实时生成
    const image = db.getImage(imageId);
    if (!image) {
      throw new Error(`图片不存在：${imageId}`);
    }

    const fullPath = path.join(library.rootPath, image.relative_path);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`图片文件不存在：${fullPath}`);
    }

    // 生成缩略图
    const thumbnail = await generateThumbnail(fullPath, size);

    // 保存到数据库
    const thumbMetadata = await getThumbnailer().getImageMetadata(fullPath);
    db.saveThumbnail(imageId, size, thumbnail, thumbMetadata.width, thumbMetadata.height);

    // 写入内存缓存
    const base64 = `data:image/webp;base64,${thumbnail.toString('base64')}`;
    this.cache.set(`${libraryId}-${imageId}`, size, base64);

    return base64;
  }

  /**
   * 批量获取缩略图
   */
  async getThumbnails(
    libraryId: number,
    imageIds: number[],
    size: ThumbnailSize = 'medium'
  ): Promise<Map<number, string>> {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    const result = new Map<number, string>();

    // 检查内存缓存 - 使用 libraryId-imageId 作为 key
    const needToLoad: number[] = [];
    for (const id of imageIds) {
      const cached = this.cache.get(`${libraryId}-${id}`, size);
      if (cached) {
        result.set(id, cached);
      } else {
        needToLoad.push(id);
      }
    }

    if (needToLoad.length === 0) {
      return result;
    }

    // 检查数据库缓存
    const dbCache = db.getThumbnails(needToLoad, size);
    for (const [id, data] of dbCache.entries()) {
      const base64 = `data:image/webp;base64,${data.toString('base64')}`;
      this.cache.set(`${libraryId}-${id}`, size, base64);
      result.set(id, base64);
    }

    // 剩余的实时生成
    const stillNeedToLoad = needToLoad.filter(id => !dbCache.has(id));

    // 限制并发数量
    const batchSize = 10;
    for (let i = 0; i < stillNeedToLoad.length; i += batchSize) {
      const batch = stillNeedToLoad.slice(i, i + batchSize);
      const promises = batch.map(async (id) => {
        try {
          const thumbnail = await this.getThumbnail(libraryId, id, size);
          result.set(id, thumbnail);
        } catch (error) {
          console.error(`[ImageService] 加载缩略图失败：${id}`, error);
        }
      });
      await Promise.all(promises);
    }

    return result;
  }

  /**
   * 获取原图文件路径
   */
  getImagePath(libraryId: number, imageId: number): string {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    const image = db.getImage(imageId);
    
    if (!image) {
      throw new Error(`图片不存在：${imageId}`);
    }

    return path.join(library.rootPath, image.relative_path);
  }

  /**
   * 切换收藏状态
   */
  toggleFavorite(libraryId: number, imagePath: string, tags?: string[]): boolean {
    // 检查是否已收藏
    const favorites = this.masterDB.getFavorites();
    const exists = favorites.some(
      f => f.library_id === libraryId && f.image_path === imagePath
    );

    if (exists) {
      this.masterDB.removeFavorite(libraryId, imagePath);
      return false;
    } else {
      this.masterDB.addFavorite(libraryId, imagePath, tags);
      return true;
    }
  }

  /**
   * 获取所有收藏
   */
  getFavorites(): Array<{ library_id: number; image_path: string; tags: string[]; rating: number }> {
    return this.masterDB.getFavorites();
  }

  /**
   * 添加浏览历史
   */
  addHistory(libraryId: number, imagePath: string): void {
    this.masterDB.addHistory(libraryId, imagePath);
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    count: number;
    sizeMB: number;
    utilization: number;
  } {
    return this.cache.getStats();
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 清理服务
   */
  async cleanup(): Promise<void> {
    console.log('[ImageService] 清理...');
    closeAllDatabases();
    this.thumbnailsDBs.clear();
    this.scanners.clear();
    this.cache.clear();
    this.initialized = false;
  }
}

// 单例实例
let imageServiceInstance: ImageService | null = null;

/**
 * 获取图片服务实例
 */
export function getImageService(): ImageService {
  if (!imageServiceInstance) {
    imageServiceInstance = new ImageService();
  }
  return imageServiceInstance;
}
