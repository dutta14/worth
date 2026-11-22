import type { GrowthSettings } from '../hooks/useGrowthSettings'
import type { CategoryGroup, Transaction } from '../pages/budget/types'
import type { Account, BalanceEntry } from '../pages/data/types'
import type { ReviewInputs } from '../pages/review/types'
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
