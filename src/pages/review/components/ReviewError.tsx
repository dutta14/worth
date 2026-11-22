import { FC } from 'react'

interface ReviewErrorProps {
  onRetry: () => void
}

const ReviewError: FC<ReviewErrorProps> = ({ onRetry }) => (
  <div className="ar-error" role="alert">
    <p>The review could not be built. Your files were not changed.</p>
    <button type="button" className="ar-btn" onClick={onRetry}>
      Try again
    </button>
  </div>
)

export default ReviewError
