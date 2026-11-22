import { FC } from 'react'
import type { SpendingReview } from '../types'
import { formatMoney, formatPercent } from '../utils/format'

interface ReviewSpendingProps {
  year: number
  spending: SpendingReview
}

const ShareCell: FC<{ share: number }> = ({ share }) => (
  <td className="ar-num">
    <div className="ar-share">
      <span className="ar-bar" aria-hidden="true">
        <span className="ar-bar__fill" style={{ width: `${Math.min(Math.max(share, 0), 100)}%` }} />
      </span>
      <span>{formatPercent(share)}</span>
    </div>
  </td>
)

const ReviewSpending: FC<ReviewSpendingProps> = ({ year, spending }) => {
  const { top, other } = spending
  return (
    <section className="ar-section" aria-labelledby="ar-sp-h">
      <h3 id="ar-sp-h" className="ar-section__title">
        Top spending groups
      </h3>
      {top.length === 0 ? (
        <p className="ar-empty-line">No net spending recorded for {year}</p>
      ) : (
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
            {top.map(group => (
              <tr key={group.id}>
                <th scope="row">{group.name}</th>
                <td className="ar-num">{formatMoney(group.amount)}</td>
                <ShareCell share={group.share} />
              </tr>
            ))}
            {other && (
              <tr>
                <th scope="row">All other groups ({other.count})</th>
                <td className="ar-num">{formatMoney(other.amount)}</td>
                <ShareCell share={other.share} />
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default ReviewSpending
