/**
 * 主进程媒体类型检测工具函数
 * 与 src/utils/media.ts 保持逻辑一致，但独立于前端代码
 */

// 支持的媒体扩展名（带点前缀，小写）
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'])

// 扩展名到 MIME 类型的映射
export const MIME_TYPES: Record<string, string> = {
  // 图片
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.tiff': 'image/tiff', '.tif': 'image/tiff', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.avif': 'image/avif',
  // 视频
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
  // 音频
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
}

/**
 * 根据文件路径判断媒体类型
 */
export function getMediaTypeFromPath(relativePath: string): 'image' | 'video' | 'audio' {
  const dotIndex = relativePath.lastIndexOf('.')
  if (dotIndex === -1) return 'image'
  const ext = relativePath.slice(dotIndex).toLowerCase()
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  return 'image'
}

/**
 * 获取文件的 MIME 类型
 */
export function getMimeTypeFromPath(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) return 'application/octet-stream'
  const ext = filePath.slice(dotIndex).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}
