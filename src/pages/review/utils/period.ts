import type { AnnualReview } from '../types'
import { formatMonthLong, formatMonthShort } from './format'

/** The period line under the title; null when there is nothing to describe. */
export function describePeriod(review: AnnualReview): string | null {
  if (review.status === 'empty') return null
  if (review.status === 'in-progress') {
    const note = review.notes.find(n => n.code === 'in-progress')
    if (note) return `January to ${formatMonthLong(note.throughMonth)}, year in progress`
  }
  const { start, end } = review.netWorth
  if ((start.status === 'nearest' || end.status === 'nearest') && start.month && end.month) {
    return `${formatMonthShort(start.month)} to ${formatMonthShort(end.month)}`
  }
  return `January to December ${review.year}`
}
