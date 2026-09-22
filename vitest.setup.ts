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

/**
 * jsdom 组件测试 polyfill（仅当存在 window 时生效，node-env 测试文件不受影响）。
 * 目标：让 @testing-library/react 渲染依赖浏览器 API 的组件（虚拟列表/灯箱/图表）不致结构性崩溃。
 * 只补齐行为骨架，不做像素级断言。
 */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // 1) matchMedia：主题/响应式组件依赖；需支持 addEventListener/addListener 与可配 matches
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  // 2) ResizeObserver：必须异步回调一次并给出非 0 contentRect，
  //    否则 @tanstack/react-virtual 测得 0 高、虚拟列表渲染 0 行、断言静默空跑
  if (typeof (globalThis as Record<string, unknown>).ResizeObserver === 'undefined') {
    const OBS_SIZE = { width: 1024, height: 768 }
    class ResizeObserverStub {
      private targets = new Set<Element>()
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        this.targets.add(target)
        queueMicrotask(() => {
          if (this.targets.size === 0) return
          const entries = [...this.targets].map(
            (t) =>
              ({
                target: t,
                contentRect: { ...OBS_SIZE, top: 0, left: 0, right: OBS_SIZE.width, bottom: OBS_SIZE.height, x: 0, y: 0, toJSON() {} },
                borderBoxSize: [{ inlineSize: OBS_SIZE.width, blockSize: OBS_SIZE.height }],
                contentBoxSize: [{ inlineSize: OBS_SIZE.width, blockSize: OBS_SIZE.height }],
                devicePixelContentBoxSize: [{ inlineSize: OBS_SIZE.width, blockSize: OBS_SIZE.height }],
              }) as unknown as ResizeObserverEntry,
          )
          this.cb(entries, this as unknown as ResizeObserver)
        })
      }
      unobserve(target: Element) { this.targets.delete(target) }
      disconnect() { this.targets.clear() }
    }
    ;(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub
  }

  // 3) IntersectionObserver：懒加载/预加载组件依赖，jsdom 无内置
  if (typeof (globalThis as Record<string, unknown>).IntersectionObserver === 'undefined') {
    class IntersectionObserverStub {
      constructor(private cb: IntersectionObserverCallback) {}
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] { return [] }
      root = null
      rootMargin = ''
      thresholds: number[] = []
    }
    ;(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub
  }

  // 4) getBoundingClientRect：jsdom 恒返回全 0，虚拟列表/定位组件会算出空视口；
  //    直接覆写为非 0 默认值，测试可逐例 vi.spyOn 覆写
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, width: 200, height: 200, right: 200, bottom: 200, toJSON() {} } as DOMRect
  }

  // 5) canvas 2D getContext stub（ImageLightbox 用 canvas；HistogramChart 用 SVG 不需）
  window.HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const noop = () => {}
    const gradient = { addColorStop: noop }
    return {
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
      canvas: this, clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop, moveTo: noop,
      lineTo: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
      drawImage: noop, fillText: noop, strokeText: noop,
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => gradient, createRadialGradient: () => gradient, createPattern: () => null,
      getImageData: (x: number, y: number, w: number, h: number) =>
        ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h, colorSpace: 'srgb' }),
      putImageData: noop, createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
      setTransform: noop, transform: noop, clip: noop, quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop,
    }
  } as unknown as typeof window.HTMLCanvasElement.prototype.getContext

  // 6) HTMLImageElement：jsdom 不自动触发 onload/decode，灯箱/缩略图加载会挂起
  ;(window.HTMLImageElement.prototype as unknown as { decode?: () => Promise<boolean> }).decode =
    () => Promise.resolve(true)

  // 7) 媒体元素 play/pause/load：视频/音频组件挂载即调用，jsdom 未实现会抛错
  const mediaProto = window.HTMLMediaElement.prototype as unknown as Record<string, unknown>
  mediaProto.play = () => Promise.resolve()
  mediaProto.pause = () => {}
  mediaProto.load = () => {}

  // 8) scrollIntoView：列表定位滚动，jsdom 未实现
  if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
}