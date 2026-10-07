/**
 * vitest 全局 setup
 * Node 25/26 引入了实验性 `localStorage` 全局：未带 --localstorage-file 时该全局“存在但残缺”
 * （typeof !== 'undefined' 却访问不到可用的 getItem），会遮蔽 jsdom 的同名实现，
 * 导致 zustand persist 类测试直接 `localStorage.getItem is not a function` 崩溃。
 * 这里以“功能可用”为准：残缺时注入内存版 Storage，让 persist 类测试跨 Node 版本稳定运行（仅测试侧，不影响生产）。
 */
class MemoryStorage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
}

function ensureStorage(name: 'localStorage' | 'sessionStorage'): void {
  // 不能只看“是否存在”：Node 25/26 的内建 localStorage 可能已定义但不可用（无 getItem）
  let usable = false
  try {
    const existing = (globalThis as Record<string, unknown>)[name] as
      | { getItem?: unknown }
      | undefined
    usable = !!existing && typeof existing.getItem === 'function'
  } catch {
    usable = false
  }
  if (usable) return
  try {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: new MemoryStorage(),
    })
  } catch {
    // 该宿主不允许覆盖时忽略，遗留错误由具体测试暴露
  }
}

ensureStorage('localStorage')
ensureStorage('sessionStorage')