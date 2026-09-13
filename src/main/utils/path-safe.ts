import path from 'path'

/**
 * 判断 target 是否位于 root 目录内（含 root 自身）。
 * 基于 path.relative 的语义而非 startsWith，避免 `/lib` 误放行 `/lib-evil` 之类的前缀攻击。
 * Windows 下 path.relative 按大小写不敏感比较，与既有 toLowerCase 守卫保持一致。
 */
export function isPathWithin(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}