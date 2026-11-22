import { describe, it, expect } from 'vitest'
import type { AnchorStatus, AnnualReview, NetWorthAnchor } from '../types'
import { describePeriod } from './period'

const anchor = (month: string | null, status: AnchorStatus): NetWorthAnchor => ({
  month,
  total: month ? 1000 : null,
  status,
  missing: [],
})

const review = (overrides: Partial<AnnualReview> & { start?: NetWorthAnchor; end?: NetWorthAnchor }): AnnualReview => {
  const { start, end, ...rest } = overrides
  return {
    year: 2025,
    status: 'complete',
    netWorth: {
      start: start ?? anchor('2024-12', 'exact'),
      end: end ?? anchor('2025-12', 'exact'),
      change: 0,
      changePct: null,
      startNegative: false,
      series: [],
    },
    cashflow: {
      source: 'none',
      income: null,
      expenses: null,
      savings: null,
      savingsRate: null,
      monthsCovered: [],
      gapMonths: [],
      unreadableMonths: [],
      mismatch: null,
    },
    spending: null,
    goals: [],
    notes: [],
    prior: null,
    ...rest,
  }
}

describe('describePeriod', () => {
  it('describes a complete year as January to December', () => {
    expect(describePeriod(review({}))).toBe('January to December 2025')
  })

  it('names the real anchor months when one is the nearest month', () => {
    expect(describePeriod(review({ start: anchor('2025-03', 'nearest') }))).toBe('Mar 2025 to Dec 2025')
    expect(describePeriod(review({ end: anchor('2025-10', 'nearest') }))).toBe('Dec 2024 to Oct 2025')
  })

  it('says the year is in progress, through the month named in the note', () => {
    const inProgress = review({
      year: 2026,
      status: 'in-progress',
      end: anchor('2026-10', 'nearest'),
      notes: [{ code: 'in-progress', throughMonth: '2026-10' }],
    })

    expect(describePeriod(inProgress)).toBe('January to October 2026, year in progress')
  })

  it('falls back to the anchors when an in-progress review has no note', () => {
    expect(describePeriod(review({ status: 'in-progress' }))).toBe('January to December 2025')
  })

  it('uses the full year when an anchor month is unknown', () => {
    expect(describePeriod(review({ start: anchor(null, 'missing'), end: anchor('2025-10', 'nearest') }))).toBe(
      'January to December 2025',
    )
  })

  it('has no period for an empty review', () => {
    expect(describePeriod(review({ status: 'empty' }))).toBeNull()
  })
})
