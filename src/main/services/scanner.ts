import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { BrowserWindow } from 'electron';
import { ThumbnailsDB } from './database';
import { getImageMetadata } from './thumbnailer';

/**
 * 扫描结果
 */
export interface ScanResult {
  added: number;      // 新增图片数
  updated: number;    // 更新图片数
  deleted: number;    // 删除图片数
  skipped: number;    // 跳过（未变化）数
  total: number;      // 总图片数
}

/**
 * 扫描选项
 */
export interface ScanOptions {
  incremental?: boolean;  // 是否增量扫描
  extensions?: string[];  // 支持的文件扩展名
}

/**
 * 支持的文件扩展名
 */
const DEFAULT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];

/**
 * 文件扫描服务
 */
export class LibraryScanner {
  private db: ThumbnailsDB;
  private libraryPath: string;
  private extensions: string[];

  constructor(db: ThumbnailsDB, libraryPath: string, options?: ScanOptions) {
    this.db = db;
    this.libraryPath = libraryPath;
    this.extensions = (options?.extensions || DEFAULT_EXTENSIONS).map(ext =>
      ext.toLowerCase()
    );
  }

  /**
   * 发送进度更新到渲染进程
   */
  private sendProgress(processedCount: number, totalCount: number, currentFile: string): void {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send('scan-progress', {
        isScanning: true,
        processedCount,
        totalCount,
        currentFile,
        status: 'scanning'
      });
    }
  }

  /**
   * 发送完成状态
   */
  private sendComplete(): void {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send('scan-progress', {
        isScanning: false,
        processedCount: 0,
        totalCount: 0,
        currentFile: '',
        status: 'complete'
      });
    }
  }

  /**
   * 扫描库
   */
  async scan(): Promise<ScanResult> {
    const result: ScanResult = {
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      total: 0
    };

    console.log(`[Scanner] 开始扫描：${this.libraryPath}`);
    const startTime = Date.now();

    // ========== 测试 1.1 添加库 - 扫描速度记录 ==========
    console.log(`[TEST-1.1] 扫描开始时间：${new Date().toISOString()}`);
    // ==================================================

    // 获取数据库中已有的路径
    const existingPaths = new Set(this.db.getAllPaths());
    const scannedPaths = new Set<string>();

    // 递归扫描所有图片文件
    const imageFiles = await this.scanDirectory(this.libraryPath);

    result.total = imageFiles.length;

    // 发送开始进度
    this.sendProgress(0, result.total, '');

    // ========== 测试 1.1 添加库 - 目录扫描完成 ==========
    console.log(`[TEST-1.1] 目录扫描完成，发现 ${result.total} 张图片`);
    // ==================================================

    // ========== 测试 2.4 增量扫描记录 ==========
    const isIncremental = existingPaths.size > 0;
    if (isIncremental) {
      console.log(`[TEST-2.4] 增量扫描：数据库中已有 ${existingPaths.size} 张图片`);
    } else {
      console.log(`[TEST-2.4] 首次扫描：数据库为空`);
    }
    // ===========================================

    // 处理每个文件
    for (const filePath of imageFiles) {
      const relativePath = path.relative(this.libraryPath, filePath);
      scannedPaths.add(relativePath);

      // 发送进度更新（每 50 张发送一次）
      const processedCount = imageFiles.indexOf(filePath) + 1;
      if (processedCount % 50 === 0 || processedCount === result.total) {
        this.sendProgress(processedCount, result.total, relativePath);
      }

      try {
        const stat = fs.statSync(filePath);
        const modifiedTime = stat.mtime.toISOString();

        // 检查文件是否已存在
        if (existingPaths.has(relativePath)) {
          // 文件已存在，检查是否需要更新
          const existingImage = this.db.getImageByPath(relativePath);

          if (existingImage && existingImage.modified_time === modifiedTime) {
            // 文件未变化，跳过
            result.skipped++;
            continue;
          }

          // 文件已修改，更新记录
          const metadata = await getImageMetadata(filePath);
          const fileHash = await this.calculateFileHash(filePath);

          this.db.updateImage(existingImage!.id, {
            file_hash: fileHash,
            width: metadata.width,
            height: metadata.height,
            file_size: metadata.size,
            modified_time: modifiedTime
          });

          result.updated++;
        } else {
          // 新文件，插入记录
          const metadata = await getImageMetadata(filePath);
          const fileHash = await this.calculateFileHash(filePath);

          this.db.addImage({
            relative_path: relativePath,
            file_hash: fileHash,
            width: metadata.width,
            height: metadata.height,
            file_size: metadata.size,
            format: metadata.format.toUpperCase(),
            modified_time: modifiedTime
          });

          result.added++;
        }
      } catch (error) {
        console.error(`[Scanner] 处理文件失败：${filePath}`, error);
      }
    }

    // 检测已删除的文件
    for (const existingPath of existingPaths) {
      if (!scannedPaths.has(existingPath)) {
        this.db.markAsDeleted(existingPath);
        result.deleted++;
      }
    }

    // 清理已删除的记录
    const cleaned = this.db.cleanupDeleted();
    result.deleted = cleaned;

    const duration = Date.now() - startTime;
    console.log(
      `[Scanner] 扫描完成：${duration}ms, ` +
      `新增=${result.added}, 更新=${result.updated}, ` +
      `删除=${result.deleted}, 跳过=${result.skipped}`
    );

    // 发送完成状态
    this.sendComplete();

    return result;
  }

  /**
   * 递归扫描目录
   */
  private async scanDirectory(dir: string, files: string[] = []): Promise<string[]> {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // 跳过隐藏目录和特殊目录
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, files);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (this.extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`[Scanner] 扫描目录失败：${dir}`, error);
    }

    return files;
  }

  /**
   * 计算文件 Hash (用于去重)
   * 只计算前 1MB 用于快速比较
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath, { start: 0, end: 1024 * 1024 });

      stream.on('data', (data: string | Buffer) => {
        hash.update(data);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 获取库中的图片总数
   */
  getImageCount(): number {
    return this.db.getImageCount();
  }

  /**
   * 获取图片列表
   */
  getImages(limit: number = 100, offset: number = 0) {
    return this.db.getImages({ limit, offset });
  }
}

/**
 * 创建扫描器实例
 */
export function createScanner(db: ThumbnailsDB, libraryPath: string): LibraryScanner {
  return new LibraryScanner(db, libraryPath);
}
