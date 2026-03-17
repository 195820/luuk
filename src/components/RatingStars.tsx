import { useState, useCallback } from 'react'
import './RatingStars.css'

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

  // 设置评分
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
    
    // 如果点击当前已选中的星星，取消评分
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

  return (
    <div
      className={`rating-stars rating-${size} ${loading ? 'loading' : ''}`}
      onMouseLeave={handleMouseLeave}
    >
      {[1, 2, 3, 4, 5].map((starValue) => (
        <button
          key={starValue}
          className={`rating-star ${starValue <= displayRating ? 'is-filled' : ''}`}
          onClick={(e) => handleClick(e, starValue)}
          onMouseEnter={() => handleMouseEnter(starValue)}
          title={`${starValue} 星`}
          disabled={loading}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  )
}
