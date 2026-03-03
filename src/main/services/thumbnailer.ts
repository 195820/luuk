import sharp from 'sharp';
import fs from 'fs';
import type { ThumbnailSize } from '../../types';

/**
 * 缩略图配置
 */
export interface ThumbnailConfig {
  small: number;    // 120px
  medium: number;   // 300px
  large: number;    // 600px
  quality: number;  // WebP 质量 (默认 85)
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ThumbnailConfig = {
  small: 120,
  medium: 300,
  large: 600,
  quality: 85
};

/**
 * 缩略图生成选项
 */
export interface GenerateThumbnailOptions {
  size: ThumbnailSize;
  width: number;
  height: number;
  quality?: number;
}

/**
 * 缩略图结果
 */
export interface ThumbnailResult {
  data: Buffer;
  width: number;
  height: number;
  format: string;
}

/**
 * 缩略图生成服务
 */
export class ThumbnailerService {
  private config: ThumbnailConfig;

  constructor(config?: Partial<ThumbnailConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成缩略图
   */
  async generateThumbnail(
    imagePath: string,
    size: ThumbnailSize = 'medium'
  ): Promise<ThumbnailResult> {
    const targetSize = this.config[size];

    try {
      // 检查文件是否存在
      if (!fs.existsSync(imagePath)) {
        throw new Error(`图片文件不存在：${imagePath}`);
      }

      // 使用 sharp 处理图片
      const image = sharp(imagePath);

      // 根据 EXIF 自动旋转
      let pipeline = image.rotate();

      // 缩放到目标尺寸
      pipeline = pipeline.resize(targetSize, targetSize, {
        fit: 'inside',           // 保持比例内切
        withoutEnlargement: true // 不放大
      });

      // 转换为 WebP 格式
      const thumbnailBuffer = await pipeline
        .webp({ quality: this.config.quality })
        .toBuffer();

      // 获取生成后的尺寸
      const thumbMetadata = await sharp(thumbnailBuffer).metadata();

      return {
        data: thumbnailBuffer,
        width: thumbMetadata.width || targetSize,
        height: thumbMetadata.height || targetSize,
        format: 'webp'
      };
    } catch (error) {
      console.error(`[Thumbnailer] 生成缩略图失败：${imagePath}`, error);
      throw error;
    }
  }

  /**
   * 批量生成缩略图
   */
  async generateThumbnails(
    imagePath: string,
    sizes: ThumbnailSize[] = ['small', 'medium']
  ): Promise<Map<ThumbnailSize, ThumbnailResult>> {
    const results = new Map<ThumbnailSize, ThumbnailResult>();

    for (const size of sizes) {
      try {
        const result = await this.generateThumbnail(imagePath, size);
        results.set(size, result);
      } catch (error) {
        console.warn(`[Thumbnailer] 生成 ${size} 缩略图失败:`, error);
      }
    }

    return results;
  }

  /**
   * 生成预览图（较大尺寸，用于快速预览）
   */
  async generatePreview(imagePath: string, maxSize: number = 1200): Promise<ThumbnailResult> {
    try {
      const pipeline = sharp(imagePath)
        .rotate()
        .resize(maxSize, maxSize, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: 90 });

      const previewBuffer = await pipeline.toBuffer();
      const metadata = await sharp(previewBuffer).metadata();

      return {
        data: previewBuffer,
        width: metadata.width || maxSize,
        height: metadata.height || maxSize,
        format: 'webp'
      };
    } catch (error) {
      console.error(`[Thumbnailer] 生成预览图失败：${imagePath}`, error);
      throw error;
    }
  }

  /**
   * 获取图片元数据
   */
  async getImageMetadata(imagePath: string): Promise<{
    width: number;
    height: number;
    format: string;
    size: number;
    orientation?: number;
  }> {
    const sharpImage = sharp(imagePath);
    const metadata = await sharpImage.metadata();
    const stat = fs.statSync(imagePath);

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: stat.size,
      orientation: metadata.orientation
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ThumbnailConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ThumbnailConfig {
    return this.config;
  }
}

// 单例实例
let thumbnailerInstance: ThumbnailerService | null = null;

/**
 * 获取缩略图服务实例
 */
export function getThumbnailer(): ThumbnailerService {
  if (!thumbnailerInstance) {
    thumbnailerInstance = new ThumbnailerService();
  }
  return thumbnailerInstance;
}

/**
 * 生成缩略图（便捷函数）
 */
export async function generateThumbnail(
  imagePath: string,
  size: ThumbnailSize = 'medium'
): Promise<Buffer> {
  const thumbnailer = getThumbnailer();
  const result = await thumbnailer.generateThumbnail(imagePath, size);
  return result.data;
}

/**
 * 获取图片元数据（便捷函数）
 */
export async function getImageMetadata(imagePath: string): Promise<{
  width: number;
  height: number;
  format: string;
  size: number;
}> {
  const thumbnailer = getThumbnailer();
  return thumbnailer.getImageMetadata(imagePath);
}
