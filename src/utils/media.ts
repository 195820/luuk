/**
 * 媒体类型检测工具函数
 * 统一各处重复的扩展名集合和类型判断逻辑
 */
import { MEDIA_EXTENSIONS, MIME_TYPES } from '../types'
import type { MediaType } from '../types'

// 预构建 Set 用于快速查找（带点前缀）
const VIDEO_EXT_SET = new Set<string>(MEDIA_EXTENSIONS.video)
const AUDIO_EXT_SET = new Set<string>(MEDIA_EXTENSIONS.audio)
const IMAGE_EXT_SET = new Set<string>(MEDIA_EXTENSIONS.image)
const ALL_MEDIA_EXTS = new Set<string>([...VIDEO_EXT_SET, ...AUDIO_EXT_SET, ...IMAGE_EXT_SET])

/**
 * 从文件路径获取扩展名（小写，带点）
 * 如 "video.MP4" → ".mp4"
 */
export function getExtFromPath(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) return ''
  return filePath.slice(dotIndex).toLowerCase()
}

/**
 * 根据文件路径判断媒体类型
 * 优先使用扩展名，比数据库字段更可靠
 */
export function getMediaTypeFromPath(filePath: string): MediaType {
  const ext = getExtFromPath(filePath)
  if (VIDEO_EXT_SET.has(ext)) return 'video'
  if (AUDIO_EXT_SET.has(ext)) return 'audio'
  return 'image'
}

/**
 * 获取文件的 MIME 类型
 */
export function getMimeTypeFromPath(filePath: string): string {
  const ext = getExtFromPath(filePath)
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * 判断文件是否为媒体文件（图片/视频/音频）
 */
export function isMediaFile(filePath: string): boolean {
  return ALL_MEDIA_EXTS.has(getExtFromPath(filePath))
}

/**
 * 判断文件是否为视频
 */
export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXT_SET.has(getExtFromPath(filePath))
}

/**
 * 判断文件是否为音频
 */
export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXT_SET.has(getExtFromPath(filePath))
}

/**
 * 浏览器原生支持的视频格式（可直接用 <video> 播放）
 * mkv/avi/m4v 需要解码器支持，不保证可用
 */
const BROWSER_VIDEO_FORMATS = new Set(['.mp4', '.webm', '.mov'])

/**
 * 判断视频格式是否可被浏览器原生播放
 */
export function isBrowserPlayableVideo(filePath: string): boolean {
  return BROWSER_VIDEO_FORMATS.has(getExtFromPath(filePath))
}
