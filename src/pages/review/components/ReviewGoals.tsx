import { FC } from 'react'
import { Link } from 'react-router-dom'
import type { AnnualReview } from '../types'
import { formatMoney, formatMonthShort, formatPercent, pluralize } from '../utils/format'
import ReviewDelta from './ReviewDelta'
import ReviewStat from './ReviewStat'

interface ReviewGoalsProps {
  review: AnnualReview
  /** True when the user has any goal at all, whatever its creation date. */
  hasGoals: boolean
}

const describeSkipped = (count: number, year: number): string =>
  `${pluralize(count, 'goal')} existed by the end of ${year} but ${count === 1 ? 'has' : 'have'} no target today, so progress is not shown.`

const ReviewGoals: FC<ReviewGoalsProps> = ({ review, hasGoals }) => {
  const { start, end } = review.netWorth
  const endLabel =
    end.month === `${review.year}-12`
      ? `at the end of ${review.year}`
      : end.month
        ? `in ${formatMonthShort(end.month)}`
        : ''
  const baseline =
    start.month && start.month !== `${review.year - 1}-12` ? ` from ${formatMonthShort(start.month)}` : ''
  const hasGw = review.goals.some(goal => goal.gwTarget !== null)
  const progress = (endPct: number | null, startPct: number | null) => (
    <>
      <span className="ar-goal__pct">{formatPercent(endPct)}</span>
      {endPct !== null &&
        (startPct === null ? (
          <span className="ar-goal__change">Change not available</span>
        ) : (
          <span className="ar-goal__change">
            <ReviewDelta n={endPct - startPct} kind="points" />
          </span>
        ))}
    </>
  )
  return (
    <section className="ar-section" aria-labelledby="ar-goals-h">
      <h2 id="ar-goals-h" className="ar-section__title">
        Goal progress at year end
      </h2>
      {review.goals.length === 0 ? (
        <p className="ar-empty-line">
          {review.skippedGoals > 0 ? (
            describeSkipped(review.skippedGoals, review.year)
          ) : hasGoals ? (
            `You had no goals set by the end of ${review.year}.`
          ) : (
            <>
              You have not set a goal yet.{' '}
              <Link className="ar-link" to="/goal/plans">
                Open Planning
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          <dl className="ar-stats">
            <ReviewStat label="FI balance" value={formatMoney(review.goals[0].endBalance)} sub={endLabel} />
            <ReviewStat label="GW balance" value={formatMoney(review.goals[0].endGwBalance)} sub={endLabel} />
          </dl>
          <table className="ar-table ar-goal-table">
            <caption className="sr-only">Goal progress at year end</caption>
            <thead>
              <tr>
                <th scope="col">Goal</th>
                <th scope="col" className="ar-num">
                  FI target
                </th>
                <th scope="col" className="ar-num">
                  FI progress
                </th>
                {hasGw && (
                  <>
                    <th scope="col" className="ar-num">
                      GW target
                    </th>
                    <th scope="col" className="ar-num">
                      GW progress
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {review.goals.map(goal => (
                <tr key={goal.goalId}>
                  <th scope="row">{goal.name}</th>
                  <td className="ar-num">{formatMoney(goal.target)}</td>
                  <td className="ar-num">{progress(goal.endPct, goal.startPct)}</td>
                  {hasGw && (
                    <>
                      <td className="ar-num">{goal.gwTarget === null ? '–' : formatMoney(goal.gwTarget)}</td>
                      <td className="ar-num">
                        {goal.gwTarget === null ? '–' : progress(goal.endGwPct, goal.startGwPct)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ar-footnote">
            Progress is measured against each goal as it is set today
            {baseline ? `, and change is measured${baseline}` : ''}.
          </p>
          {review.skippedGoals > 0 && (
            <p className="ar-footnote">{describeSkipped(review.skippedGoals, review.year)}</p>
          )}
        </>
      )}
    </section>
  )
}

export default ReviewGoals
