/**
 * media:// 协议 URL 令牌注册表
 *
 * 浏览器会对 URL authority 部分做小写化（WHATWG URL 标准），
 * 无法在 URL 中保留大小写敏感的 base64 编码路径。
 * 改用令牌映射：主进程生成随机 token 并缓存 {token → filePath}，
 * 协议处理器用 token 查表解析到真实路径。
 */
import path from 'path'

interface RegistryEntry {
  filePath: string
  createdAt: number
}

const registry = new Map<string, RegistryEntry>()
const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 小时过期

/** 清理过期 token */
function cleanupExpiredTokens() {
  const now = Date.now()
  for (const [token, entry] of registry) {
    if (now - entry.createdAt > TOKEN_TTL_MS) {
      registry.delete(token)
    }
  }
}
setInterval(cleanupExpiredTokens, 10 * 60 * 1000) // 每 10 分钟清理一次

/**
 * 注册媒体文件路径，返回 media:// URL
 * 生成的 URL 格式：media://TOKEN（纯小写 hex，不受浏览器小写化影响）
 */
export function registerMediaUrl(filePath: string): string {
  const token = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  registry.set(token, { filePath: path.resolve(filePath), createdAt: Date.now() })
  return `media://${token}`
}

/**
 * 根据 token 查找文件路径
 * 返回 undefined 表示 token 无效或已过期
 */
export function resolveMediaToken(token: string): string | undefined {
  const entry = registry.get(token)
  if (!entry) return undefined
  // 续期
  entry.createdAt = Date.now()
  return entry.filePath
}
