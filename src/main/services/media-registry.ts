/**
 * media:// 协议 URL 令牌注册表
 *
 * 确定性 HMAC token：同一资源在同会话内产生相同 URL，浏览器可命中 HTTP 缓存；
 * 密钥 sessionSecret 每次启动随机生成，外部无法离线推算 token，保留能力 URL 安全属性。
 *
 * 支持两种资源类型：
 *   - kind:'file'  原图/视频/音频（filePath 解析）
 *   - kind:'thumb' 缩略图（libraryId/imageId/size 解析，协议层调用 getThumbnailBytes）
 */
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

// ─── Types ─────────────────────────────────────────────────────────────
export interface FileEntry {
  kind: 'file'
  filePath: string
  createdAt: number
}
export interface ThumbEntry {
  kind: 'thumb'
  libraryId: number
  imageId: number
  size: string
  createdAt: number
}
export type RegistryEntry = FileEntry | ThumbEntry

// ─── Session secret (process-level, regenerated each startup) ─────────
const sessionSecret = crypto.randomBytes(32)

// ─── Registry storage ──────────────────────────────────────────────────
// 说明（P2-1 registry 打磨）：确定性 token 为 HMAC-SHA1（单向），无法由 token 反推资源标识，
// 故 registry Map 是 token→条目 的唯一事实源，**不支持按需重建**。
// 缓解"在用 URL 被逐出→404"：resolveMediaEntry 命中即续期 + 重排到尾部（访问驱动 LRU），
// 并放宽容量/TTL，使一次大会话（10k 图 × {thumb,file} 双维度）不触顶。
const registry = new Map<string, RegistryEntry>()
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2 小时过期（访问命中即续期）
const MAX_REGISTRY_SIZE = 50000

// ─── Token computation ─────────────────────────────────────────────────
function computeToken(identifier: string): string {
  return crypto.createHmac('sha1', sessionSecret).update(identifier).digest('hex').slice(0, 32)
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * 注册文件资源，返回 media:// URL（确定性：同路径+同 mtime+同 size → 同 token）
 */
export function registerMediaUrl(filePath: string): string {
  const resolved = path.resolve(filePath)
  let identifier: string
  try {
    const stat = fs.statSync(resolved)
    identifier = `${resolved}|${stat.mtimeMs}|${stat.size}`
  } catch {
    // 文件不存在或无权限——回退到纯路径（token 仍可注册但不可预测；调用方已做存在性检查）
    identifier = resolved
  }
  const token = computeToken(identifier)
  registry.set(token, { kind: 'file', filePath: resolved, createdAt: Date.now() })
  return `media://${token}`
}

/**
 * 注册缩略图资源，返回 media:// URL
 * @param version 内容版本标识（可用数据 sha1 前 8 位或 DB generated_at 时间戳）
 *                同一资源 + 同一版本 → 同一 URL，保证浏览器缓存稳定
 */
export function registerThumbUrl(
  libraryId: number, imageId: number, size: string, version: string | number
): string {
  const identifier = `thumb|${libraryId}|${imageId}|${size}|${version}`
  const token = computeToken(identifier)
  registry.set(token, { kind: 'thumb', libraryId, imageId, size, createdAt: Date.now() })
  return `media://${token}`
}

/**
 * 解析 token 为注册条目（协议处理器用）
 * 返回 undefined 表示 token 无效或已过期
 */
export function resolveMediaEntry(token: string): RegistryEntry | undefined {
  const entry = registry.get(token)
  if (!entry) return undefined
  entry.createdAt = Date.now() // 续期：使清理按"最近访问"淘汰，保护在显示中的 URL
  // Map 重排到尾部，令容量淘汰（按插入序近似 LRU）也偏向最久未访问项
  registry.delete(token)
  registry.set(token, entry)
  return entry
}

// ─── Cleanup ───────────────────────────────────────────────────────────
function cleanupExpiredTokens() {
  const now = Date.now()
  for (const [token, entry] of registry) {
    if (now - entry.createdAt > TOKEN_TTL_MS) {
      registry.delete(token)
    }
  }
  if (registry.size > MAX_REGISTRY_SIZE) {
    const sorted = Array.from(registry.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
    const toDelete = sorted.slice(0, registry.size - MAX_REGISTRY_SIZE)
    for (const [token] of toDelete) {
      registry.delete(token)
    }
  }
}
const cleanupTimer = setInterval(cleanupExpiredTokens, 10 * 60 * 1000)

/** 停止令牌清理定时器（应用退出清理用，幂等） */
export function stopMediaRegistryCleanup(): void {
  clearInterval(cleanupTimer)
}
