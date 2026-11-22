import { describe, it, expect } from 'vitest'
import { GROUPS, TODAY, yearOfTransactions } from '../../../test/reviewFixtures'
import { makeTransaction } from '../../../test/factories'
import { chooseCashflow, classifyCategories, readableMonths, summarizeBudgetYear, type BudgetYear } from './cashflow'

const budgetOf = (income: number, expenses: number, overrides: Partial<BudgetYear> = {}): BudgetYear => ({
  monthsCovered: ['2025-01'],
  gapMonths: [],
  unreadableMonths: [],
  income,
  expenses,
  ...overrides,
})

describe('classifyCategories', () => {
  it('separates removed and income categories using group membership', () => {
    const { removed, income } = classifyCategories(GROUPS)
    expect(removed).toEqual(new Set(['Transfer']))
    expect(income).toEqual(new Set(['Paycheck']))
  })

  it('returns empty sets when there are no groups', () => {
    const { removed, income } = classifyCategories([])
    expect(removed.size).toBe(0)
    expect(income.size).toBe(0)
  })
})

describe('readableMonths', () => {
  it('keeps months of the year that have a CSV and are not unreadable', () => {
    const tx = { ...yearOfTransactions(2025, {}, 3), '2024-12': [] }
    expect(readableMonths(2025, tx, ['2025-02'])).toEqual(['2025-01', '2025-03'])
  })
})

describe('summarizeBudgetYear', () => {
  const summarize = (tx: ReturnType<typeof yearOfTransactions>, unreadable: string[] = [], year = 2025) =>
    summarizeBudgetYear(year, TODAY, tx, unreadable, GROUPS)

  it('sums income and expenses with refunds reducing expenses', () => {
    const tx = yearOfTransactions(2025, { Paycheck: 1000, Rent: -400 })
    tx['2025-02'] = [makeTransaction({ category: 'Rent', amount: 100 })]
    const s = summarize(tx)
    expect(s).toMatchObject({ income: 1000, expenses: 300, gapMonths: [] })
    expect(s.monthsCovered).toHaveLength(12)
  })

  it('excludes removed categories from both sides', () => {
    const s = summarize(yearOfTransactions(2025, { Paycheck: 1000, Transfer: -999, Rent: -1 }))
    expect(s).toMatchObject({ income: 1000, expenses: 1 })
  })

  it('treats an unfiled category as an expense', () => {
    expect(summarize(yearOfTransactions(2025, { Mystery: -7 })).expenses).toBe(7)
  })

  it('counts a net-positive expense category as negative expenses, matching the Budget page', () => {
    expect(summarize(yearOfTransactions(2025, { Presents: 300, Rent: -1000 })).expenses).toBe(700)
  })

  it('reports interior gaps and excludes unreadable months', () => {
    const tx = yearOfTransactions(2025, { Paycheck: 10 })
    delete tx['2025-04']
    const s = summarize(tx, ['2025-06', '2024-11'])
    expect(s.gapMonths).toEqual(['2025-04', '2025-06'])
    expect(s.unreadableMonths).toEqual(['2025-06'])
    expect(s.monthsCovered).not.toContain('2025-06')
  })

  it('does not treat trailing months of the current year as gaps but does flag interior ones', () => {
    const tx = yearOfTransactions(2026, { Paycheck: 10 }, 10)
    expect(summarize(tx, [], 2026).gapMonths).toEqual([])
    delete tx['2026-03']
    expect(summarize(tx, [], 2026).gapMonths).toEqual(['2026-03'])
  })

  it('expects nothing for the current year without CSVs and for future years', () => {
    expect(summarize({}, [], 2026).gapMonths).toEqual([])
    expect(summarize(yearOfTransactions(2027, {}), [], 2027).gapMonths).toEqual([])
  })

  it('expects all twelve months of a past year with no CSVs', () => {
    expect(summarize({}).gapMonths).toHaveLength(12)
  })

  it('rounds sums to cents', () => {
    const tx = yearOfTransactions(2025, {})
    tx['2025-01'] = [0.1, 0.2].map(amount => makeTransaction({ category: 'Paycheck', amount }))
    expect(summarize(tx).income).toBe(0.3)
  })
})

describe('chooseCashflow', () => {
  it('uses the budget when every expected month is covered', () => {
    const c = chooseCashflow(budgetOf(120000, 78000), undefined)
    expect(c).toMatchObject({ source: 'budget', income: 120000, expenses: 78000, savings: 42000, mismatch: null })
    expect(c.savingsRate).toBeCloseTo(35, 10)
  })

  it('prefers the manual log over a partial budget', () => {
    const c = chooseCashflow(budgetOf(10, 5, { gapMonths: ['2025-02'] }), { netIncome: 90000, savings: 18000 })
    expect(c).toMatchObject({ source: 'manual', income: 90000, expenses: 72000, savings: 18000 })
  })

  it('prefers the manual log over a missing budget', () => {
    const c = chooseCashflow(budgetOf(0, 0, { monthsCovered: [] }), { netIncome: 100 })
    expect(c).toMatchObject({ source: 'manual', income: 100, expenses: null, savings: null, savingsRate: null })
  })

  it('does not use a manual log that has no net income', () => {
    const c = chooseCashflow(budgetOf(0, 0, { monthsCovered: [] }), { savings: 5 })
    expect(c.source).toBe('none')
  })

  it('falls back to partial budget figures when there is no manual net income', () => {
    const c = chooseCashflow(budgetOf(100, 40, { gapMonths: ['2025-02'] }), { savings: 5 })
    expect(c).toMatchObject({ source: 'budget-partial', income: 100, expenses: 40, savings: 60, mismatch: null })
    expect(c.savingsRate).toBeCloseTo(60, 10)
  })

  it('returns no figures without any source', () => {
    const c = chooseCashflow(budgetOf(0, 0, { monthsCovered: [], gapMonths: ['2025-01'] }), undefined)
    expect(c).toMatchObject({
      source: 'none',
      income: null,
      expenses: null,
      savings: null,
      savingsRate: null,
      gapMonths: ['2025-01'],
    })
  })

  it('gives no savings rate when income is zero or negative', () => {
    expect(chooseCashflow(budgetOf(0, 5000), undefined).savingsRate).toBeNull()
    expect(chooseCashflow(budgetOf(-10, 5), undefined).savingsRate).toBeNull()
    expect(chooseCashflow(budgetOf(0, 5000), undefined).savings).toBe(-5000)
  })

  describe('mismatch threshold', () => {
    const budget = budgetOf(120000, 78000)

    it('is not set at exactly the limit of 1 percent of budget income', () => {
      expect(chooseCashflow(budget, { netIncome: 118800 }).mismatch).toBeNull()
    })

    it('is set one dollar beyond the limit', () => {
      expect(chooseCashflow(budget, { netIncome: 118799 }).mismatch).toEqual({
        manualIncome: 118799,
        manualSavings: null,
        budgetIncome: 120000,
        budgetSavings: 42000,
        incomeDiffers: true,
        savingsDiffers: false,
      })
    })

    it('uses a floor of 100 dollars for small incomes', () => {
      const small = budgetOf(5000, 1000)
      expect(chooseCashflow(small, { netIncome: 4900 }).mismatch).toBeNull()
      expect(chooseCashflow(small, { netIncome: 4899 }).mismatch).not.toBeNull()
    })

    it('tests savings against 1 percent of budget savings', () => {
      expect(chooseCashflow(budget, { savings: 41580 }).mismatch).toBeNull()
      expect(chooseCashflow(budget, { savings: 41579 }).mismatch).toMatchObject({
        manualIncome: null,
        manualSavings: 41579,
      })
    })

    it('flags only the figure that went past its threshold', () => {
      expect(chooseCashflow(budget, { netIncome: 120030, savings: 30000 }).mismatch).toMatchObject({
        incomeDiffers: false,
        savingsDiffers: true,
      })
      expect(chooseCashflow(budget, { netIncome: 100000, savings: 42010 }).mismatch).toMatchObject({
        incomeDiffers: true,
        savingsDiffers: false,
      })
    })

    it('flags both figures when both went past their thresholds', () => {
      expect(chooseCashflow(budget, { netIncome: 118000, savings: 40000 }).mismatch).toMatchObject({
        incomeDiffers: true,
        savingsDiffers: true,
      })
    })

    it('handles negative budget savings with an absolute threshold', () => {
      const overspent = budgetOf(60000, 66000)
      expect(chooseCashflow(overspent, { savings: -6100 }).mismatch).toBeNull()
      expect(chooseCashflow(overspent, { savings: 6000 }).mismatch).not.toBeNull()
    })

    it('is never set for a manual or partial source', () => {
      expect(chooseCashflow(budgetOf(1, 1, { gapMonths: ['2025-02'] }), { netIncome: 99999 }).mismatch).toBeNull()
    })
  })
})
