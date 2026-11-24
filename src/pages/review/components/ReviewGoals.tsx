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
          <ul className="ar-goals">
            {review.goals.map(goal => {
              return (
                <li key={goal.goalId} className="ar-goal">
                  <span className="ar-goal__line">
                    {goal.name}: {formatPercent(goal.endPct)}
                    {goal.endPct !== null && (
                      <>
                        {' '}
                        {endLabel};{' '}
                        {goal.startPct === null ? (
                          <>Change{baseline} is not available</>
                        ) : (
                          <>
                            <ReviewDelta n={goal.endPct - goal.startPct} kind="points" />
                            {baseline}
                          </>
                        )}
                      </>
                    )}
                  </span>
                  <dl className="ar-stats">
                    <ReviewStat
                      label="FI balance"
                      value={formatMoney(goal.endBalance)}
                      sub={`of ${formatMoney(goal.target)} target`}
                    />
                    <ReviewStat label="GW balance" value={formatMoney(goal.endGwBalance)} />
                  </dl>
                </li>
              )
            })}
          </ul>
          <p className="ar-footnote">Progress is measured against each goal as it is set today.</p>
          {review.skippedGoals > 0 && (
            <p className="ar-footnote">{describeSkipped(review.skippedGoals, review.year)}</p>
          )}
        </>
      )}
    </section>
  )
}

export default ReviewGoals
