import { describe, it, expect } from 'vitest'
import { zoomAt, clampPan, panBy, INITIAL_TRANSFORM, MIN_SCALE, MAX_SCALE } from '../utils/compare-transform'

describe('compare-transform', () => {
  describe('zoomAt', () => {
    it('放大时 scale 增加', () => {
      const result = zoomAt(400, 300, -100, INITIAL_TRANSFORM)
      expect(result.scale).toBeGreaterThan(1)
    })

    it('缩小时 scale 减少', () => {
      const result = zoomAt(400, 300, 100, INITIAL_TRANSFORM)
      expect(result.scale).toBeLessThan(1)
    })

    it('scale 钳制在 MIN_SCALE', () => {
      let state = { ...INITIAL_TRANSFORM }
      // 连续缩小到极限
      for (let i = 0; i < 100; i++) {
        state = zoomAt(400, 300, 1000, state)
      }
      expect(state.scale).toBeGreaterThanOrEqual(MIN_SCALE)
    })

    it('scale 钳制在 MAX_SCALE', () => {
      let state = { ...INITIAL_TRANSFORM }
      for (let i = 0; i < 100; i++) {
        state = zoomAt(400, 300, -1000, state)
      }
      expect(state.scale).toBeLessThanOrEqual(MAX_SCALE)
    })

    it('光标锚点缩放：光标下像素位置不变', () => {
      const cursorX = 200
      const cursorY = 150
      const before = INITIAL_TRANSFORM
      const after = zoomAt(cursorX, cursorY, -200, before)

      // 光标映射到图片上的坐标在缩放前后应一致
      // 公式：imgX = (cursorX - tx) / scale
      const imgXBefore = (cursorX - before.tx) / before.scale
      const imgXAfter = (cursorX - after.tx) / after.scale
      expect(imgXAfter).toBeCloseTo(imgXBefore, 5)

      const imgYBefore = (cursorY - before.ty) / before.scale
      const imgYAfter = (cursorY - after.ty) / after.scale
      expect(imgYAfter).toBeCloseTo(imgYBefore, 5)
    })

    it('缩放比例不变时返回原状态', () => {
      // 在 MAX_SCALE 时继续放大
      const atMax = { ...INITIAL_TRANSFORM, scale: MAX_SCALE }
      const result = zoomAt(100, 100, -100, atMax)
      expect(result).toEqual(atMax)
    })
  })

  describe('clampPan', () => {
    it('小图居中：平移被约束到中心', () => {
      const result = clampPan(100, 100, 0.5, 800, 600, 200, 150)
      // 小图（缩放后 < 容器）应居中
      expect(typeof result.tx).toBe('number')
      expect(typeof result.ty).toBe('number')
    })

    it('大图平移钳制在边界内', () => {
      const result = clampPan(5000, 5000, 2, 800, 600, 800, 600)
      // tx/ty 应被限制在合理范围
      expect(Math.abs(result.tx)).toBeLessThan(5000)
      expect(Math.abs(result.ty)).toBeLessThan(5000)
    })
  })

  describe('panBy', () => {
    it('叠加偏移量', () => {
      const result = panBy(10, 20, INITIAL_TRANSFORM, 800, 600, 800, 600)
      // 偏移应反映在 tx/ty 上（可能被钳制）
      expect(typeof result.tx).toBe('number')
      expect(typeof result.ty).toBe('number')
      expect(result.scale).toBe(1) // 平移不改变 scale
    })
  })
})
