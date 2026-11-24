import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useGoals } from '../../contexts/GoalsContext'
import ReviewCashflow from './components/ReviewCashflow'
import ReviewEmpty from './components/ReviewEmpty'
import ReviewError from './components/ReviewError'
import ReviewGoals from './components/ReviewGoals'
import ReviewHeader from './components/ReviewHeader'
import ReviewNetWorth from './components/ReviewNetWorth'
import ReviewNotes from './components/ReviewNotes'
import ReviewSpending from './components/ReviewSpending'
import { useAnnualReview } from './hooks/useAnnualReview'
import { formatIsoDate, formatMoney } from './utils/format'
import { buildReviewCsv, downloadReviewCsv, reviewCsvFilename } from './utils/reviewCsv'
import '../../styles/AnnualReview.css'

const REVIEW_PATH = '/net-worth/review'
const YEAR_PARAM = /^\d{4}$/
// Long enough for a screen reader to see the live region empty before the same text returns.
const REANNOUNCE_DELAY_MS = 100

interface AnnualReviewProps {
  /** Right side of the page header row. Undefined renders the controls in place; null waits for the slot to mount. */
  headerSlot?: HTMLElement | null
}

const AnnualReview: FC<AnnualReviewProps> = ({ headerSlot }) => {
  const { year: param } = useParams<{ year?: string }>()
  const navigate = useNavigate()
  const { goals } = useGoals()
  const validParam = param === undefined || YEAR_PARAM.test(param)
  const year = param !== undefined && validParam ? Number(param) : null
  const { status, review, years, defaultYear, retry } = useAnnualReview(year)
  const [announcement, setAnnouncement] = useState('')
  const announcedYear = useRef<number | null>(null)
  const lastAnnouncement = useRef('')
  const reannounceTimer = useRef<number | undefined>(undefined)

  // Live regions stay silent when the text does not change, so a repeat is cleared first and set again shortly after.
  const announce = useCallback((text: string) => {
    window.clearTimeout(reannounceTimer.current)
    if (text !== lastAnnouncement.current) {
      lastAnnouncement.current = text
      setAnnouncement(text)
      return
    }
    setAnnouncement('')
    reannounceTimer.current = window.setTimeout(() => setAnnouncement(text), REANNOUNCE_DELAY_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(reannounceTimer.current), [])

  useEffect(() => {
    if (status !== 'ready' || year === null || announcedYear.current === year) return
    announce(announcedYear.current === null ? `Review for ${year} is ready.` : `Showing the review for ${year}.`)
    announcedYear.current = year
  }, [status, year, announce])

  useEffect(() => {
    if (year === null) return
    const previous = document.title
    document.title = `Annual Review ${year} - worth`
    return () => {
      document.title = previous
    }
  }, [year])

  if (!validParam) return <Navigate to={REVIEW_PATH} replace />
  if (year === null && status === 'ready') return <Navigate to={`${REVIEW_PATH}/${defaultYear}`} replace />

  const loading = status === 'loading'
  const exportable = review !== null && review.status !== 'empty'
  const end = review?.netWorth.end
  const endingNetWorth = end && (end.status === 'exact' || end.status === 'nearest') ? end.total : null

  const handleDownload = () => {
    if (!exportable) return
    try {
      downloadReviewCsv(buildReviewCsv(review, formatIsoDate(new Date())), review.year)
      announce(`Downloaded ${reviewCsvFilename(review.year)}.`)
    } catch {
      announce('The CSV file could not be created. Your files were not changed.')
    }
  }

  const noDataAnywhere = year !== null && years.length === 1 && years[0] === year

  const controls = (
    <ReviewHeader
      year={year}
      years={years}
      disabled={loading}
      actionsDisabled={!exportable}
      onYearChange={next => navigate(`${REVIEW_PATH}/${next}`, { replace: true })}
      onPrint={() => window.print()}
      onDownload={handleDownload}
    />
  )

  return (
    <div className="ar-page">
      <div className="ar-live sr-only" role="status">
        {announcement}
      </div>
      {year !== null && <p className="ar-print-title">Annual Review {year}</p>}
      {headerSlot !== null && (headerSlot ? createPortal(controls, headerSlot) : controls)}
      {exportable && !loading && (
        <dl className="ar-headline">
          <dt>Net worth</dt>
          <dd>{formatMoney(endingNetWorth)}</dd>
        </dl>
      )}
      <div className="ar-body" aria-busy={loading}>
        {loading && (
          <p className="ar-loading" role="status">
            Loading your review...
          </p>
        )}
        {status === 'error' && <ReviewError onRetry={retry} />}
        {review?.status === 'empty' && year !== null && <ReviewEmpty year={year} noDataAnywhere={noDataAnywhere} />}
        {review && review.status !== 'empty' && (
          <div className="ar-sections">
            <ReviewNotes review={review} />
            <ReviewNetWorth review={review} />
            <ReviewCashflow review={review} />
            {review.spending && <ReviewSpending year={review.year} spending={review.spending} />}
            <ReviewGoals review={review} hasGoals={goals.length > 0} />
          </div>
        )}
      </div>
      {exportable && (
        <p className="ar-print-footer">
          Prepared with worth on {formatIsoDate(new Date())}. Your data stays on your computer.
        </p>
      )}
    </div>
  )
}

export default AnnualReview
