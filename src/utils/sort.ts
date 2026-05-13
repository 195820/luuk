/**
 * 图片排序工具函数
 *
 * 提供文件名自然排序、图片数组排序等功能
 * 支持文本 + 数字混合排序（如 "IMG_001.jpg" < "IMG_002.jpg"）
 */

// 从文件名中提取文本和数字部分用于排序（只提取文件名，不包含路径）
// 返回 { text: 文本部分，number: 数字部分（忽略前导零）}
export function extractTextAndNumber(str: string): { text: string; number: number } {
  // 先提取文件名（去掉路径）
  const fileName = str.replace(/^.*[\\/]/, '')

  // 移除扩展名
  const withoutExt = fileName.replace(/\.[^.]+$/, '')

  // 提取括号中的数字，如 "屏幕截图 (10).jpg" → 10
  const bracketMatch = withoutExt.match(/\((\d+)\)/)
  if (bracketMatch) {
    const text = withoutExt.replace(/\s*\(\d+\)/g, '').replace(/\d+/g, '')
    const num = parseInt(bracketMatch[1], 10)
    return { text, number: num }
  }

  // 提取最后一个数字序列及其前面的文本
  const lastNumberMatch = withoutExt.match(/^(.*?)(\d+)([^\d]*)$/)
  if (lastNumberMatch) {
    const [, prefix, numStr] = lastNumberMatch
    // 移除前缀中的数字，得到纯文本
    const text = prefix.replace(/\d+/g, '')
    const num = parseInt(numStr, 10)
    return { text, number: num }
  }

  // 没有数字，全部作为文本
  const text = withoutExt.replace(/\d+/g, '')
  return { text, number: 0 }
}

// 从文件名中提取纯文本部分（用于排序的第一关键字）
export function extractText(str: string): string {
  return extractTextAndNumber(str).text
}

// 从文件名中提取纯数字部分（用于排序的第二关键字，忽略前导零）
export function extractNumber(str: string): number {
  return extractTextAndNumber(str).number
}

// 通用排序辅助函数：比较两个字符串（文本 + 数字自然排序）
export function comparePathStrings(
  aPath: string,
  bPath: string,
  order: 'ASC' | 'DESC'
): number {
  const aVal = aPath || ''
  const bVal = bPath || ''

  if (order === 'ASC') {
    // 升序：先按文本部分排序，再按数字排序
    const aText = extractText(aVal)
    const bText = extractText(bVal)
    const textCompare = aText.localeCompare(bText, 'zh-CN', { sensitivity: 'base' })
    if (textCompare !== 0) return textCompare

    // 文本相同，按数字排序
    const aNum = extractNumber(aVal)
    const bNum = extractNumber(bVal)
    return aNum - bNum
  } else {
    // 降序：先按文本部分排序，再按数字排序
    const aText = extractText(aVal)
    const bText = extractText(bVal)
    const textCompare = aText.localeCompare(bText, 'zh-CN', { sensitivity: 'base' })
    if (textCompare !== 0) return bText.localeCompare(aText, 'zh-CN', { sensitivity: 'base' })

    // 文本相同，按数字降序排序
    const aNum = extractNumber(aVal)
    const bNum = extractNumber(bVal)
    return bNum - aNum
  }
}

/**
 * 排序辅助函数：对图片进行排序
 * 支持 Image 和 FavoriteImage 类型
 *
 * @param images 图片数组
 * @param sortBy 排序字段 ('relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height')
 * @param order 排序顺序 ('ASC' | 'DESC')
 * @returns 排序后的数组
 */
export function sortImages<T extends { relative_path?: string; file_size?: number; width?: number; height?: number }>(
  images: T[],
  sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height',
  order: 'ASC' | 'DESC'
): T[] {
  return [...images].sort((a, b) => {
    let aVal: any
    let bVal: any

    switch (sortBy) {
      case 'relative_path':
        aVal = a.relative_path || ''
        bVal = b.relative_path || ''
        break
      case 'file_size':
        aVal = a.file_size || 0
        bVal = b.file_size || 0
        break
      case 'width':
        aVal = a.width || 0
        bVal = b.width || 0
        break
      case 'height':
        aVal = a.height || 0
        bVal = b.height || 0
        break
      default:
        aVal = 0
        bVal = 0
    }

    if (typeof aVal === 'string') {
      return comparePathStrings(aVal, bVal, order)
    } else {
      return order === 'ASC' ? aVal - bVal : bVal - aVal
    }
  })
}

/**
 * 排序辅助函数：对收藏图片进行排序（保持向后兼容）
 *
 * @param images 收藏图片数组
 * @param sortBy 排序字段
 * @param order 排序顺序
 * @returns 排序后的数组
 */
export function sortFavoriteImages(
  images: any[],
  sortBy: 'relative_path' | 'created_time' | 'modified_time' | 'file_size' | 'width' | 'height',
  order: 'ASC' | 'DESC'
): any[] {
  return sortImages(images, sortBy, order)
}
