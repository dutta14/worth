import { FC } from 'react'
import { Link } from 'react-router-dom'
import type { AnnualReview } from '../types'
import { formatMoney, formatPercent } from '../utils/format'
import { ReviewPriorYear } from './ReviewDelta'
import ReviewStat from './ReviewStat'

interface ReviewCashflowProps {
  review: AnnualReview
}

const ReviewCashflow: FC<ReviewCashflowProps> = ({ review }) => {
  const { cashflow, prior, year } = review
  const priorYear = year - 1
  // A part-year of money is not comparable with a full prior year; a rate is.
  const comparable = review.status === 'complete'

  return (
    <section className="ar-section" aria-labelledby="ar-cf-h">
      <h2 id="ar-cf-h" className="ar-section__title">
        Income and savings
      </h2>
      {cashflow.source === 'none' ? (
        <p className="ar-empty-line">
          No income or expense data for {year}{' '}
          <Link className="ar-link" to="/budget">
            Go to Cashflow
          </Link>
        </p>
      ) : (
        <dl className="ar-stats">
          <ReviewStat
            label="Income"
            value={formatMoney(cashflow.income)}
            prior={
              comparable && cashflow.income !== null && prior?.income != null ? (
                <ReviewPriorYear year={priorYear} current={cashflow.income} prior={prior.income} kind="usd" />
              ) : null
            }
          />
          <ReviewStat
            label="Expenses"
            value={formatMoney(cashflow.expenses)}
            prior={
              comparable && cashflow.expenses !== null && prior?.expenses != null ? (
                <ReviewPriorYear year={priorYear} current={cashflow.expenses} prior={prior.expenses} kind="usd" />
              ) : null
            }
          />
          <ReviewStat label="Savings" value={formatMoney(cashflow.savings)} />
          <ReviewStat
            label="Savings rate"
            value={formatPercent(cashflow.savingsRate)}
            prior={
              cashflow.savingsRate !== null && prior?.savingsRate != null ? (
                <ReviewPriorYear
                  year={priorYear}
                  current={cashflow.savingsRate}
                  prior={prior.savingsRate}
                  kind="points"
                />
              ) : null
            }
          />
        </dl>
      )}
    </section>
  )
}

export default ReviewCashflow
