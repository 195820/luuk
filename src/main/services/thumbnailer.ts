import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { logger } from '../../utils/logger';
import { spawn, type ChildProcess } from 'child_process';
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

/** 存活的 ffmpeg 缩略图子进程（退出清理时统一 kill） */
const activeFfmpeg = new Set<ChildProcess>();

/** 强制终止所有存活 ffmpeg 子进程（应用退出清理用，幂等） */
export function killActiveFfmpeg(): void {
  for (const proc of activeFfmpeg) {
    try { proc.kill('SIGKILL'); } catch { /* 已退出 */ }
  }
  activeFfmpeg.clear();
}

// ─── P1-2: sharp 并发限制 + ffmpeg 信号量 ───
sharp.concurrency(Math.max(1, os.availableParallelism() - 2));

/** ffmpeg 全局并发信号量（≤ 2） */
const FFMPEG_MAX_CONCURRENCY = 2;
let ffmpegActive = 0;
const ffmpegWaiters: Array<() => void> = [];
async function acquireFfmpeg(): Promise<void> {
  if (ffmpegActive < FFMPEG_MAX_CONCURRENCY) { ffmpegActive++; return }
  await new Promise<void>(resolve => ffmpegWaiters.push(resolve))
  ffmpegActive++
}
function releaseFfmpeg(): void {
  ffmpegActive--
  const next = ffmpegWaiters.shift()
  if (next) next()
}

/** 应用退出前清理 tmpdir/luuk-thumb-* （由 main.ts before-quit 调用） */
export function cleanupThumbnailTempDirs(): void {
  const tmpdir = os.tmpdir()
  try {
    const entries = fs.readdirSync(tmpdir)
    for (const name of entries) {
      if (name.startsWith('luuk-thumb-')) {
        try { fs.rmSync(path.join(tmpdir, name), { recursive: true, force: true }) } catch {}
      }
    }
  } catch {}
}

/**
 * 缩略图配置
 */
export interface ThumbnailConfig {
  small: number;    // 120px
  medium: number;   // 300px
  large: number;    // 600px
  preview: number;  // 1200px (灯箱渐进加载)
  quality: number;  // WebP 质量 (默认 85)
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ThumbnailConfig = {
  small: 120,
  medium: 300,
  large: 600,
  preview: 1200,
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
      const image = sharp(imagePath, { failOn: 'none' });

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
      const thumbMetadata = await sharp(thumbnailBuffer, { failOn: 'none' }).metadata();

      return {
        data: thumbnailBuffer,
        width: thumbMetadata.width || targetSize,
        height: thumbMetadata.height || targetSize,
        format: 'webp'
      };
    } catch (error) {
      logger.error('Thumbnailer', '生成缩略图失败', imagePath, error);
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
        logger.warn('Thumbnailer', `生成 ${size} 缩略图失败`, error);
      }
    }

    return results;
  }

  /**
   * 生成预览图（较大尺寸，用于快速预览）
   */
  async generatePreview(imagePath: string, maxSize: number = 1200): Promise<ThumbnailResult> {
    try {
      const pipeline = sharp(imagePath, { failOn: 'none' })
        .rotate()
        .resize(maxSize, maxSize, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: 90 });

      const previewBuffer = await pipeline.toBuffer();
      const metadata = await sharp(previewBuffer, { failOn: 'none' }).metadata();

      return {
        data: previewBuffer,
        width: metadata.width || maxSize,
        height: metadata.height || maxSize,
        format: 'webp'
      };
    } catch (error) {
      logger.error('Thumbnailer', '生成预览图失败', imagePath, error);
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
    const sharpImage = sharp(imagePath, { failOn: 'none' });
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
 * 生成视频缩略图（截取第 1 秒帧，受 ffmpeg 并发信号量限制）
 */
export async function generateVideoThumbnail(videoPath: string): Promise<Buffer> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频文件不存在：${videoPath}`);
  }
  const fileExt = videoPath.slice(videoPath.lastIndexOf('.')).toLowerCase();
  if (fileExt === '.avi' || fileExt === '.mkv') {
    return Buffer.alloc(0);
  }

  await acquireFfmpeg();
  try {
    return await _doFfmpegThumbnail(videoPath);
  } finally {
    releaseFfmpeg();
  }
}

/** 内部实现：单次 ffmpeg 截取 + sharp 转换 */
function _doFfmpegThumbnail(videoPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-thumb-'));
    const tmpPath = path.join(tmpDir, 'frame.png');

    // ffmpeg 路径解析
    const rawFfmpegPath = process.env.FFMPEG_PATH;
    let ffmpegPath: string;
    if (rawFfmpegPath) {
      const resolved = path.resolve(rawFfmpegPath);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        ffmpegPath = resolved;
      } else {
        logger.warn('Thumbnailer', `FFMPEG_PATH 无效（${rawFfmpegPath}），回退到 ffmpeg-static`);
        ffmpegPath = FFMPEG_STATIC;
      }
    } else {
      ffmpegPath = FFMPEG_STATIC;
    }

    const args = [
      '-y',
      '-ss', '00:00:00',
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      '-t', '2',
      tmpPath,
    ];

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeFfmpeg.add(proc);

    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      safeRemoveDir(tmpDir);
      reject(new Error('ffmpeg 生成缩略图超时（30秒）'));
    }, 30_000);

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', async (code: number) => {
      clearTimeout(timeout);
      activeFfmpeg.delete(proc);
      if (code !== 0 && code !== null) {
        logger.warn('Thumbnailer', `ffmpeg exited with code ${code}`, stderr.slice(0, 500));
      }

      // ── 等待文件句柄释放（轮询替代固定 sleep） ──
      const fileReady = await pollFileStable(tmpPath, 50, 2000);
      if (!fileReady) {
        safeRemoveDir(tmpDir);
        reject(new Error(`ffmpeg 未能生成缩略图 (code=${code})`));
        return;
      }

      try {
        const webpData = await sharp(tmpPath, { failOn: 'none' })
          .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();

        // 成功路径：立即尝试删除，失败则重试
        safeRemoveDir(tmpDir, 5, 100);
        resolve(webpData);
      } catch (err) {
        safeRemoveDir(tmpDir, 5, 100);
        reject(err);
      }
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timeout);
      activeFfmpeg.delete(proc);
      safeRemoveDir(tmpDir);
      reject(err);
    });
  });
}

/** 轮询文件存在 + size 稳定（两次连续 stat.size 相同则认为稳定） */
async function pollFileStable(filePath: string, intervalMs: number, maxWaitMs: number): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      try {
        const sz = fs.statSync(filePath).size;
        if (sz > 0 && sz === lastSize) return true; // 连续两次相同且非空
        lastSize = sz;
      } catch { /* ignore transient stat errors */ }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  // 超时回退：检查存在性
  return fs.existsSync(filePath);
}

/** rmSync 重试包装（Windows 句柄占用场景） */
function safeRemoveDir(dir: string, retries = 1, delayMs = 0): void {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      if (i < retries - 1 && delayMs > 0) {
        const waitUntil = Date.now() + delayMs;
        while (Date.now() < waitUntil) { /* busy wait for sync context */ }
      }
    }
  }
  logger.warn('Thumbnailer', `无法删除临时目录: ${dir}`);
}
