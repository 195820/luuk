/**
 * 格式化工具函数
 */

/**
 * 格式化文件大小为人类可读格式
 * @param bytes 文件大小（字节）
 * @param precision 小数位数，默认 2
 * @returns 格式化后的字符串，如 "1.23 MB"
 */
export function formatFileSize(bytes: number | undefined | null, precision: number = 2): string {
  if (!bytes || bytes === 0) return ''
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(precision)) + ' ' + sizes[i]
}
