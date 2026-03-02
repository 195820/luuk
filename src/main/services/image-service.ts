import path from 'path';
import fs from 'fs';
import { 
  MasterDB, 
  ThumbnailsDB, 
  getMasterDB, 
  getThumbnailsDB,
  closeThumbnailsDB,
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

    console.log(`[ImageService] connectLibrary: libraryId=${libraryId}, rootPath=${library.rootPath}`)

    // 使用 rootPath 作为 key，确保同一个路径只创建一个数据库实例
    if (!this.thumbnailsDBs.has(library.rootPath)) {
      console.log(`[ImageService] connectLibrary: 创建新的 ThumbnailsDB 实例`)
      const db = getThumbnailsDB(library.rootPath)
      this.thumbnailsDBs.set(library.rootPath, db)
      this.scanners.set(library.rootPath, new LibraryScanner(db, library.rootPath))
    } else {
      console.log(`[ImageService] connectLibrary: 使用已存在的 ThumbnailsDB 实例`)
    }

    return this.thumbnailsDBs.get(library.rootPath)!
  }

  /**
   * 添加图片库
   */
  async addLibrary(options: AddLibraryOptions): Promise<Library> {
    // ========== 测试 1.1 添加库 - 总耗时记录 ==========
    console.log(`[TEST-1.1] 添加库开始时间：${new Date().toISOString()}`);
    console.log(`[TEST-1.1] 库路径：${options.rootPath}`);
    // ==================================================

    // 验证路径
    if (!fs.existsSync(options.rootPath)) {
      throw new Error(`目录不存在：${options.rootPath}`);
    }

    // 规范化路径（处理大小写、斜杠等）
    const normalizedPath = path.normalize(options.rootPath);

    // 检查是否与现有库冲突
    const existingLibraries = this.masterDB.getLibraries();
    for (const lib of existingLibraries) {
      const existingPath = path.normalize(lib.rootPath);

      // 检查是否是现有库的子文件夹
      const relativePath = path.relative(existingPath, normalizedPath);
      if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        throw new Error(`无法在已存在库 "${lib.name}" 的子文件夹中创建新库`);
      }

      // 检查是否是现有库的父文件夹（即现有库是新库的子文件夹）
      const existingRelativePath = path.relative(normalizedPath, existingPath);
      if (existingRelativePath && !existingRelativePath.startsWith('..') && !path.isAbsolute(existingRelativePath)) {
        throw new Error(`无法创建库：该文件夹包含已存在的库 "${lib.name}"`);
      }

      // 检查路径是否完全相同
      if (normalizedPath === existingPath) {
        throw new Error(`库已存在：${options.rootPath}`);
      }
    }

    // 添加到主数据库
    const library = this.masterDB.addLibrary(options.name, options.rootPath);

    // 连接分库
    this.connectLibrary(library.id);

    console.log(`[TEST-1.1] 库已创建，ID=${library.id}, 名称=${library.name}`);

    // 自动扫描
    if (options.autoScan !== false) {
      // 异步扫描，扫描完成后更新状态
      console.log(`[TEST-1.1] 开始自动扫描...`);
      this.scanLibrary(library.id)
        .then((result) => {
          // 扫描完成后更新库状态为在线
          this.masterDB.updateLibraryStatus(library.id, 'online', result.total);
          console.log(`[TEST-1.1] 扫描完成，库状态已更新为在线，图片总数：${result.total}`);
        })
        .catch(console.error);
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

    // ========== 测试 2.1 删除库记录 ==========
    console.log(`[TEST-2.1] 删除库开始：ID=${libraryId}, 名称=${library.name}, 路径=${library.rootPath}`);
    const deleteStartTime = Date.now();
    // =========================================

    // 关闭并从全局单例中移除分库数据库
    closeThumbnailsDB(library.rootPath);
    this.thumbnailsDBs.delete(library.rootPath);
    this.scanners.delete(library.rootPath);

    // 从主数据库删除
    this.masterDB.removeLibrary(libraryId);

    // ========== 测试 2.1 删除库记录 ==========
    const deleteDuration = Date.now() - deleteStartTime;
    console.log(`[TEST-2.1] 删除库完成：耗时 ${deleteDuration}ms`);
    // =========================================
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
      console.error(`[ImageService] getImages: 库不存在 libraryId=${libraryId}`)
      throw new Error(`库不存在：${libraryId}`);
    }

    console.log(`[ImageService] getImages: libraryId=${libraryId}, rootPath=${library.rootPath}`)
    
    const db = this.connectLibrary(libraryId);
    const images = db.getImages(options);

    console.log(`[ImageService] getImages: 返回 ${images.length} 张图片`)

    // 附加库信息
    return images.map(img => ({
      ...img,
      library_id: libraryId,
      library_name: library.name
    }));
  }

  /**
   * 获取文件夹树
   */
  getFolderTree(libraryId: number): Array<{ path: string; name: string; imageCount: number; children: any[]; depth: number }> {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      console.error(`[ImageService] getFolderTree: 库不存在 libraryId=${libraryId}`)
      throw new Error(`库不存在：${libraryId}`);
    }

    console.log(`[ImageService] getFolderTree: libraryId=${libraryId}, rootPath=${library.rootPath}`)

    const db = this.connectLibrary(libraryId);
    const folderTree = db.getFolderTree();
    
    console.log(`[ImageService] getFolderTree: 返回 ${folderTree.length} 个节点`)
    
    return folderTree;
  }

  /**
   * 获取指定文件夹下的图片列表
   */
  getImagesByFolder(
    libraryId: number,
    folderPath: string | null,
    options: ImageQueryOptions
  ): any[] {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    const images = db.getImagesByFolder(folderPath, options);

    // 附加库信息
    return images.map(img => ({
      ...img,
      library_id: libraryId,
      library_name: library.name
    }));
  }

  /**
   * 获取指定文件夹下的图片总数
   */
  getImageCountByFolder(libraryId: number, folderPath: string | null): number {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    return db.getImagesCountByFolder(folderPath);
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
    const cacheKey = `${libraryId}-${imageId}`;
    const cached = this.cache.get(cacheKey, size);
    if (cached) {
      console.log(`[ImageService] getThumbnail: 内存缓存命中 ${cacheKey}:${size}`);
      return cached;
    }

    // ② 检查数据库缓存
    const thumbnailData = db.getThumbnail(imageId, size);
    if (thumbnailData) {
      console.log(`[ImageService] getThumbnail: 数据库缓存命中 ${imageId}:${size}`);
      const base64 = `data:image/webp;base64,${thumbnailData.toString('base64')}`;
      this.cache.set(cacheKey, size, base64);
      return base64;
    }

    console.log(`[ImageService] getThumbnail: 缓存未命中，开始生成 ${imageId}:${size}`);
    
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
    this.cache.set(cacheKey, size, base64);

    console.log(`[ImageService] getThumbnail: 生成完成 ${imageId}:${size}`);
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
      const cacheKey = `${libraryId}-${id}`;
      const cached = this.cache.get(cacheKey, size);
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
      const cacheKey = `${libraryId}-${id}`;
      const base64 = `data:image/webp;base64,${data.toString('base64')}`;
      this.cache.set(cacheKey, size, base64);
      result.set(id, base64);
    }

    // 剩余的实时生成
    const stillNeedToLoad = needToLoad.filter(id => !dbCache.has(id));

    // ========== 优化：增加并发数到 50 ==========
    const batchSize = 50;  // 原为 10
    console.log(`[ImageService] getThumbnails: 需要生成 ${stillNeedToLoad.length} 张缩略图，并发数=${batchSize}`);
    
    for (let i = 0; i < stillNeedToLoad.length; i += batchSize) {
      const batch = stillNeedToLoad.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      const promises = batch.map(async (id) => {
        try {
          const thumbnail = await this.getThumbnail(libraryId, id, size);
          result.set(id, thumbnail);
        } catch (error) {
          console.error(`[ImageService] 加载缩略图失败：${id}`, error);
        }
      });
      await Promise.all(promises);
      
      const batchDuration = Date.now() - batchStartTime;
      console.log(`[ImageService] getThumbnails: 批次 ${i / batchSize + 1} 完成，${batch.length}张，耗时 ${batchDuration}ms`);
    }
    // =========================================

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
