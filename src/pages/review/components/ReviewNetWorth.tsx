import { FC, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AnnualReview } from '../types'
import { formatDelta, formatMoney, formatMonthLong, formatMonthShort, formatPercent } from '../utils/format'
import { describePriorYear } from '../utils/priorYear'
import NetWorthChart from './NetWorthChart'
import NetWorthTable from './NetWorthTable'
import ReviewStat from './ReviewStat'

interface ReviewNetWorthProps {
  review: AnnualReview
}

const anchorSub = (a: AnnualReview['netWorth']['start']): string => {
  if (a.month === null) return 'No balances'
  return a.status === 'incomplete' ? `${formatMonthShort(a.month)}, incomplete` : formatMonthShort(a.month)
}

/** One sentence that stands in for the chart. */
export function summarizeNetWorth(review: AnnualReview): string {
  const { start, end, change, series } = review.netWorth
  if (change === null || start.month === null || end.month === null) {
    const plotted = series.filter(p => p.total !== null).length
    return `Net worth change is not available for ${review.year}. ${plotted} of 12 months have balances.`
  }
  const from = formatMonthLong(start.month)
  const to = formatMonthLong(end.month)
  if (formatDelta(change, 'usd') === 'No change') {
    return `Net worth was unchanged at ${formatMoney(end.total)} from ${from} to ${to}.`
  }
  return `Net worth ${change > 0 ? 'rose' : 'fell'} from ${formatMoney(start.total)} in ${from} to ${formatMoney(end.total)} in ${to}.`
}

const ReviewNetWorth: FC<ReviewNetWorthProps> = ({ review }) => {
  const [expanded, setExpanded] = useState(false)
  const tableId = useId()
  const { start, end, change, changePct, series } = review.netWorth
  const comparable = review.status === 'complete'
  const hasBalances = series.some(p => p.total !== null)
  const changeSub =
    change === null || start.month === null || end.month === null
      ? null
      : changePct === null
        ? 'Percent change not available'
        : `${formatPercent(changePct)} from ${formatMoney(start.total)} in ${formatMonthShort(start.month)} to ${formatMoney(end.total)} in ${formatMonthShort(end.month)}`

  return (
    <section className="ar-section" aria-labelledby="ar-nw-h">
      <h3 id="ar-nw-h" className="ar-section__title">
        Net worth
      </h3>
      <dl className="ar-stats">
        <ReviewStat
          label="Net worth change"
          value={formatDelta(change, 'usd')}
          sub={changeSub}
          prior={comparable ? describePriorYear(review.year - 1, change, review.prior?.netWorthChange, 'usd') : null}
        />
        <ReviewStat label="Starting net worth" value={formatMoney(start.total)} sub={anchorSub(start)} />
        <ReviewStat label="Ending net worth" value={formatMoney(end.total)} sub={anchorSub(end)} />
      </dl>
      {hasBalances ? (
        <figure className="ar-figure">
          <NetWorthChart series={series} summary={summarizeNetWorth(review)} />
          <button
            type="button"
            className="ar-btn ar-figure__toggle"
            aria-expanded={expanded}
            aria-controls={tableId}
            onClick={() => setExpanded(open => !open)}
          >
            {expanded ? 'Hide monthly values' : 'Show monthly values'}
          </button>
          <NetWorthTable id={tableId} year={review.year} series={series} expanded={expanded} />
        </figure>
      ) : (
        <p className="ar-empty-line">
          No balances for {review.year}{' '}
          <Link className="ar-link" to="/net-worth/dashboard">
            Go to Wealth
          </Link>
        </p>
      )}
    </section>
  )
}

export default ReviewNetWorth
