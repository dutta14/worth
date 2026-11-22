import { FC } from 'react'
import { Link } from 'react-router-dom'
import type { AnnualReview } from '../types'
import { pluralize } from '../utils/format'
import { describeGoal, describeGoalBalance } from '../utils/goalText'

interface ReviewGoalsProps {
  review: AnnualReview
  /** True when the user has any goal at all, whatever its creation date. */
  hasGoals: boolean
}

const describeSkipped = (count: number, year: number): string =>
  `${pluralize(count, 'goal')} existed by the end of ${year} but ${count === 1 ? 'has' : 'have'} no target today, so progress is not shown.`

const ReviewGoals: FC<ReviewGoalsProps> = ({ review, hasGoals }) => (
  <section className="ar-section" aria-labelledby="ar-goals-h">
    <h3 id="ar-goals-h" className="ar-section__title">
      Goal progress at year end
    </h3>
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
            const balance = describeGoalBalance(goal)
            return (
              <li key={goal.goalId} className="ar-goal">
                <span className="ar-goal__line">{describeGoal(goal, review)}</span>
                {balance && <span className="ar-goal__sub">{balance}</span>}
              </li>
            )
          })}
        </ul>
        <p className="ar-footnote">Progress is measured against each goal as it is set today.</p>
        {review.skippedGoals > 0 && <p className="ar-footnote">{describeSkipped(review.skippedGoals, review.year)}</p>}
      </>
    )}
  </section>
)

export default ReviewGoals
