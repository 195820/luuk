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
  private scanningLibraries: Set<number> = new Set();

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

    // 恢复已注册的库
    const libraries = this.masterDB.getLibraries();
    for (const lib of libraries) {
      if (fs.existsSync(lib.rootPath)) {
        this.connectLibrary(lib.id);
        this.masterDB.updateLibraryStatus(lib.id, 'online', lib.imageCount);
      } else {
        // 路径不存在，标记为离线
        this.masterDB.updateLibraryStatus(lib.id, 'offline', lib.imageCount);
      }
    }

    this.initialized = true;
  }

  /**
   * 连接分库数据库
   */
  private connectLibrary(libraryId: number): ThumbnailsDB {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    // 使用 rootPath 作为 key，确保同一个路径只创建一个数据库实例
    if (!this.thumbnailsDBs.has(library.rootPath)) {
      const db = getThumbnailsDB(library.rootPath)
      this.thumbnailsDBs.set(library.rootPath, db)
      this.scanners.set(library.rootPath, new LibraryScanner(db, library.rootPath))
    }

    return this.thumbnailsDBs.get(library.rootPath)!
  }

  /**
   * 添加图片库
   */
  async addLibrary(options: AddLibraryOptions): Promise<Library> {
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

    // 自动扫描
    if (options.autoScan !== false) {
      // 异步扫描，扫描完成后更新状态
      this.scanLibrary(library.id)
        .then((result) => {
          this.masterDB.updateLibraryStatus(library.id, 'online', result.total);
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

    // 关闭并从全局单例中移除分库数据库
    closeThumbnailsDB(library.rootPath);
    this.thumbnailsDBs.delete(library.rootPath);
    this.scanners.delete(library.rootPath);

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
    if (this.scanningLibraries.has(libraryId)) {
      throw new Error(`库正在扫描中：${libraryId}`);
    }

    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    if (!fs.existsSync(library.rootPath)) {
      this.masterDB.updateLibraryStatus(libraryId, 'offline', 0);
      throw new Error(`库路径不存在：${library.rootPath}`);
    }

    this.scanningLibraries.add(libraryId);
    try {
      const db = this.connectLibrary(libraryId);
      const scanner = new LibraryScanner(db, library.rootPath);
      const result = await scanner.scan();
      this.masterDB.updateLibraryStatus(libraryId, 'online', result.total);
      return result;
    } finally {
      this.scanningLibraries.delete(libraryId);
    }
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
   * 获取文件夹树
   */
  getFolderTree(libraryId: number): Array<{ path: string; name: string; imageCount: number; children: any[]; depth: number }> {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    const folderTree = db.getFolderTree();

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
      return cached;
    }

    // ② 检查数据库缓存
    const thumbnailData = db.getThumbnail(imageId, size);
    if (thumbnailData) {
      const base64 = `data:image/webp;base64,${thumbnailData.toString('base64')}`;
      this.cache.set(cacheKey, size, base64);
      return base64;
    }

    // ③ 实时生成
    const image = db.getImage(imageId);
    if (!image) {
      // 图片元数据不存在，返回空字符串而不是抛出错误
      console.warn(`[ImageService] 图片元数据不存在：${imageId}`);
      return '';
    }

    const fullPath = path.join(library.rootPath, image.relative_path);

    if (!fs.existsSync(fullPath)) {
      // 图片文件不存在，返回空字符串而不是抛出错误
      console.warn(`[ImageService] 图片文件不存在：${fullPath}`);
      return '';
    }

    // 生成缩略图
    const thumbnail = await generateThumbnail(fullPath, size);

    // 保存到数据库
    const thumbMetadata = await getThumbnailer().getImageMetadata(fullPath);
    db.saveThumbnail(imageId, size, thumbnail, thumbMetadata.width, thumbMetadata.height);

    // 写入内存缓存
    const base64 = `data:image/webp;base64,${thumbnail.toString('base64')}`;
    this.cache.set(cacheKey, size, base64);

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

    const batchSize = 50;

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
   * 获取收藏库中的图片列表（虚拟库）
   */
  async getFavoriteImages(options: ImageQueryOptions): Promise<any[]> {
    const favoriteImages = this.masterDB.getFavoriteImages();

    // 分页
    const { limit, offset = 0 } = options;
    const paginated = favoriteImages.slice(offset, offset + limit);

    // 获取每张图片的详细信息
    const result = await Promise.all(paginated.map(async fav => {
      try {
        // 从原库获取图片详细信息
        const imageInfo = await this.getImageByRelativePath(fav.library_id, fav.image_path);
        return {
          id: imageInfo?.id || 0,
          library_id: fav.library_id,
          library_name: fav.library_name,
          relative_path: fav.image_path,
          width: imageInfo?.width || 0,
          height: imageInfo?.height || 0,
          file_size: imageInfo?.file_size || 0,
          format: imageInfo?.format || '',
          is_favorite: true,
          favorited_at: fav.created_at,
        };
      } catch (err) {
        console.error(`获取收藏图片详情失败：${fav.library_id}/${fav.image_path}`, err);
        return {
          id: 0,
          library_id: fav.library_id,
          library_name: fav.library_name,
          relative_path: fav.image_path,
          width: 0,
          height: 0,
          file_size: 0,
          format: '',
          is_favorite: true,
          favorited_at: fav.created_at,
        };
      }
    }));

    return result;
  }

  /**
   * 根据相对路径获取图片信息
   */
  async getImageByRelativePath(libraryId: number, relativePath: string): Promise<any> {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }

    const db = this.connectLibrary(libraryId);
    const image = db.getImageByRelativePath(relativePath);
    
    if (image) {
      return {
        ...image,
        library_id: libraryId,
        library_name: library.name,
      };
    }
    
    return null;
  }

  /**
   * 获取收藏库中的图片数量
   */
  getFavoriteImagesCount(): number {
    return this.masterDB.getFavoriteCount();
  }

  /**
   * 获取单图收藏（不属于任何收藏文件夹的图片）
   */
  async getSingleFavoriteImages(options: { limit: number; offset: number }): Promise<any[]> {
    const singleFavorites = this.masterDB.getSingleFavoriteImages();
    const { limit, offset } = options;

    // 分页
    const paginated = singleFavorites.slice(offset, offset + limit);

    // 获取每张图片的详细信息
    const images: any[] = [];
    for (const fav of paginated) {
      try {
        const library = this.masterDB.getLibrary(fav.library_id);
        if (library && library.status === 'online') {
          const db = this.connectLibrary(fav.library_id);
          const img = db.getImageByRelativePath(fav.image_path);
          if (img) {
            images.push({
              ...img,
              library_id: fav.library_id,
              library_name: fav.library_name,
              relative_path: fav.image_path,
              is_favorite: true,
              favorited_at: fav.created_at,
            });
          }
        }
      } catch (err) {
        console.error(`获取单图收藏详情失败：${fav.library_id}/${fav.image_path}`, err);
      }
    }

    return images;
  }

  /**
   * 获取单图收藏数量
   */
  getSingleFavoriteCount(): number {
    return this.masterDB.getSingleFavoriteCount();
  }

  // ==================== 收藏文件夹相关方法 ====================

  /**
   * 添加收藏文件夹
   */
  async addFavoriteFolder(libraryId: number, folderPath: string): Promise<void> {
    this.masterDB.addFavoriteFolder(libraryId, folderPath);
  }

  /**
   * 移除收藏文件夹
   */
  async removeFavoriteFolder(libraryId: number, folderPath: string): Promise<void> {
    this.masterDB.removeFavoriteFolder(libraryId, folderPath);
  }

  /**
   * 获取所有收藏的文件夹
   */
  getFavoriteFolders(): any[] {
    return this.masterDB.getFavoriteFolders();
  }

  /**
   * 获取收藏的文件夹树
   */
  getFavoriteFolderTree(): any[] {
    return this.masterDB.getFavoriteFolderTree();
  }

  /**
   * 检查文件夹是否已收藏
   */
  isFavoriteFolder(libraryId: number, folderPath: string): boolean {
    return this.masterDB.isFavoriteFolder(libraryId, folderPath);
  }

  /**
   * 获取收藏文件夹下的图片列表
   */
  async getFavoriteFolderImages(folderPath: string, options: { limit: number; offset: number }): Promise<any[]> {
    const favoriteFolders = this.masterDB.getFavoriteFolders();
    const allImages: any[] = [];
    
    for (const fav of favoriteFolders) {
      if (fav.folder_path === folderPath || fav.folder_path.startsWith(folderPath + '/')) {
        try {
          const library = this.masterDB.getLibrary(fav.library_id);
          if (library && library.status === 'online') {
            const db = this.connectLibrary(fav.library_id);
            const images = db.getImagesByFolder(fav.folder_path, { limit: options.limit, offset: 0 });
            allImages.push(...images.map(img => ({
              ...img,
              library_id: fav.library_id,
              library_name: fav.library_name,
            })));
          }
        } catch (err) {
          console.error(`获取收藏文件夹图片失败：${fav.library_id}/${fav.folder_path}`, err);
        }
      }
    }
    
    // 分页
    return allImages.slice(options.offset, options.offset + options.limit);
  }

  /**
   * 获取收藏文件夹下的图片总数
   */
  getFavoriteFolderImageCount(folderPath: string): number {
    const favoriteFolders = this.masterDB.getFavoriteFolders();
    let count = 0;
    
    for (const fav of favoriteFolders) {
      if (fav.folder_path === folderPath || fav.folder_path.startsWith(folderPath + '/')) {
        try {
          const library = this.masterDB.getLibrary(fav.library_id);
          if (library && library.status === 'online') {
            const db = this.connectLibrary(fav.library_id);
            count += db.getImagesCountByFolder(fav.folder_path);
          }
        } catch (err) {
          console.error(`获取收藏文件夹图片数量失败：${fav.library_id}/${fav.folder_path}`, err);
        }
      }
    }
    
    return count;
  }

  /**
   * 根据相对路径获取图片路径
   */
  async getImagePathByRelativePath(libraryId: number, relativePath: string): Promise<string> {
    const library = this.masterDB.getLibrary(libraryId);
    if (!library) {
      throw new Error(`库不存在：${libraryId}`);
    }
    return path.join(library.rootPath, relativePath);
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
    closeAllDatabases();
    this.thumbnailsDBs.clear();
    this.scanners.clear();
    this.scanningLibraries.clear();
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
