import { describe, it, expect } from 'vitest'
import { balancesFor, makeAccounts } from '../../../test/reviewFixtures'
import {
  buildMonthTotals,
  buildNetWorthReview,
  buildSeries,
  emptyNetWorthReview,
  monthKey,
  monthsOfYear,
  resolveAnchors,
} from './netWorth'

describe('month helpers', () => {
  it('builds zero-padded month keys and twelve months per year', () => {
    expect(monthKey(2025, 3)).toBe('2025-03')
    expect(monthsOfYear(2025)).toHaveLength(12)
    expect(monthsOfYear(2025)[0]).toBe('2025-01')
    expect(monthsOfYear(2025)[11]).toBe('2025-12')
  })
})

describe('buildMonthTotals', () => {
  it('sums every account in the month, inactive ones included', () => {
    const totals = buildMonthTotals(makeAccounts({}, { status: 'inactive' }), [
      ...balancesFor(1, { '2025-01': 100 }),
      ...balancesFor(2, { '2025-01': 50 }),
    ])
    expect(totals.get('2025-01')).toEqual({ total: 150, missing: [] })
  })

  it('ignores balances for account ids that do not exist', () => {
    const totals = buildMonthTotals(makeAccounts({}), [
      ...balancesFor(1, { '2025-01': 100 }),
      ...balancesFor(99, { '2025-01': 5000, '2025-02': 7 }),
    ])
    expect(totals.get('2025-01')?.total).toBe(100)
    expect(totals.has('2025-02')).toBe(false)
  })

  it('ignores entries whose month is not YYYY-MM', () => {
    const totals = buildMonthTotals(makeAccounts({}), balancesFor(1, { '2025-13': 1, '25-01': 1, '2025-01': 2 }))
    expect([...totals.keys()]).toEqual(['2025-01'])
  })

  it('uses the last entry when an account has two entries in one month', () => {
    const totals = buildMonthTotals(makeAccounts({}), [
      ...balancesFor(1, { '2025-01': 100 }),
      ...balancesFor(1, { '2025-01': 120 }),
    ])
    expect(totals.get('2025-01')?.total).toBe(120)
  })

  it('does not report an account missing before its first entry', () => {
    const totals = buildMonthTotals(makeAccounts({ name: 'Old' }, { name: 'New' }), [
      ...balancesFor(1, { '2025-01': 1, '2025-02': 1, '2025-03': 1 }),
      ...balancesFor(2, { '2025-03': 1 }),
    ])
    expect(totals.get('2025-01')?.missing).toEqual([])
    expect(totals.get('2025-03')?.missing).toEqual([])
  })

  it('reports an interior gap for any account', () => {
    const totals = buildMonthTotals(makeAccounts({ name: 'Gap', status: 'inactive' }, { name: 'Full' }), [
      ...balancesFor(1, { '2025-01': 1, '2025-03': 1 }),
      ...balancesFor(2, { '2025-01': 1, '2025-02': 1, '2025-03': 1, '2025-04': 1 }),
    ])
    expect(totals.get('2025-02')?.missing).toEqual([{ id: 1, name: 'Gap' }])
    expect(totals.get('2025-04')?.missing).toEqual([])
  })

  it('expects an active account through the latest month and an inactive one only through its last entry', () => {
    const totals = buildMonthTotals(makeAccounts({ name: 'Active' }, { name: 'Closed', status: 'inactive' }), [
      ...balancesFor(1, { '2025-01': 1 }),
      ...balancesFor(2, { '2025-01': 1, '2025-02': 1 }),
      ...balancesFor(2, { '2025-03': 1 }),
    ])
    expect(totals.get('2025-02')?.missing).toEqual([{ id: 1, name: 'Active' }])
    expect(totals.get('2025-03')?.missing).toEqual([{ id: 1, name: 'Active' }])
  })

  it('flags a December that only inactive accounts reported when an active account has later months', () => {
    const totals = buildMonthTotals(makeAccounts({ name: 'Active' }, { name: 'Closed', status: 'inactive' }), [
      ...balancesFor(1, { '2025-11': 1, '2026-01': 1 }),
      ...balancesFor(2, { '2025-11': 1, '2025-12': 1 }),
    ])
    expect(totals.get('2025-12')?.missing).toEqual([{ id: 1, name: 'Active' }])
  })

  it('ignores accounts with no entries', () => {
    const totals = buildMonthTotals(makeAccounts({}, { name: 'Empty' }), balancesFor(1, { '2025-01': 1 }))
    expect(totals.get('2025-01')?.missing).toEqual([])
  })

  it('returns an empty map without balances', () => {
    expect(buildMonthTotals(makeAccounts({}), []).size).toBe(0)
  })

  it('rounds sums to cents', () => {
    const totals = buildMonthTotals(makeAccounts({}, {}), [
      ...balancesFor(1, { '2025-01': 0.1 }),
      ...balancesFor(2, { '2025-01': 0.2 }),
    ])
    expect(totals.get('2025-01')?.total).toBe(0.3)
  })
})

describe('resolveAnchors', () => {
  const totalsFor = (byMonth: Record<string, number>) => buildMonthTotals(makeAccounts({}), balancesFor(1, byMonth))

  it('uses December of each year when present', () => {
    const { start, end } = resolveAnchors(2025, totalsFor({ '2024-12': 1, '2025-12': 2 }))
    expect(start).toEqual({ month: '2024-12', total: 1, status: 'exact', missing: [] })
    expect(end).toEqual({ month: '2025-12', total: 2, status: 'exact', missing: [] })
  })

  it('starts from the latest month of the previous year when its December is absent', () => {
    const { start } = resolveAnchors(2025, totalsFor({ '2024-03': 1, '2024-09': 2, '2025-12': 3 }))
    expect(start).toMatchObject({ month: '2024-09', total: 2, status: 'nearest' })
  })

  it('falls back to the earliest month of the year when the previous year has no data', () => {
    const { start } = resolveAnchors(2025, totalsFor({ '2025-05': 1, '2025-02': 2, '2025-12': 3 }))
    expect(start).toMatchObject({ month: '2025-02', status: 'nearest' })
  })

  it('does not reach back past the previous year', () => {
    const { start } = resolveAnchors(2025, totalsFor({ '2023-12': 1, '2025-12': 3 }))
    expect(start).toMatchObject({ month: '2025-12', status: 'nearest' })
  })

  it('marks both anchors missing when there is no data in either year', () => {
    const { start, end } = resolveAnchors(2025, totalsFor({ '2020-12': 1 }))
    expect(start).toEqual({ month: null, total: null, status: 'missing', missing: [] })
    expect(end.status).toBe('missing')
  })

  it('marks a nearest month incomplete when it is missing an account', () => {
    const totals = buildMonthTotals(makeAccounts({ name: 'A' }, { name: 'B' }), [
      ...balancesFor(1, { '2025-01': 1, '2025-06': 1 }),
      ...balancesFor(2, { '2025-01': 1 }),
    ])
    const { end } = resolveAnchors(2025, totals)
    expect(end).toMatchObject({ month: '2025-06', status: 'incomplete', missing: [{ id: 2, name: 'B' }] })
  })
})

describe('buildSeries', () => {
  it('returns twelve points with gaps for months without entries', () => {
    const totals = buildMonthTotals(makeAccounts({ name: 'A' }, { name: 'B' }), [
      ...balancesFor(1, { '2025-01': 10, '2025-03': 30 }),
      ...balancesFor(2, { '2025-01': 1 }),
    ])
    const series = buildSeries(2025, totals)
    expect(series).toHaveLength(12)
    expect(series[0]).toEqual({ month: '2025-01', total: 11, complete: true })
    expect(series[1]).toEqual({ month: '2025-02', total: null, complete: false })
    expect(series[2]).toEqual({ month: '2025-03', total: 30, complete: false })
    expect(series[11].month).toBe('2025-12')
  })
})

describe('buildNetWorthReview', () => {
  const review = (byMonth: Record<string, number>, year = 2025) =>
    buildNetWorthReview(year, buildMonthTotals(makeAccounts({}), balancesFor(1, byMonth)))

  it('computes change and percent from exact anchors', () => {
    const r = review({ '2024-12': 400, '2025-12': 460 })
    expect(r.change).toBe(60)
    expect(r.changePct).toBeCloseTo(15, 10)
    expect(r.startNegative).toBe(false)
  })

  it('reports a decline as negative change and percent', () => {
    const r = review({ '2024-12': 200, '2025-12': 150 })
    expect(r.change).toBe(-50)
    expect(r.changePct).toBeCloseTo(-25, 10)
  })

  it('leaves change null when the months are equal', () => {
    expect(review({ '2025-12': 5 }).change).toBeNull()
  })

  it('leaves change null when an anchor is missing', () => {
    expect(review({ '2024-12': 5 }).change).toBeNull()
  })

  it('still reports startNegative when the end is incomplete', () => {
    expect(review({ '2024-12': -5 }).startNegative).toBe(true)
  })

  it('builds an empty review with 12 empty points', () => {
    const r = emptyNetWorthReview(2025)
    expect(r.start.status).toBe('missing')
    expect(r.change).toBeNull()
    expect(r.series.every(p => p.total === null && !p.complete)).toBe(true)
  })
})
