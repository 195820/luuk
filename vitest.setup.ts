/**
 * vitest 全局 setup
 * Node 26 引入了实验性 `localStorage` 全局，未带 --localstorage-file 时访问返回 undefined，
 * 会遮蔽 jestdom 的同名实现，导致 zustand persist 默认存储取到 undefined 直接崩溃。
 * 这里在不可用时注入内存版 Storage，让 persist 类测试稳定运行（仅测试侧，不影响生产）。
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
  let available = false
  try {
    available = typeof (globalThis as Record<string, unknown>)[name] !== 'undefined'
  } catch {
    available = false
  }
  if (available) return
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