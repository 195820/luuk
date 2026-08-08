/**
 * 图片 Lightbox 组件
 * 使用 yet-another-react-lightbox 替换 react-zoom-pan-pinch
 * 支持缩放/平移/旋转/翻转
 *
 * 重要：不覆盖 render.slide，让 YARL 默认的 ImageSlide 处理图片渲染
 * 这样 YARL 的 zoom 插件才能正确追踪图片尺寸，计算 maxZoom
 * 旋转/翻转通过 CSS transform 在容器层应用
 */
import { useEffect, useRef, useState } from 'react'
import Lightbox from 'yet-another-react-lightbox'
import Inline from 'yet-another-react-lightbox/plugins/inline'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import './ImageLightbox.css'

interface ImageLightboxProps {
  src: string
  alt: string
  width?: number
  height?: number
  onImageLoaded?: (width: number, height: number) => void
  onError?: () => void
  /** GIF 暂停：为 true 时用 canvas 覆盖当前帧，冻结动画 */
  paused?: boolean
}

export function ImageLightbox({ src, alt: _alt, width, height, onImageLoaded, onError, paused = false }: ImageLightboxProps) {
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [zoomRef, setZoomRef] = useState<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // 使用 ref 存储回调，避免 effect 因回调变化而重新执行导致无限循环
  const onImageLoadedRef = useRef(onImageLoaded)
  const onErrorRef = useRef(onError)
  // 记录已报告的 src，避免同一 src 重复触发 onImageLoaded
  const reportedSrcRef = useRef<string | null>(null)
  useEffect(() => {
    onImageLoadedRef.current = onImageLoaded
    onErrorRef.current = onError
  }, [onImageLoaded, onError])

  // 暴露控制方法到父组件（通过自定义事件）
  useEffect(() => {
    const handlers = {
      'image-lightbox-rotate': () => setRotation(prev => (prev + 90) % 360),
      'image-lightbox-flip-h': () => setFlipH(prev => !prev),
      'image-lightbox-flip-v': () => setFlipV(prev => !prev),
      'image-lightbox-reset': () => {
        setRotation(0)
        setFlipH(false)
        setFlipV(false)
        // changeZoom(1) 重置缩放到 1 倍
        zoomRef?.changeZoom(1)
      },
      'image-lightbox-zoom-in': () => zoomRef?.zoomIn(),
      'image-lightbox-zoom-out': () => zoomRef?.zoomOut(),
    }

    for (const [event, handler] of Object.entries(handlers)) {
      window.addEventListener(event, handler)
    }
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        window.removeEventListener(event, handler)
      }
    }
  }, [zoomRef])

  // src 变化时重置变换状态，并释放旧图片的解码位图
  useEffect(() => {
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    // 提示浏览器释放旧 img 的解码资源
    if (imgRef.current) {
      imgRef.current.src = ''
      imgRef.current = null
    }
    // 重置已报告状态，允许新 src 触发 onImageLoaded
    reportedSrcRef.current = null
  }, [src])

  // 监听 YARL 渲染的图片，获取 naturalWidth/naturalHeight
  useEffect(() => {
    // src 为空时不执行，避免无限循环
    if (!src) return

    const container = containerRef.current
    if (!container) return

    // 标记当前 effect 是否仍在初始化阶段
    let initialized = false

    // 处理找到的图片：立即标记已报告，避免重复触发
    const handleFoundImage = (img: HTMLImageElement) => {
      // 如果已经为当前 src 报告过，跳过
      if (reportedSrcRef.current === src) return

      // 立即标记，防止 MutationObserver 重复触发
      reportedSrcRef.current = src
      imgRef.current = img

      // 延迟调用回调，避免在 effect 执行期间触发父组件 setState
      // 这样可以防止 "Maximum update depth exceeded" 错误
      const report = () => {
        if (reportedSrcRef.current === src) {
          onImageLoadedRef.current?.(img.naturalWidth, img.naturalHeight)
        }
      }

      if (img.naturalWidth > 0) {
        // 使用 setTimeout 推迟到下一个事件循环，避免在 React 渲染周期内触发状态更新
        setTimeout(report, 0)
      } else {
        img.addEventListener('load', () => {
          setTimeout(report, 0)
        }, { once: true })
        img.addEventListener('error', () => {
          onErrorRef.current?.()
        }, { once: true })
      }
    }

    const observer = new MutationObserver(() => {
      // 忽略初始化阶段的 DOM 变化，只关注后续变化
      if (!initialized) return
      const img = container.querySelector('.yarl__slide img') as HTMLImageElement | null
      if (img && img !== imgRef.current) {
        handleFoundImage(img)
      }
    })
    observer.observe(container, { childList: true, subtree: true })

    // 标记初始化完成
    initialized = true

    // 初始检查
    const img = container.querySelector('.yarl__slide img') as HTMLImageElement | null
    if (img) {
      handleFoundImage(img)
    }

    return () => observer.disconnect()
  }, [src])

  // GIF 暂停：用 canvas 快照覆盖当前帧
  useEffect(() => {
    const removeCanvas = () => {
      if (canvasRef.current) {
        canvasRef.current.remove()
        canvasRef.current = null
      }
    }

    const drawFrame = () => {
      const img = imgRef.current
      const canvas = canvasRef.current
      if (!img || !canvas || img.naturalWidth === 0) return

      // canvas 内部分辨率 = img 自然尺寸（保持 GIF 原始像素）
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // letterbox 绘制：保持 GIF 宽高比，与 img 的 object-fit:contain 对齐
      const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight)
      const dw = img.naturalWidth * scale
      const dh = img.naturalHeight * scale
      const dx = (canvas.width - dw) / 2
      const dy = (canvas.height - dh) / 2
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, dx, dy, dw, dh)
    }

    const tryCreateCanvas = () => {
      const img = imgRef.current
      if (!img) {
        // MutationObserver 异步更新 imgRef，下一帧重试
        return requestAnimationFrame(tryCreateCanvas)
      }

      // 创建 canvas 插入 img 的父节点（与 img 同处 YARL zoom 容器，继承 transform）
      const canvas = document.createElement('canvas')
      canvas.className = 'gif-paused-canvas'
      canvas.style.cssText = [
        'position: absolute',
        'top: 0',
        'left: 0',
        'width: 100%',
        'height: 100%',
        'object-fit: contain',
        'pointer-events: none',
        'z-index: 1',
      ].join(';')

      // 复制 img 的 max 约束，确保与 img 视觉尺寸一致
      const cs = window.getComputedStyle(img)
      canvas.style.maxWidth = cs.maxWidth
      canvas.style.maxHeight = cs.maxHeight

      img.parentElement?.appendChild(canvas)
      canvasRef.current = canvas

      // 延迟绘制：确保 GIF 首帧已渲染到 img
      if (img.complete && img.naturalWidth > 0) {
        requestAnimationFrame(drawFrame)
      } else {
        img.addEventListener('load', () => requestAnimationFrame(drawFrame), { once: true })
      }
    }

    if (paused) {
      tryCreateCanvas()
    } else {
      removeCanvas()
    }

    return () => {
      removeCanvas()
    }
  }, [paused, src])

  // 旋转/翻转变换样式（应用到 YARL 的 slide 容器）
  const transformStyle: React.CSSProperties = {
    transform: `rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
    transformOrigin: 'center center',
    transition: 'transform 0.2s ease',
    width: '100%',
    height: '100%',
  }

  // src 为空时不渲染 Lightbox，避免浏览器警告和无限循环
  if (!src) {
    return (
      <div ref={containerRef} className="image-lightbox-wrapper">
        <div className="image-lightbox-transform-layer" style={transformStyle}>
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span>加载中...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="image-lightbox-wrapper">
      {/* 旋转/翻转层：包裹 YARL 的 slide 区域 */}
      <div className="image-lightbox-transform-layer" style={transformStyle}>
        <Lightbox
          slides={[{ src, width, height }]}
          open={true}
          close={() => {}}
          plugins={[Inline, Zoom]}
          inline={{
            style: { width: '100%', height: '100%' },
          }}
          zoom={{
            ref: setZoomRef,
            maxZoom: 10,
            minZoom: 0.1,
            scrollToZoom: true,
            wheelZoomDistanceFactor: 50,
          }}
          render={{
            buttonPrev: () => null,
            buttonNext: () => null,
            iconClose: () => null,
          }}
          controller={{ closeOnBackdropClick: false }}
          animation={{ fade: 0 }}
          carousel={{
            finite: true,
            imageProps: {
              style: { imageRendering: 'auto' as any }
            }
          }}
          styles={{
            root: { width: '100%', height: '100%' },
            container: { width: '100%', height: '100%', background: 'transparent' },
          }}
        />
      </div>
    </div>
  )
}

/**
 * 触发 ImageLightbox 控制事件的工具函数
 */
export const lightboxActions = {
  rotate: () => window.dispatchEvent(new CustomEvent('image-lightbox-rotate')),
  flipH: () => window.dispatchEvent(new CustomEvent('image-lightbox-flip-h')),
  flipV: () => window.dispatchEvent(new CustomEvent('image-lightbox-flip-v')),
  reset: () => window.dispatchEvent(new CustomEvent('image-lightbox-reset')),
  zoomIn: () => window.dispatchEvent(new CustomEvent('image-lightbox-zoom-in')),
  zoomOut: () => window.dispatchEvent(new CustomEvent('image-lightbox-zoom-out')),
}
