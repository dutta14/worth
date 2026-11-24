import { FC } from 'react'
import { type DeltaKind, formatDelta, NO_CHANGE } from '../utils/format'

interface ReviewDeltaProps {
  n: number | null
  kind: DeltaKind
}

const ReviewDelta: FC<ReviewDeltaProps> = ({ n, kind }) => {
  const text = formatDelta(n, kind)
  if (n === null || text === NO_CHANGE) return <span className="ar-delta">{text}</span>
  const direction = n < 0 ? 'Down' : 'Up'
  return (
    <span className={`ar-delta ar-delta--${n < 0 ? 'negative' : 'positive'}`}>
      <span aria-hidden="true">{n < 0 ? '↘' : '↗'}</span>
      <span className="sr-only">{direction}</span> {text.slice(direction.length + 1)}
    </span>
  )
}

interface ReviewPriorYearProps {
  year: number
  current: number | null
  prior: number | null | undefined
  kind: DeltaKind
}

export const ReviewPriorYear: FC<ReviewPriorYearProps> = ({ year, current, prior, kind }) => {
  if (current === null || prior === null || prior === undefined) return null
  return (
    <>
      vs. {year}: <ReviewDelta n={current - prior} kind={kind} />
    </>
  )
}

export default ReviewDelta
