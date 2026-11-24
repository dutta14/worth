import { FC } from 'react'
import { GROUP_COLORS } from '../../allocation/constants'
import type { SpendingReview } from '../types'
import { formatMoney, formatPercent } from '../utils/format'

interface ReviewSpendingProps {
  year: number
  spending: SpendingReview
}

const ReviewSpending: FC<ReviewSpendingProps> = ({ year, spending }) => {
  const { top, other } = spending
  const groups = [
    ...top.map(group => ({ ...group, id: `group-${group.id}` })),
    ...(other
      ? [{ id: 'other', name: `All other groups (${other.count})`, amount: other.amount, share: other.share }]
      : []),
  ]
  const total = groups.reduce((sum, group) => sum + group.amount, 0)
  let offset = 0
  const slices = groups.map((group, index) => {
    const share = total > 0 ? (group.amount / total) * 100 : 0
    const slice = { ...group, color: GROUP_COLORS[index % GROUP_COLORS.length], offset, size: share }
    offset += share
    return slice
  })
  const summary = `Spending by group, ${year}. ${groups
    .map(group => `${group.name}: ${formatMoney(group.amount)}, ${formatPercent(group.share)}`)
    .join('; ')}.`

  return (
    <section className="ar-section" aria-labelledby="ar-sp-h">
      <h2 id="ar-sp-h" className="ar-section__title">
        Top spending groups
      </h2>
      {top.length === 0 ? (
        <p className="ar-empty-line">No net spending recorded for {year}</p>
      ) : (
        <div className="ar-spending">
          <svg
            className="ar-donut"
            viewBox="0 0 200 200"
            width="220"
            height="220"
            role="img"
            aria-label={summary}
            focusable="false"
          >
            {slices.map(slice => (
              <circle
                key={slice.id}
                cx="100"
                cy="100"
                r="72"
                fill="none"
                stroke={slice.color}
                strokeWidth="32"
                pathLength="100"
                strokeDasharray={`${slice.size} 100`}
                strokeDashoffset={-slice.offset}
                transform="rotate(-90 100 100)"
              />
            ))}
          </svg>
          <table className="ar-table">
            <caption className="sr-only">Spending by group, {year}</caption>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col" className="ar-num">
                  Spent
                </th>
                <th scope="col" className="ar-num">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {slices.map(group => (
                <tr key={group.id}>
                  <th scope="row">
                    <span className="ar-spending__swatch" style={{ backgroundColor: group.color }} aria-hidden="true" />
                    {group.name}
                  </th>
                  <td className="ar-num">{formatMoney(group.amount)}</td>
                  <td className="ar-num">{formatPercent(group.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default ReviewSpending
