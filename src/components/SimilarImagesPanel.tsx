import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, ScanSearch } from 'lucide-react'
import { useSimilarStore } from '../stores/similarStore'
import type { ImageGridItem } from './ImageGrid'

interface SimilarImagesPanelProps {
  libraryId: number
  sourceImage: ImageGridItem | null
  onImageClick?: (image: ImageGridItem) => void
}

export function SimilarImagesPanel({
  libraryId,
  sourceImage,
  onImageClick,
}: SimilarImagesPanelProps) {
  const {
    open,
    loading,
    results,
    threshold,
    findSimilar,
    setThreshold,
    close,
  } = useSimilarStore()

  const [localThreshold, setLocalThreshold] = useState(threshold)

  // 当 sourceImage 变化时自动查找
  useEffect(() => {
    if (sourceImage && sourceImage.imagePath) {
      findSimilar(libraryId, sourceImage.imagePath, sourceImage)
    }
  }, [sourceImage, libraryId, findSimilar])

  // 同步本地阈值到 store
  useEffect(() => {
    setThreshold(localThreshold)
  }, [localThreshold, setThreshold])

  // 当阈值变化时重新查找
  const handleThresholdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newThreshold = Number(e.target.value)
      setLocalThreshold(newThreshold)
    },
    []
  )

  const handleClose = useCallback(() => {
    close()
    setLocalThreshold(10) // 重置阈值
  }, [close])

  const handleImageClick = useCallback(
    (image: ImageGridItem) => {
      if (onImageClick) {
        onImageClick(image)
      }
    },
    [onImageClick]
  )

  if (!open || !sourceImage) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-6xl max-h-[90vh] mx-4 bg-glass-l2 backdrop-blur-md rounded-lg border border-border overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <ScanSearch size={20} className="text-text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">相似图片查找</h2>
          </div>
          <button
            onClick={handleClose}
            className="btn-icon-sm"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* 源图片信息 */}
        <div className="px-6 py-4 border-b border-border bg-glass-l1">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded overflow-hidden bg-canvas-tertiary flex-shrink-0">
              <img
                src={sourceImage.src}
                alt={sourceImage.alt}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect fill="%23333" width="80" height="80"/%3E%3Ctext fill="%23666" x="40" y="40" text-anchor="middle" dy=".3em"%3E无图%3C/text%3E%3C/svg%3E'
                }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary font-medium truncate">
                {sourceImage.alt || sourceImage.imagePath}
              </p>
              <p className="text-xs text-text-secondary mt-1">
                源图片
              </p>
            </div>
          </div>
        </div>

        {/* 阈值控制 */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center gap-4">
            <label className="text-sm text-text-secondary whitespace-nowrap">
              相似度阈值：
            </label>
            <input
              type="range"
              min="0"
              max="64"
              value={localThreshold}
              onChange={handleThresholdChange}
              className="flex-1 h-2 bg-canvas-tertiary rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${
                  (localThreshold / 64) * 100
                }%, var(--color-canvas-tertiary) ${(localThreshold / 64) * 100}%, var(--color-canvas-tertiary) 100%)`,
              }}
            />
            <span className="text-sm text-text-primary font-mono w-8 text-right">
              {localThreshold}
            </span>
            <span className="text-xs text-text-secondary">
              (越小越严格)
            </span>
          </div>
        </div>

        {/* 结果区域 */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={32} className="animate-spin text-accent" />
              <span className="ml-3 text-text-secondary">正在查找相似图片...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <ScanSearch size={48} className="mx-auto text-text-muted mb-3" />
                <p className="text-text-secondary">未找到相似图片</p>
                <p className="text-xs text-text-muted mt-1">
                  尝试增大阈值以放宽匹配条件
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-text-secondary mb-4">
                找到 {results.length} 张相似图片（相似度 {(100 - (localThreshold / 64) * 100).toFixed(0)}% 以上）
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                <AnimatePresence>
                  {results.map((image) => (
                    <motion.div
                      key={image.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      className="group relative aspect-square rounded overflow-hidden bg-canvas-tertiary cursor-pointer hover:ring-2 hover:ring-accent transition-all"
                      onClick={() => handleImageClick(image)}
                    >
                      <img
                        src={image.src}
                        alt={image.alt}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23333" width="200" height="200"/%3E%3Ctext fill="%23666" x="100" y="100" text-anchor="middle" dy=".3em"%3E无图%3C/text%3E%3C/svg%3E'
                        }}
                      />
                      {/* 相似度标签 */}
                      <div className="absolute top-2 right-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded text-xs text-white font-mono">
                        {image.similarity}%
                      </div>
                      {/* 文件名 */}
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
                        <p className="text-xs text-white truncate">
                          {image.alt || image.imagePath}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
