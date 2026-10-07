/**
 * Phase 9 M5 · T21 — 索引增量计划（纯函数，零依赖，可脱离 electron/原生单测）。
 *
 * 输入本库可嵌入图片 + 已有干净向量的 id 集，输出「还缺该模型向量」的 id 列表；
 * 换模型时旧向量不在 indexed 集（按 model_id 过滤）→ 自然全部重嵌。
 */
import path from 'path'

export interface IndexableImage {
  id: number
  relativePath: string
}

/** 尚缺该模型干净向量的 image_id（保序） */
export function planPendingImages(images: readonly IndexableImage[], indexedIds: ReadonlySet<number>): number[] {
  const out: number[] = []
  for (const im of images) {
    if (!indexedIds.has(im.id)) out.push(im.id)
  }
  return out
}

/**
 * relative_path 历史可能用正斜杠入库（Windows 扫描为反斜杠），path.join 统一按平台分隔符归一。
 */
export function toAbsolutePath(rootPath: string, relativePath: string): string {
  return path.join(rootPath, relativePath)
}
