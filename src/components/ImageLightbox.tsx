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

export type FitMode = 'fit-window' | 'actual-size' | 'fit-width' | 'fit-height'

interface ImageLightboxProps {
  src: string
  alt: string
  onImageLoaded?: (width: number, height: number) => void
  onError?: () => void
}

export function ImageLightbox({ src, alt: _alt, onImageLoaded, onError }: ImageLightboxProps) {
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [zoomRef, setZoomRef] = useState<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

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

  // src 变化时重置变换状态
  useEffect(() => {
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
  }, [src])

  // 监听 YARL 渲染的图片，获取 naturalWidth/naturalHeight
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new MutationObserver(() => {
      const img = container.querySelector('.yarl__slide img') as HTMLImageElement | null
      if (img && img !== imgRef.current) {
        imgRef.current = img
        // 如果图片已加载完成
        if (img.naturalWidth > 0) {
          onImageLoaded?.(img.naturalWidth, img.naturalHeight)
        } else {
          img.addEventListener('load', () => {
            onImageLoaded?.(img.naturalWidth, img.naturalHeight)
          }, { once: true })
          img.addEventListener('error', () => {
            onError?.()
          }, { once: true })
        }
      }
    })
    observer.observe(container, { childList: true, subtree: true })

    // 初始检查
    const img = container.querySelector('.yarl__slide img') as HTMLImageElement | null
    if (img) {
      imgRef.current = img
      if (img.naturalWidth > 0) {
        onImageLoaded?.(img.naturalWidth, img.naturalHeight)
      } else {
        img.addEventListener('load', () => {
          onImageLoaded?.(img.naturalWidth, img.naturalHeight)
        }, { once: true })
        img.addEventListener('error', () => {
          onError?.()
        }, { once: true })
      }
    }

    return () => observer.disconnect()
  }, [src, onImageLoaded, onError])

  // 旋转/翻转变换样式（应用到 YARL 的 slide 容器）
  const transformStyle: React.CSSProperties = {
    transform: `rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
    transformOrigin: 'center center',
    transition: 'transform 0.2s ease',
    width: '100%',
    height: '100%',
  }

  return (
    <div ref={containerRef} className="image-lightbox-wrapper">
      {/* 旋转/翻转层：包裹 YARL 的 slide 区域 */}
      <div className="image-lightbox-transform-layer" style={transformStyle}>
        <Lightbox
          slides={[{ src }]}
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
          carousel={{ finite: true }}
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
