import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeGoal } from '../../../test/factories'
import { balancesFor, makeAccounts, makeInputs, TODAY, yearOfTransactions } from '../../../test/reviewFixtures'
import { getFiTarget } from '../../goal/utils/goalCalculations'
import { selectAnnualReview } from './selectAnnualReview'

vi.mock('../../goal/utils/goalCalculations', () => ({ getFiTarget: vi.fn(() => 0) }))

beforeEach(() => {
  vi.mocked(getFiTarget).mockReturnValue(0)
})

const SPEND = {
  Rent: -30000,
  Groceries: -15000,
  Fuel: -9000,
  Flights: -8000,
  Doctor: -6000,
  Clothes: -5000,
  Movies: -5000,
}

describe('selectAnnualReview worked examples', () => {
  it('W1: a clean complete year', () => {
    vi.mocked(getFiTarget).mockReturnValue(2_000_000)
    const review = selectAnnualReview(
      makeInputs({
        accounts: makeAccounts({ goalType: 'fi' }, { goalType: 'gw' }),
        balances: [
          ...balancesFor(1, { '2024-12': 300000, '2025-12': 380000 }),
          ...balancesFor(2, { '2024-12': 100000, '2025-12': 80000 }),
        ],
        transactionsByMonth: yearOfTransactions(2025, { Paycheck: 120000, ...SPEND }),
        goals: [makeGoal({ id: 12, goalName: 'Retire at 55', goalCreatedIn: '2024-03' })],
      }),
    )

    expect(review.status).toBe('complete')
    expect(review.netWorth.start).toMatchObject({ month: '2024-12', total: 400000, status: 'exact' })
    expect(review.netWorth.end).toMatchObject({ month: '2025-12', total: 460000, status: 'exact' })
    expect(review.netWorth.change).toBe(60000)
    expect(review.netWorth.changePct).toBeCloseTo(15, 10)

    expect(review.cashflow).toMatchObject({
      source: 'budget',
      income: 120000,
      expenses: 78000,
      savings: 42000,
      mismatch: null,
    })
    expect(review.cashflow.savingsRate).toBeCloseTo(35, 10)

    const { top, other } = review.spending!
    expect(top.map(g => [g.name, g.amount])).toEqual([
      ['Housing', 30000],
      ['Food', 15000],
      ['Transport', 9000],
      ['Travel', 8000],
      ['Health', 6000],
    ])
    expect(top.map(g => Math.round(g.share * 10) / 10)).toEqual([38.5, 19.2, 11.5, 10.3, 7.7])
    expect(other?.count).toBe(2)
    expect(other?.amount).toBe(10000)
    expect(other!.share).toBeCloseTo(12.82, 2)
    expect(top.reduce((s, g) => s + g.share, other!.share)).toBeCloseTo(100, 10)

    expect(review.goals).toEqual([
      {
        goalId: 12,
        name: 'Retire at 55',
        target: 2_000_000,
        startBalance: 300000,
        endBalance: 380000,
        startPct: 15,
        endPct: 19,
      },
    ])
    expect(review.notes).toEqual([])
  })

  it('W2: a negative start gives a percent relative to its size and flags startNegative', () => {
    const review = selectAnnualReview(
      makeInputs({
        accounts: makeAccounts({ nature: 'liability' }),
        balances: balancesFor(1, { '2024-12': -20000, '2025-12': -5000 }),
      }),
    )
    expect(review.netWorth.change).toBe(15000)
    expect(review.netWorth.changePct).toBeCloseTo(75, 10)
    expect(review.netWorth.startNegative).toBe(true)
    expect(review.notes).toContainEqual({ code: 'negative-start' })
  })

  it('W3: a zero start has no percent', () => {
    const review = selectAnnualReview(
      makeInputs({ accounts: makeAccounts({}), balances: balancesFor(1, { '2024-12': 0, '2025-12': 8000 }) }),
    )
    expect(review.netWorth.change).toBe(8000)
    expect(review.netWorth.changePct).toBeNull()
    expect(review.netWorth.startNegative).toBe(false)
  })

  it('W4: the first year of tracking starts at the first month with a balance', () => {
    const review = selectAnnualReview(
      makeInputs({ accounts: makeAccounts({}), balances: balancesFor(1, { '2025-03': 50000, '2025-12': 62000 }) }),
    )
    expect(review.netWorth.start).toMatchObject({ month: '2025-03', total: 50000, status: 'nearest' })
    expect(review.netWorth.end).toMatchObject({ month: '2025-12', status: 'exact' })
    expect(review.netWorth.change).toBe(12000)
    expect(review.netWorth.changePct).toBeCloseTo(24, 10)
    expect(review.notes).toEqual([{ code: 'anchor-nearest', which: 'start', month: '2025-03' }])
  })

  it('W5: a year in progress ends at the latest month and does not annualize', () => {
    const review = selectAnnualReview(
      makeInputs({
        year: 2026,
        accounts: makeAccounts({}),
        balances: balancesFor(1, { '2025-12': 460000, '2026-10': 483000 }),
        transactionsByMonth: yearOfTransactions(2026, { Paycheck: 100000, Rent: -70000 }, 10),
      }),
    )
    expect(review.status).toBe('in-progress')
    expect(review.netWorth.start).toMatchObject({ month: '2025-12', status: 'exact' })
    expect(review.netWorth.end).toMatchObject({ month: '2026-10', total: 483000, status: 'nearest' })
    expect(review.netWorth.change).toBe(23000)
    expect(review.netWorth.changePct).toBeCloseTo(5, 10)
    expect(review.cashflow).toMatchObject({ source: 'budget', income: 100000, expenses: 70000, savings: 30000 })
    expect(review.cashflow.gapMonths).toEqual([])
    expect(review.cashflow.savingsRate).toBeCloseTo(30, 10)
    expect(review.notes).toEqual([{ code: 'in-progress', throughMonth: '2026-10' }])
  })

  it('W6: the budget wins over a manual log that disagrees beyond the threshold', () => {
    const inputs = makeInputs({ transactionsByMonth: yearOfTransactions(2025, { Paycheck: 120000, ...SPEND }) })
    const review = selectAnnualReview({ ...inputs, manual: { 2025: { netIncome: 118000, savings: 40000 } } })

    expect(review.cashflow).toMatchObject({ source: 'budget', income: 120000, savings: 42000 })
    expect(review.cashflow.savingsRate).toBeCloseTo(35, 10)
    expect(review.cashflow.mismatch).toEqual({
      manualIncome: 118000,
      manualSavings: 40000,
      budgetIncome: 120000,
      budgetSavings: 42000,
    })
    expect(review.notes).toContainEqual({ code: 'mismatch' })

    const close = selectAnnualReview({ ...inputs, manual: { 2025: { netIncome: 119500, savings: 41800 } } })
    expect(close.cashflow.mismatch).toBeNull()
    expect(close.notes).not.toContainEqual({ code: 'mismatch' })
  })

  it('W7: an incomplete December reports the missing account and gives no change', () => {
    const review = selectAnnualReview(
      makeInputs({
        accounts: makeAccounts({ name: 'Checking' }, { name: '401k' }),
        balances: [
          ...balancesFor(1, { '2024-12': 80000, '2025-12': 30000 }),
          ...balancesFor(2, { '2024-12': 300000, '2025-11': 100000, '2026-01': 102000 }),
        ],
      }),
    )
    expect(review.netWorth.start).toMatchObject({ month: '2024-12', total: 380000, status: 'exact' })
    expect(review.netWorth.end).toMatchObject({
      month: '2025-12',
      total: 30000,
      status: 'incomplete',
      missing: [{ id: 2, name: '401k' }],
    })
    expect(review.netWorth.change).toBeNull()
    expect(review.netWorth.changePct).toBeNull()
    expect(review.netWorth.series[11]).toEqual({ month: '2025-12', total: 30000, complete: false })
    expect(review.notes).toEqual([
      { code: 'anchor-incomplete', which: 'end', month: '2025-12', accounts: [{ id: 2, name: '401k' }] },
    ])
  })

  it('W8: zero income gives no savings rate and an income-zero note', () => {
    const review = selectAnnualReview(makeInputs({ transactionsByMonth: yearOfTransactions(2025, { Rent: -5000 }) }))
    expect(review.cashflow).toMatchObject({ income: 0, expenses: 5000, savings: -5000, savingsRate: null })
    expect(review.notes).toEqual([{ code: 'income-zero' }])
  })

  it('W9: an overspent year has negative savings and a negative rate', () => {
    const review = selectAnnualReview(
      makeInputs({ transactionsByMonth: yearOfTransactions(2025, { Paycheck: 60000, Rent: -66000 }) }),
    )
    expect(review.cashflow).toMatchObject({ income: 60000, expenses: 66000, savings: -6000 })
    expect(review.cashflow.savingsRate).toBeCloseTo(-10, 10)
  })

  it('W10: a manual-only year uses the log and omits spending', () => {
    const review = selectAnnualReview(makeInputs({ manual: { 2025: { netIncome: 90000, savings: 18000 } } }))
    expect(review.status).toBe('complete')
    expect(review.cashflow).toMatchObject({
      source: 'manual',
      income: 90000,
      expenses: 72000,
      savings: 18000,
      mismatch: null,
    })
    expect(review.cashflow.savingsRate).toBeCloseTo(20, 10)
    expect(review.spending).toBeNull()
    expect(review.notes).toEqual([{ code: 'source-manual' }])

    const noSavings = selectAnnualReview(makeInputs({ manual: { 2025: { netIncome: 90000 } } }))
    expect(noSavings.cashflow).toMatchObject({
      source: 'manual',
      income: 90000,
      expenses: null,
      savings: null,
      savingsRate: null,
    })
  })

  it('W11: refunds reduce their group, and credit-only groups are summarized instead of listed', () => {
    const tx = yearOfTransactions(2025, { Paycheck: 120000, ...SPEND, Presents: 300 })
    tx['2025-01'].push({ date: '2025-01-20', category: 'Flights', amount: 500 })
    const review = selectAnnualReview(makeInputs({ transactionsByMonth: tx }))

    const { top, other, refundOnlyTotal } = review.spending!
    expect(top.find(g => g.name === 'Travel')?.amount).toBe(7500)
    expect(top.map(g => g.name)).not.toContain('Gifts')
    expect(refundOnlyTotal).toBe(300)
    expect(top[0].share).toBeCloseTo((30000 / 77500) * 100, 10)
    expect(other).toMatchObject({ count: 2, amount: 10000 })
    expect(review.cashflow).toMatchObject({ income: 120000, expenses: 77200, savings: 42800 })
    expect(review.cashflow.savingsRate).toBeCloseTo(35.7, 1)
    expect(review.notes).toEqual([{ code: 'refund-groups', amount: 300 }])
  })

  it('W12: an empty year has no anchors and no cashflow source', () => {
    const review = selectAnnualReview(makeInputs({ year: 2024 }))
    expect(review.status).toBe('empty')
    expect(review.netWorth.start.status).toBe('missing')
    expect(review.netWorth.end.status).toBe('missing')
    expect(review.cashflow.source).toBe('none')
    expect(review.spending).toBeNull()
    expect(review.goals).toEqual([])
    expect(review.notes).toEqual([])
    expect(review.prior).toBeNull()
  })

  it('W13: an inactive account is not expected after its last entry', () => {
    const review = selectAnnualReview(
      makeInputs({
        accounts: makeAccounts({ name: 'A' }, { name: 'X', status: 'inactive' }),
        balances: [
          ...balancesFor(1, { '2024-12': 1000, '2025-03': 1100, '2025-12': 1500 }),
          ...balancesFor(2, { '2024-12': 200, '2025-03': 250 }),
        ],
      }),
    )
    expect(review.netWorth.end).toMatchObject({ month: '2025-12', total: 1500, status: 'exact', missing: [] })
    expect(review.netWorth.start).toMatchObject({ total: 1200, status: 'exact' })
    expect(review.netWorth.change).toBe(300)
  })
})

describe('selectAnnualReview behavior', () => {
  it('treats a year after the current year as empty even when data exists', () => {
    const review = selectAnnualReview(
      makeInputs({
        year: 2027,
        accounts: makeAccounts({}),
        balances: balancesFor(1, { '2026-12': 1, '2027-12': 2 }),
        manual: { 2027: { netIncome: 1 } },
      }),
    )
    expect(review.status).toBe('empty')
    expect(review.cashflow.source).toBe('none')
  })

  it('treats the current year with no data as empty', () => {
    expect(selectAnnualReview(makeInputs({ year: 2026 })).status).toBe('empty')
  })

  it('reports in-progress through the latest transaction month when there are no balances', () => {
    const review = selectAnnualReview(
      makeInputs({ year: 2026, transactionsByMonth: yearOfTransactions(2026, { Paycheck: 10 }, 4) }),
    )
    expect(review.notes).toContainEqual({ code: 'in-progress', throughMonth: '2026-04' })
  })

  it('reports in-progress through the current month when nothing else names a month', () => {
    const review = selectAnnualReview(makeInputs({ year: 2026, manual: { 2026: { netIncome: 5 } } }))
    expect(review.notes).toContainEqual({ code: 'in-progress', throughMonth: '2026-11' })
  })

  it('shows a single-month note and no change when only one month of balances exists', () => {
    const review = selectAnnualReview(
      makeInputs({ accounts: makeAccounts({}), balances: balancesFor(1, { '2025-03': 50000 }) }),
    )
    expect(review.netWorth.change).toBeNull()
    expect(review.notes).toEqual([{ code: 'single-month' }])
  })

  it('shows a single-month note when December is the only month and the start falls back to it', () => {
    const review = selectAnnualReview(
      makeInputs({ accounts: makeAccounts({}), balances: balancesFor(1, { '2025-12': 50000 }) }),
    )
    expect(review.netWorth.start).toMatchObject({ month: '2025-12', status: 'nearest' })
    expect(review.netWorth.change).toBeNull()
    expect(review.notes).toEqual([{ code: 'single-month' }])
  })

  it('names the start month when the start anchor is nearest and the end is exact', () => {
    const review = selectAnnualReview(
      makeInputs({
        accounts: makeAccounts({}),
        balances: balancesFor(1, { '2024-06': 10, '2025-12': 30 }),
      }),
    )
    expect(review.netWorth.start).toMatchObject({ month: '2024-06', status: 'nearest' })
    expect(review.notes).toEqual([{ code: 'anchor-nearest', which: 'start', month: '2024-06' }])
  })

  it('names the end month when December is absent in a past year', () => {
    const review = selectAnnualReview(
      makeInputs({ accounts: makeAccounts({}), balances: balancesFor(1, { '2024-12': 10, '2025-09': 30 }) }),
    )
    expect(review.netWorth.end).toMatchObject({ month: '2025-09', status: 'nearest' })
    expect(review.notes).toEqual([{ code: 'anchor-nearest', which: 'end', month: '2025-09' }])
  })

  it('emits notes for partial budgets and unreadable files in a stable order', () => {
    const tx = yearOfTransactions(2025, { Paycheck: 1000, Rent: -400 })
    delete tx['2025-05']
    delete tx['2025-06']
    const review = selectAnnualReview(makeInputs({ transactionsByMonth: tx, unreadableMonths: ['2025-06'] }))
    expect(review.cashflow.source).toBe('budget-partial')
    expect(review.notes).toEqual([
      { code: 'budget-partial', gapMonths: ['2025-05', '2025-06'], covered: 10, expected: 12 },
      { code: 'unreadable', months: ['2025-06'] },
    ])
  })

  it('flags uncategorized spending at 20 percent or more of positive spend', () => {
    const review = selectAnnualReview(
      makeInputs({ transactionsByMonth: yearOfTransactions(2025, { Paycheck: 500, Rent: -75, Uncategorized: -25 }) }),
    )
    expect(review.spending!.uncategorizedShare).toBeCloseTo(25, 10)
    expect(review.notes).toEqual([{ code: 'uncategorized', share: 25 }])
  })

  it('lists goals created in or before the review year, treats an unparseable creation month as existing', () => {
    vi.mocked(getFiTarget).mockReturnValue(1000)
    const review = selectAnnualReview(
      makeInputs({
        accounts: makeAccounts({ goalType: 'fi' }),
        balances: balancesFor(1, { '2024-12': 100, '2025-12': 2000 }),
        goals: [
          makeGoal({ id: 1, goalCreatedIn: '2025-12' }),
          makeGoal({ id: 2, goalCreatedIn: '2026-01' }),
          makeGoal({ id: 3, goalCreatedIn: 'sometime' }),
        ],
      }),
    )
    expect(review.goals.map(g => g.goalId)).toEqual([1, 3])
    expect(review.goals[0]).toMatchObject({ startPct: 10, endPct: 100 })
    const createdIn = vi.mocked(getFiTarget).mock.calls.map(([g]) => g.goalCreatedIn)
    expect(createdIn).toContain('2025')
    expect(createdIn).not.toContain('sometime')
  })

  it('shows goals with unavailable progress when anchors are missing', () => {
    vi.mocked(getFiTarget).mockReturnValue(1000)
    const review = selectAnnualReview(
      makeInputs({ manual: { 2025: { netIncome: 5 } }, goals: [makeGoal({ id: 1, goalCreatedIn: '2024' })] }),
    )
    expect(review.goals).toEqual([
      expect.objectContaining({ startBalance: null, endBalance: null, startPct: null, endPct: null }),
    ])
  })

  it('summarizes the prior year one level deep', () => {
    const review = selectAnnualReview(
      makeInputs({
        accounts: makeAccounts({}),
        balances: balancesFor(1, { '2023-12': 100, '2024-12': 150, '2025-12': 300 }),
        transactionsByMonth: {
          ...yearOfTransactions(2024, { Paycheck: 1000, Rent: -600 }),
          ...yearOfTransactions(2025, { Paycheck: 2000, Rent: -1000 }),
        },
      }),
    )
    expect(review.netWorth.change).toBe(150)
    expect(review.prior).toEqual({ netWorthChange: 50, income: 1000, expenses: 600, savingsRate: 40 })
  })

  it('hides the prior year when it is empty', () => {
    const review = selectAnnualReview(makeInputs({ manual: { 2025: { netIncome: 5 } } }))
    expect(review.prior).toBeNull()
  })

  it('reads only the year and month of today', () => {
    const a = selectAnnualReview(makeInputs({ today: new Date(2026, 10, 8, 23, 59) }))
    const b = selectAnnualReview(makeInputs({ today: TODAY }))
    expect(a).toEqual(b)
  })
})
