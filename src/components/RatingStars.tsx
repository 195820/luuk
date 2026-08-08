import { useState, useCallback } from 'react'
import { motion } from 'motion/react'
import { Star } from 'lucide-react'
import { motionPresets } from '@/lib/motion-presets'

interface RatingStarsProps {
  libraryId: number
  imagePath: string
  initialRating?: number
  size?: 'small' | 'medium' | 'large'
  onRatingChange?: (rating: number) => void
}

export function RatingStars({
  libraryId,
  imagePath,
  initialRating = 0,
  size = 'medium',
  onRatingChange,
}: RatingStarsProps) {
  const [hoverRating, setHoverRating] = useState(0)
  const [rating, setRating] = useState(initialRating)
  const [loading, setLoading] = useState(false)

  const handleRating = useCallback(async (newRating: number) => {
    setLoading(true)
    try {
      // @ts-ignore
      await window.electronAPI.setFavoriteRating(libraryId, imagePath, newRating)
      setRating(newRating)
      onRatingChange?.(newRating)
    } catch (error) {
      console.error('[RatingStars] 设置评分失败:', error)
    } finally {
      setLoading(false)
    }
  }, [libraryId, imagePath, onRatingChange])

  const handleClick = useCallback((e: React.MouseEvent, starValue: number) => {
    e.stopPropagation()
    const newRating = starValue === rating ? 0 : starValue
    handleRating(newRating)
  }, [rating, handleRating])

  const handleMouseEnter = useCallback((starValue: number) => {
    setHoverRating(starValue)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoverRating(0)
  }, [])

  const displayRating = hoverRating || rating
  const starSize = size === 'small' ? 14 : size === 'large' ? 20 : 16
  const sizeClass = size === 'small' ? 'scale-75' : size === 'large' ? 'scale-125' : ''

  return (
    <div
      className={`flex items-center gap-0.5 ${sizeClass} ${loading ? 'opacity-50 pointer-events-none' : ''}`}
      onMouseLeave={handleMouseLeave}
    >
      {[1, 2, 3, 4, 5].map((starValue) => (
        <motion.button
          key={starValue}
          whileTap={{ scale: 0.9 }}
          transition={motionPresets.micro}
          className="bg-transparent border-none cursor-pointer p-0 transition-all duration-150 hover:scale-110"
          onClick={(e) => handleClick(e, starValue)}
          onMouseEnter={() => handleMouseEnter(starValue)}
          title={`${starValue} 星`}
          disabled={loading}
        >
          <Star
            size={starSize}
            className={`transition-colors duration-150 ${
              starValue <= displayRating ? 'fill-star text-star' : 'text-star-empty'
            }`}
          />
        </motion.button>
      ))}
    </div>
  )
}
