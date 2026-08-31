/**
 * 对比模式变换计算（纯函数，便于单测）
 * 管理双图共享的 { scale, tx, ty } 变换状态
 */

export interface TransformState {
  scale: number
  tx: number
  ty: number
}

// 缩放边界（与 Lightbox 口径一致：minZoom 0.1, maxZoom 10）
export const MIN_SCALE = 0.1
export const MAX_SCALE = 10
const ZOOM_FACTOR = 0.15

export const INITIAL_TRANSFORM: TransformState = {
  scale: 1,
  tx: 0,
  ty: 0,
}

/**
 * 以光标位置为锚点进行缩放
 * 保持光标下的像素点在缩放前后视觉位置不变
 */
export function zoomAt(
  cursorX: number,
  cursorY: number,
  delta: number,
  state: TransformState
): TransformState {
  const direction = delta > 0 ? -1 : 1
  const factor = 1 + ZOOM_FACTOR * direction
  const newScale = clamp(state.scale * factor, MIN_SCALE, MAX_SCALE)

  if (newScale === state.scale) return state

  // 锚点公式：保持光标位置在缩放前后映射到同一图像坐标
  const ratio = newScale / state.scale
  const newTx = cursorX - (cursorX - state.tx) * ratio
  const newTy = cursorY - (cursorY - state.ty) * ratio

  return { scale: newScale, tx: newTx, ty: newTy }
}

/**
 * 平移后钳制边界，防止图片完全拖出视口
 * 约束：图片边界至少有一部分可见
 */
export function clampPan(
  tx: number,
  ty: number,
  scale: number,
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
): { tx: number; ty: number } {
  // 图片在容器中的实际渲染尺寸（object-fit: contain 下的尺寸）
  const imgAspect = imageWidth / imageHeight
  const containerAspect = containerWidth / containerHeight
  let renderW: number
  let renderH: number
  if (imgAspect > containerAspect) {
    renderW = containerWidth
    renderH = containerWidth / imgAspect
  } else {
    renderH = containerHeight
    renderW = containerHeight * imgAspect
  }

  // 缩放后的实际像素尺寸
  const scaledW = renderW * scale
  const scaledH = renderH * scale

  // 初始居中时的偏移量（transform-origin: center）
  const baseOffsetX = (containerWidth - renderW) / 2
  const baseOffsetY = (containerHeight - renderH) / 2

  // tx/ty 是在 center-origin 基础上的额外偏移
  // 约束：缩放后图片的可见区域不能为空白
  const maxTx = baseOffsetX + scaledW / 2
  const minTx = baseOffsetX - scaledW / 2 + containerWidth - scaledW
  const maxTy = baseOffsetY + scaledH / 2
  const minTy = baseOffsetY - scaledH / 2 + containerHeight - scaledH

  // 当图片小于容器时，居中显示（不允许可见空白）
  const clampedTx = scaledW <= containerWidth
    ? baseOffsetX + (containerWidth - scaledW) / 2 - (containerWidth - renderW) / 2
    : clamp(tx, minTx, maxTx)
  const clampedTy = scaledH <= containerHeight
    ? baseOffsetY + (containerHeight - scaledH) / 2 - (containerHeight - renderH) / 2
    : clamp(ty, minTy, maxTy)

  return { tx: clampedTx, ty: clampedTy }
}

/**
 * 拖拽平移：在当前变换基础上叠加偏移，并钳制边界
 */
export function panBy(
  dx: number,
  dy: number,
  state: TransformState,
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
): TransformState {
  const newTx = state.tx + dx
  const newTy = state.ty + dy
  const clamped = clampPan(newTx, newTy, state.scale, containerWidth, containerHeight, imageWidth, imageHeight)
  return { ...state, ...clamped }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
