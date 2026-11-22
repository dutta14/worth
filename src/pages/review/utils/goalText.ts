import type { AnnualReview, GoalSnapshot } from '../types'
import { formatDelta, formatMoney, formatMonthShort, formatPercent, NOT_AVAILABLE } from './format'

const lowerFirst = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`

/** "Retire at 55: 19.0% at the end of 2025; up 4.0 points from the start of the year" */
export function describeGoal(goal: GoalSnapshot, review: AnnualReview): string {
  if (goal.endPct === null) return `${goal.name}: ${NOT_AVAILABLE}`
  const { start, end } = review.netWorth
  const endLabel =
    end.month === `${review.year}-12` ? `at the end of ${review.year}` : `in ${formatMonthShort(end.month!)}`
  const startLabel =
    start.month === `${review.year - 1}-12` ? 'the start of the year' : formatMonthShort(start.month ?? '')
  const change =
    goal.startPct === null
      ? `change from ${startLabel} is not available`
      : `${lowerFirst(formatDelta(goal.endPct - goal.startPct, 'points'))} from ${startLabel}`
  return `${goal.name}: ${formatPercent(goal.endPct)} ${endLabel}; ${change}`
}

/** "FI balance $380,000 of $2,000,000 target", or null when the end balance is unavailable. */
export function describeGoalBalance(goal: GoalSnapshot): string | null {
  return goal.endBalance === null
    ? null
    : `FI balance ${formatMoney(goal.endBalance)} of ${formatMoney(goal.target)} target`
}
