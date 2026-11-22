import { FC, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import ReviewEmpty from './components/ReviewEmpty'
import ReviewError from './components/ReviewError'
import ReviewHeader from './components/ReviewHeader'
import { useAnnualReview } from './hooks/useAnnualReview'
import { describePeriod } from './utils/period'
import '../../styles/AnnualReview.css'

const REVIEW_PATH = '/net-worth/review'
const YEAR_PARAM = /^\d{4}$/

const AnnualReview: FC = () => {
  const { year: param } = useParams<{ year?: string }>()
  const navigate = useNavigate()
  const validParam = param === undefined || YEAR_PARAM.test(param)
  const year = param !== undefined && validParam ? Number(param) : null
  const { status, review, years, defaultYear, retry } = useAnnualReview(year)
  const [announcement, setAnnouncement] = useState('')
  const announcedYear = useRef<number | null>(null)

  useEffect(() => {
    if (status !== 'ready' || year === null || announcedYear.current === year) return
    setAnnouncement(announcedYear.current === null ? `Review for ${year} is ready.` : `Showing the review for ${year}.`)
    announcedYear.current = year
  }, [status, year])

  if (!validParam) return <Navigate to={REVIEW_PATH} replace />
  if (year === null && status === 'ready') return <Navigate to={`${REVIEW_PATH}/${defaultYear}`} replace />

  const loading = status === 'loading'
  const noDataAnywhere = year !== null && years.length === 1 && years[0] === year

  return (
    <div className="ar-page">
      <div className="ar-live sr-only" role="status">
        {announcement}
      </div>
      <ReviewHeader
        year={year}
        years={years}
        period={review ? describePeriod(review) : null}
        disabled={loading}
        onYearChange={next => navigate(`${REVIEW_PATH}/${next}`, { replace: true })}
      />
      <div className="ar-body" aria-busy={loading}>
        {loading && (
          <p className="ar-loading" role="status">
            Loading your review...
          </p>
        )}
        {status === 'error' && <ReviewError onRetry={retry} />}
        {review?.status === 'empty' && year !== null && <ReviewEmpty year={year} noDataAnywhere={noDataAnywhere} />}
        {review && review.status !== 'empty' && <div className="ar-sections">{/* Review sections render here */}</div>}
      </div>
    </div>
  )
}

export default AnnualReview
