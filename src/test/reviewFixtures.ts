import type { GrowthSettings } from '../hooks/useGrowthSettings'
import type { CategoryGroup, Transaction } from '../pages/budget/types'
import type { Account, BalanceEntry } from '../pages/data/types'
import type { AnnualReview, ReviewInputs } from '../pages/review/types'
import { makeAccount, makeTransaction } from './factories'

/** 2026-11-08, the date the spec's worked examples assume. */
export const TODAY = new Date(2026, 10, 8)

export const GROWTH: GrowthSettings = {
  preBoundaryGrowth: 8,
  postBoundaryGrowth: 6,
  ageBoundary: 60,
  gwGrowth: 8,
  inflation: 3,
  retirementCap: 6000,
  nonRetirementBase: 6000,
  primaryRetirementAccessAge: 59.5,
  partnerRetirementAccessAge: 59.5,
}

export const GROUPS: CategoryGroup[] = [
  { id: 'housing', name: 'Housing', categories: ['Rent'] },
  { id: 'food', name: 'Food', categories: ['Groceries'] },
  { id: 'transport', name: 'Transport', categories: ['Fuel'] },
  { id: 'travel', name: 'Travel', categories: ['Flights'] },
  { id: 'health', name: 'Health', categories: ['Doctor'] },
  { id: 'shopping', name: 'Shopping', categories: ['Clothes'] },
  { id: 'entertainment', name: 'Entertainment', categories: ['Movies'] },
  { id: 'gifts', name: 'Gifts', categories: ['Presents'] },
  { id: 'others', name: 'Others', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: ['Transfer'] },
  { id: 'salary', name: 'Salary', categories: ['Paycheck'], type: 'income' },
  { id: 'income-others', name: 'Others', categories: [], type: 'income' },
]

export const makeAccounts = (...specs: Partial<Account>[]): Account[] =>
  specs.map((s, i) => makeAccount({ id: i + 1, name: `Account ${i + 1}`, ...s }))

let balanceId = 0
/** Balance entries for one account: `{ '2025-12': 460000 }` */
export const balancesFor = (accountId: number, byMonth: Record<string, number>): BalanceEntry[] =>
  Object.entries(byMonth).map(([month, balance]) => ({ id: ++balanceId, accountId, month, balance }))

/**
 * Twelve readable CSV months for `year`. Each category's annual amount goes in January and
 * the other months are present but empty, so every month counts as covered.
 */
export const yearOfTransactions = (
  year: number,
  amounts: Record<string, number>,
  months = 12,
): Record<string, Transaction[]> => {
  const result: Record<string, Transaction[]> = {}
  for (let m = 1; m <= months; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`
    result[key] =
      m === 1
        ? Object.entries(amounts).map(([category, amount]) => makeTransaction({ date: `${key}-15`, category, amount }))
        : []
  }
  return result
}

export const makeInputs = (overrides: Partial<ReviewInputs> = {}): ReviewInputs => ({
  year: 2025,
  today: TODAY,
  accounts: [],
  balances: [],
  transactionsByMonth: {},
  unreadableMonths: [],
  categoryGroups: GROUPS,
  manual: {},
  goals: [],
  profileBirthday: '1990-01',
  growth: GROWTH,
  ...overrides,
})

/** December 2024 and 2025 are the only months with data unless overridden. */
export const makeSeries = (year: number, totals: Record<number, number | null> = {}, incomplete: number[] = []) =>
  Array.from({ length: 12 }, (_, i) => ({
    month: `${year}-${String(i + 1).padStart(2, '0')}`,
    total: totals[i + 1] ?? null,
    complete: totals[i + 1] != null && !incomplete.includes(i + 1),
  }))

/** The W1 review (a clean 2025) as the selector would return it; override any section. */
export const makeReview = (overrides: Partial<AnnualReview> = {}): AnnualReview => ({
  year: 2025,
  status: 'complete',
  netWorth: {
    start: { month: '2024-12', total: 400000, status: 'exact', missing: [] },
    end: { month: '2025-12', total: 460000, status: 'exact', missing: [] },
    change: 60000,
    changePct: 15,
    startNegative: false,
    series: makeSeries(2025, { 1: 405000, 6: 430000, 12: 460000 }),
  },
  cashflow: {
    source: 'budget',
    income: 120000,
    expenses: 78000,
    savings: 42000,
    savingsRate: 35,
    monthsCovered: Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`),
    gapMonths: [],
    unreadableMonths: [],
    mismatch: null,
  },
  spending: {
    top: [
      { id: 'housing', name: 'Housing', amount: 30000, share: 38.46 },
      { id: 'food', name: 'Food', amount: 15000, share: 19.23 },
      { id: 'transport', name: 'Transport', amount: 9000, share: 11.54 },
      { id: 'travel', name: 'Travel', amount: 8000, share: 10.26 },
      { id: 'health', name: 'Health', amount: 6000, share: 7.69 },
    ],
    other: { count: 2, amount: 10000, share: 12.82 },
    refundOnlyTotal: 0,
    uncategorizedShare: null,
  },
  goals: [
    {
      goalId: 12,
      name: 'Retire at 55',
      target: 2_000_000,
      startBalance: 300000,
      endBalance: 380000,
      endGwBalance: 80000,
      startPct: 15,
      endPct: 19,
    },
  ],
  skippedGoals: 0,
  notes: [],
  prior: null,
  ...overrides,
})
