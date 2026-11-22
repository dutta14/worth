import { describe, it, expect } from 'vitest'
import { balancesFor, TODAY, yearOfTransactions } from '../../../test/reviewFixtures'
import { getAvailableYears } from './availableYears'

const years = (overrides: Partial<Parameters<typeof getAvailableYears>[0]> = {}) =>
  getAvailableYears({ balances: [], transactionsByMonth: {}, manual: {}, today: TODAY, ...overrides })

describe('getAvailableYears', () => {
  it('returns only the current year with no data', () => {
    expect(years()).toEqual({ years: [2026], defaultYear: 2026 })
  })

  it('unions balance, transaction and manual-log years with the current year, newest first', () => {
    const result = years({
      balances: balancesFor(1, { '2022-06': 1 }),
      transactionsByMonth: yearOfTransactions(2024, {}, 1),
      manual: { 2023: { netIncome: 1 } },
    })
    expect(result.years).toEqual([2026, 2024, 2023, 2022])
  })

  it('does not list years between data years that have no data', () => {
    expect(years({ balances: balancesFor(1, { '2020-12': 1, '2024-12': 1 }) }).years).toEqual([2026, 2024, 2020])
  })

  it('defaults to the latest year whose December has balances', () => {
    const result = years({ balances: balancesFor(1, { '2024-12': 1, '2025-12': 1, '2026-03': 1 }) })
    expect(result.defaultYear).toBe(2025)
  })

  it('defaults to the latest year with any data when no December exists', () => {
    const result = years({
      balances: balancesFor(1, { '2024-05': 1 }),
      transactionsByMonth: yearOfTransactions(2025, {}, 2),
    })
    expect(result.defaultYear).toBe(2025)
  })

  it('defaults to the current year when December of the current year has balances', () => {
    expect(years({ balances: balancesFor(1, { '2026-12': 1 }) }).defaultYear).toBe(2026)
  })

  it('ignores manual logs without any finite number and non-year keys', () => {
    const result = years({ manual: { 2019: {}, 2020: { netIncome: Number.NaN }, [Number.NaN]: { netIncome: 1 } } })
    expect(result.years).toEqual([2026])
  })

  it('ignores malformed month keys', () => {
    expect(years({ balances: balancesFor(1, { bad: 1 }), transactionsByMonth: { nope: [] } }).years).toEqual([2026])
  })
})
