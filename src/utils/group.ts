/**
 * 图片分组工具（纯函数）
 */

export type GroupBy = 'none' | 'day' | 'month' | 'format' | 'aspect'

export interface GroupedImages<T> {
  key: string
  label: string
  items: T[]
}

type ImageLike = {
  created_time?: string
  format?: string
  width?: number
  height?: number
}

/**
 * 按指定字段对图片分组
 * - day：按 YYYY-MM-DD 分组（created_time）
 * - month：按 YYYY-MM 分组
 * - format：按格式大写分组
 * - aspect：横向（width >= height）或纵向
 * - none：单组（不分组）
 */
export function groupImages<T extends ImageLike>(
  images: T[],
  groupBy: GroupBy
): GroupedImages<T>[] {
  if (groupBy === 'none' || images.length === 0) {
    return [{ key: 'all', label: '全部', items: images }]
  }

  const groups = new Map<string, T[]>()

  for (const img of images) {
    const key = getGroupKey(img, groupBy)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(img)
  }

  const result: GroupedImages<T>[] = []
  for (const [key, items] of groups.entries()) {
    result.push({
      key,
      label: getGroupLabel(key, groupBy),
      items,
    })
  }

  // 排序：day/month 按 key 倒序（最新在前），其他按数量倒序
  if (groupBy === 'day' || groupBy === 'month') {
    result.sort((a, b) => b.key.localeCompare(a.key))
  } else {
    result.sort((a, b) => b.items.length - a.items.length)
  }

  return result
}

function getGroupKey<T extends ImageLike>(img: T, groupBy: GroupBy): string {
  switch (groupBy) {
    case 'day': {
      // 取 created_time 的 YYYY-MM-DD 部分
      const ct = img.created_time
      if (!ct) return 'unknown-date'
      return ct.slice(0, 10) // 'YYYY-MM-DD'
    }
    case 'month': {
      const ct = img.created_time
      if (!ct) return 'unknown-month'
      return ct.slice(0, 7) // 'YYYY-MM'
    }
    case 'format':
      return (img.format || 'unknown').toUpperCase()
    case 'aspect': {
      const w = img.width ?? 0
      const h = img.height ?? 0
      if (w === 0 && h === 0) return 'unknown-aspect'
      return w >= h ? 'landscape' : 'portrait'
    }
    default:
      return 'all'
  }
}

function getGroupLabel(key: string, groupBy: GroupBy): string {
  switch (groupBy) {
    case 'day':
      return key === 'unknown-date' ? '未知日期' : key
    case 'month':
      return key === 'unknown-month' ? '未知月份' : key
    case 'format':
      return key === 'UNKNOWN' ? '未知格式' : key
    case 'aspect':
      if (key === 'landscape') return '横向'
      if (key === 'portrait') return '纵向'
      return '未知比例'
    default:
      return '全部'
  }
}
