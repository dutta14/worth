import type { Page } from '@playwright/test'
import { balanceEntriesToEntries, goalsToEntry, seedFileStore } from './seed-filestore'
import type { SeedEntry } from './seed-filestore'

/**
 * Annual Review (docs/specs/annual-review.md, section 7.4). The clock is pinned to 2026-11-18.
 *
 * 2025 (the default year, newest December with balances)
 *   Net worth  Dec 2024 160,000 -> Dec 2025 220,000: change +60,000 (37.5%); Dec 2023 was 110,000
 *   Income     10,000 a month, 12 months                     = 120,000
 *   Expenses   Housing 36,000, Food 12,000, Dining 6,000, Transport 3,600, Health 2,400, Travel 2,000 = 62,000
 *   Savings    58,000, a rate of 48.3%
 */
export const NOW = new Date('2026-11-18T12:00:00Z')

export const ACCOUNTS = [
  {
    id: 1,
    name: '401(k)',
    type: 'retirement',
    owner: 'primary',
    status: 'active',
    goalType: 'fi',
    nature: 'asset',
    allocation: 'us-stock',
    institution: 'Fidelity',
    group: 'Retirement',
  },
  {
    id: 2,
    name: 'Brokerage',
    type: 'non-retirement',
    owner: 'joint',
    status: 'active',
    goalType: 'fi',
    nature: 'asset',
    allocation: 'us-stock',
    institution: 'Schwab',
    group: 'Taxable',
  },
  {
    id: 3,
    name: 'Savings',
    type: 'liquid',
    owner: 'joint',
    status: 'active',
    goalType: 'gw',
    nature: 'asset',
    allocation: 'cash',
    institution: 'Marcus',
    group: 'Cash',
  },
]

export const GOAL = {
  id: 1,
  goalName: 'Early Retirement',
  createdAt: '2020-01-15T00:00:00.000Z',
  birthday: '1992-03-15',
  goalCreatedIn: '2020-01',
  goalEndYear: '2050',
  resetExpenseMonth: false,
  retirementAge: 50,
  expenseMonth: 1,
  expenseValue: 60000,
  monthlyExpenseValue: 5000,
  expenseValueMar2026: 63600,
  expenseValue2047: 109272,
  monthlyExpense2047: 9106,
  safeWithdrawalRate: 3.5,
  growth: 8,
  retirement: '2042-03',
  fiGoal: 3428571,
  progress: 42,
}

const GROUPS = [
  { id: 'housing', name: 'Housing', categories: ['Rent'] },
  { id: 'food', name: 'Food', categories: ['Groceries'] },
  { id: 'dining', name: 'Dining', categories: ['Restaurants'] },
  { id: 'transport', name: 'Transport', categories: ['Gas'] },
  { id: 'health', name: 'Health', categories: ['Doctor'] },
  { id: 'travel', name: 'Travel', categories: ['Flights'] },
  { id: 'income-others', name: 'Income', categories: ['Salary'], type: 'income' },
  { id: 'others', name: 'Others', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: [] },
]

type Row = [number, string, number]

const monthCsv = (month: string, rows: Row[]): SeedEntry => ({
  path: `transactions/${month.slice(0, 4)}/${month}.csv`,
  type: 'csv',
  data: [
    ['Date', 'Category', 'Amount'],
    ...rows.map(([day, category, amount]) => [`${month}-${String(day).padStart(2, '0')}`, category, String(amount)]),
  ],
})

const MONTHLY: Row[] = [
  [1, 'Salary', 10000],
  [2, 'Rent', -3000],
  [5, 'Groceries', -1000],
  [8, 'Restaurants', -500],
  [10, 'Gas', -300],
  [15, 'Doctor', -200],
]

const FULL_YEAR_2025: SeedEntry[] = Array.from({ length: 12 }, (_, i) => {
  const month = `2025-${String(i + 1).padStart(2, '0')}`
  return monthCsv(month, month === '2025-07' ? [...MONTHLY, [20, 'Flights', -2000]] : MONTHLY)
})

export const CATEGORIES: SeedEntry = {
  path: 'budget/categories.json',
  type: 'json',
  data: { version: 1, years: [2025], categoryGroups: GROUPS },
}

type Balance = { month: string; accountId: number; balance: number }

const entry = (month: string, balances: [number, number, number]): Balance[] =>
  balances.map((balance, i) => ({ month, accountId: i + 1, balance }))

export const BALANCES: Balance[] = [
  ...entry('2023-12', [70000, 30000, 10000]),
  ...entry('2024-12', [95000, 45000, 20000]),
  ...entry('2025-06', [110000, 55000, 22000]),
  ...entry('2025-12', [125000, 70000, 25000]),
  ...entry('2026-10', [130000, 72000, 26000]),
]

interface SeedOptions {
  balances?: Balance[]
  extra?: SeedEntry[]
  includeTransactions?: boolean
  darkMode?: boolean
  withGoal?: boolean
}

/** Seeds the file store once per tab (edits survive a reload), and pins the clock. */
export async function seedAnnualReview(
  page: Page,
  { balances = BALANCES, extra = [], includeTransactions = true, darkMode = false, withGoal = true }: SeedOptions = {},
) {
  const entries: SeedEntry[] = [
    { path: 'accounts.json', type: 'json', data: ACCOUNTS },
    ...balanceEntriesToEntries(balances),
    ...(withGoal ? [goalsToEntry([GOAL])] : []),
    ...(includeTransactions ? [CATEGORIES, ...FULL_YEAR_2025] : []),
    ...extra,
  ]
  await seedFileStore(page, entries, { onceKey: 'review-e2e-seeded' })
  await page.addInitScript(
    ({ darkMode }) => {
      if (sessionStorage.getItem('review-e2e-init') !== '1') {
        localStorage.clear()
        sessionStorage.setItem('review-e2e-init', '1')
      }
      localStorage.setItem('_e2eMode', '1')
      localStorage.setItem('encryption-enabled', '0')
      localStorage.setItem('darkMode', darkMode ? '1' : '0')
    },
    { darkMode },
  )
  await page.clock.setFixedTime(NOW)
}

/** Nothing in the folder at all: the first-time state. */
export async function seedEmptyReview(page: Page) {
  await seedFileStore(page, [], { onceKey: 'review-e2e-seeded' })
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('_e2eMode', '1')
    localStorage.setItem('encryption-enabled', '0')
  })
  await page.clock.setFixedTime(NOW)
}
