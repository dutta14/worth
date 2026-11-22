import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import SavingsGrowthTracker from '../../tools/components/SavingsGrowthTracker'
import { FileStoreTestProvider } from '../../../test/fileStoreTestUtils'
import { balancesFor, GROUPS, makeAccounts, makeInputs } from '../../../test/reviewFixtures'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { loadBudgetStore } from '../../budget/utils/budgetStorage'
import { parseCSV } from '../../budget/utils/csvParser'
import type { Transaction } from '../../budget/types'
import { formatMoney } from './format'
import { selectAnnualReview } from './selectAnnualReview'

const { mockUseData } = vi.hoisted(() => ({ mockUseData: vi.fn() }))
vi.mock('../../../contexts/DataContext', () => ({ useData: () => mockUseData() }))

const accounts = makeAccounts({ goalType: 'fi' }, { goalType: 'gw' })
const balances = [
  ...balancesFor(1, { '2024-12': 300000, '2025-12': 380000 }),
  ...balancesFor(2, { '2024-12': 100000, '2025-12': 80000 }),
]
const ROWS = [
  ['Date', 'Category', 'Amount'],
  ['2025-01-15', 'Paycheck', '120000'],
  ['2025-01-16', 'Rent', '-30000'],
  ['2025-02-01', 'Groceries', '-15000'],
  ['2025-02-02', 'Fuel', '-9000'],
  ['2025-03-03', 'Flights', '-8000'],
  ['2025-03-04', 'Doctor', '-6000'],
  ['2025-04-05', 'Clothes', '-5000'],
  ['2025-04-06', 'Movies', '-5000'],
]

describe('Annual Review and Growth tab parity (M-2)', () => {
  it('shows the same net worth, income, expenses and savings when no refund or orphan edge cases apply', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON('budget/categories.json', { version: 1, years: [2025], categoryGroups: GROUPS })
    const byMonth = new Map<string, string[][]>()
    for (const row of ROWS.slice(1)) {
      const key = row[0].slice(0, 7)
      byMonth.set(key, [...(byMonth.get(key) ?? [ROWS[0]]), row])
    }
    for (const [key, rows] of byMonth) await store.writeCSV(`transactions/2025/${key}.csv`, rows)
    // The Growth tab reads every month the same way, so give it complete coverage too
    for (let m = 5; m <= 12; m++) {
      await store.writeCSV(`transactions/2025/2025-${String(m).padStart(2, '0')}.csv`, [ROWS[0]])
    }

    const budgetStore = await loadBudgetStore(store)
    const transactionsByMonth: Record<string, Transaction[]> = {}
    for (const [key, csv] of Object.entries(budgetStore.csvs)) transactionsByMonth[key] = parseCSV(csv.csv)
    const review = selectAnnualReview(
      makeInputs({ accounts, balances, transactionsByMonth, categoryGroups: budgetStore.categoryGroups ?? [] }),
    )

    mockUseData.mockReturnValue({ accounts, balances, allMonths: [], setAccounts: vi.fn(), setBalances: vi.fn() })
    render(
      <FileStoreTestProvider store={store}>
        <MemoryRouter initialEntries={['/net-worth/growth/savings']}>
          <SavingsGrowthTracker />
        </MemoryRouter>
      </FileStoreTestProvider>,
    )

    const card = await screen.findByTestId('year-card-2025')
    const field = (name: string) => card.querySelector(`[data-sgt-field="${name}"]`)?.textContent
    await waitFor(() => expect(field('expense')).toBe(formatMoney(review.cashflow.expenses)))

    expect(review.cashflow).toMatchObject({ income: 120000, expenses: 78000, savings: 42000 })
    expect(field('netWorth')).toBe(formatMoney(review.netWorth.end.total))
    expect(field('netIncome')).toBe(formatMoney(review.cashflow.income))
    expect(field('expense')).toBe(formatMoney(review.cashflow.expenses))
    expect(field('savings')).toBe(formatMoney(review.cashflow.savings))
    // Growth is its own net worth change minus savings, so it ties the two net worth changes together
    expect(field('growth')).toBe(formatMoney(review.netWorth.change! - review.cashflow.savings!))
  })
})
