/**
 * 主进程媒体类型检测工具函数
 * 统一使用 src/types/index.ts 中定义的常量和类型
 */
import { MEDIA_EXTENSIONS, MIME_TYPES } from '../../types'
import type { MediaType } from '../../types'

// 预构建 Set 用于快速查找（带点前缀）
const VIDEO_EXT_SET = new Set<string>(MEDIA_EXTENSIONS.video)
const AUDIO_EXT_SET = new Set<string>(MEDIA_EXTENSIONS.audio)

/**
 * 根据文件路径判断媒体类型
 */
export function getMediaTypeFromPath(relativePath: string): MediaType {
  const dotIndex = relativePath.lastIndexOf('.')
  if (dotIndex === -1) return 'image'
  const ext = relativePath.slice(dotIndex).toLowerCase()
  if (VIDEO_EXT_SET.has(ext)) return 'video'
  if (AUDIO_EXT_SET.has(ext)) return 'audio'
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
