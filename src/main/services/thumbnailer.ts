import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import type { ThumbnailSize } from '../../types';

// 延迟初始化 ffmpeg（避免 ES module 顶层 __dirname 问题）
let ffmpegInstance: any = null;
let ffmpegInitialized = false;

function getFfmpeg(): any {
  if (!ffmpegInitialized) {
    const req = createRequire(import.meta.url);
    const url = req('url');
    (globalThis as any).__dirname = path.dirname(url.fileURLToPath(import.meta.url));

    const fluentFfmpeg = req('fluent-ffmpeg');
    const ffmpegStatic = req('ffmpeg-static');
    fluentFfmpeg.setFfmpegPath(ffmpegStatic);
    ffmpegInstance = fluentFfmpeg;
    ffmpegInitialized = true;
  }
  return ffmpegInstance;
}

// ES module 兼容的 require
const req = createRequire(import.meta.url);
const FFMPEG_STATIC = req('ffmpeg-static');

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

/**
 * 获取视频元数据（时长、编码、分辨率）
 */
export function getVideoMetadata(videoPath: string): Promise<{
  duration: number;
  codec: string;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    getFfmpeg().ffprobe(videoPath, (err: Error | null, metadata: any) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
      const audioStream = metadata.streams.find((s: any) => s.codec_type === 'audio');

      if (!videoStream) {
        reject(new Error('未找到视频流'));
        return;
      }

      const duration = metadata.format.duration || 0;
      const codec = videoStream.codec_name || 'unknown';
      const width = videoStream.width || 0;
      const height = videoStream.height || 0;

      // 如果有音频，附加编码信息
      const codecInfo = audioStream
        ? `${codec}+${audioStream.codec_name}`
        : codec;

      resolve({
        duration,
        codec: codecInfo,
        width,
        height,
      });
    });
  });
}

/**
 * 获取音频元数据（时长）
 */
export function getAudioMetadata(audioPath: string): Promise<{
  duration: number;
  codec: string;
}> {
  return new Promise((resolve, reject) => {
    getFfmpeg().ffprobe(audioPath, (err: Error | null, metadata: any) => {
      if (err) {
        reject(err);
        return;
      }

      const audioStream = metadata.streams.find((s: any) => s.codec_type === 'audio');
      const duration = metadata.format.duration || 0;
      const codec = audioStream?.codec_name || 'unknown';

      resolve({ duration, codec });
    });
  });
}

/**
 * 生成视频缩略图（截取第 1 秒帧）
 */
export function generateVideoThumbnail(videoPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(videoPath)) {
      reject(new Error(`视频文件不存在：${videoPath}`));
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-thumb-'));
    const tmpPath = path.join(tmpDir, 'frame.png');

    // 使用系统 ffmpeg 命令（如果可用），否则用 ffmpeg-static
    const ffmpegPath = process.env.FFMPEG_PATH || FFMPEG_STATIC;

    const args = [
      '-y',
      '-ss', '00:00:01',
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      tmpPath,
    ];

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', async (code: number) => {
      if (code !== 0 && code !== null) {
        console.warn(`[Thumbnailer] ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`);
      }

      // 等待文件句柄释放
      await new Promise(r => setTimeout(r, 300));

      if (!fs.existsSync(tmpPath)) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        reject(new Error(`ffmpeg 未能生成缩略图 (code=${code})`));
        return;
      }

      try {
        const webpData = await sharp(tmpPath)
          .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();

        // 等待 sharp 释放文件句柄
        await new Promise(r => setTimeout(r, 200));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        resolve(webpData);
      } catch (err) {
        await new Promise(r => setTimeout(r, 200));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        reject(err);
      }
    });

    proc.on('error', (err: Error) => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      reject(err);
    });
  });
}
