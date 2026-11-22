import { FC } from 'react'
import { Link } from 'react-router-dom'
import type { AnnualReview } from '../types'
import { formatMoney, formatPercent } from '../utils/format'
import { describePriorYear } from '../utils/priorYear'
import ReviewStat from './ReviewStat'

interface ReviewCashflowProps {
  review: AnnualReview
}

const MANUAL_SUB = 'From your yearly log in Growth'

const ReviewCashflow: FC<ReviewCashflowProps> = ({ review }) => {
  const { cashflow, prior, year } = review
  const manual = cashflow.source === 'manual'
  const priorYear = year - 1

  return (
    <section className="ar-section" aria-labelledby="ar-cf-h">
      <h3 id="ar-cf-h" className="ar-section__title">
        Income and savings
      </h3>
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
            sub={manual ? MANUAL_SUB : 'Money in, from your transactions'}
            prior={describePriorYear(priorYear, cashflow.income, prior?.income, 'usd')}
          />
          <ReviewStat
            label="Expenses"
            value={formatMoney(cashflow.expenses)}
            sub={manual ? MANUAL_SUB : 'Money out, after refunds'}
            prior={describePriorYear(priorYear, cashflow.expenses, prior?.expenses, 'usd')}
          />
          <ReviewStat
            label="Savings"
            value={formatMoney(cashflow.savings)}
            sub={manual ? MANUAL_SUB : 'Income minus expenses'}
          />
          <ReviewStat
            label="Savings rate"
            value={formatPercent(cashflow.savingsRate)}
            sub="Savings as a share of income"
            prior={describePriorYear(priorYear, cashflow.savingsRate, prior?.savingsRate, 'points')}
          />
        </dl>
      )}
    </section>
  )
}

export default ReviewCashflow
