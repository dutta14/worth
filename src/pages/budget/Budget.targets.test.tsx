import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Budget from './Budget'
import type { BudgetViewMode, CategoryGroup, SpreadsheetMode } from './types'
import { FileStoreContext } from '../../contexts/FileStoreContext'
import type { FileStoreContextValue } from '../../contexts/FileStoreContext'
import { FlagContext } from '../../flags/FlagContext'
import type { FlagContextValue } from '../../flags/FlagContext'
import { MemoryFileStore } from '../../utils/memoryFileStore'
import { TARGETS_PATH } from './utils/budgetTargetsStorage'

const diningGroups: CategoryGroup[] = [
  { id: 'dining', name: 'Dining', categories: ['Restaurants'] },
  { id: 'others', name: 'Others', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: [] },
]

const mockUseBudget = {
  selectedYear: 2026,
  setSelectedYear: vi.fn(),
  viewMode: 'spreadsheet' as BudgetViewMode,
  setViewMode: vi.fn(),
  spreadsheetMode: 'aggregated' as SpreadsheetMode,
  setSpreadsheetMode: vi.fn(),
  uploadCSV: vi.fn(),
  removeCSV: vi.fn(),
  createYear: vi.fn(),
  updateCategoryGroups: vi.fn(),
  updateIncomeCategoryGroups: vi.fn(),
  mergeCategories: vi.fn(),
  editCategory: vi.fn(),
  categoryHasTransactions: vi.fn(() => false),
  deleteCategory: vi.fn(),
  addTransaction: vi.fn(),
  years: [2025, 2026],
  yearTransactions: { '2026-06': [{ date: '2026-06-10', category: 'Restaurants', amount: -620 }] },
  categoryGroups: diningGroups,
  incomeCategoryGroups: [{ id: 'income-others', name: 'Work', categories: ['Salary'], type: 'income' as const }],
  removedCategories: new Set<string>(),
  incomeRemovedCategories: new Set<string>(),
  incomeCatSet: new Set<string>(),
  categorySums: { Restaurants: { '2026-06': -620 }, Salary: { '2026-06': 5000 } },
  summary: { totalIncome: 5000, totalExpense: 620, saveRate: 0 },
  monthsWithData: new Set(['2026-06']),
  loaded: true,
}

vi.mock('./hooks/useBudget', () => ({ useBudget: () => mockUseBudget }))

vi.mock('./hooks/useCSVUpload', () => ({
  useCSVUpload: () => ({
    csvPreview: null,
    toastMsg: null,
    quickUploadRef: { current: null },
    bulkUploadRef: { current: null },
    handleQuickUpload: vi.fn(),
    handleBulkUpload: vi.fn(),
    handlePreviewConfirm: vi.fn(),
    handlePreviewCancel: vi.fn(),
  }),
}))

vi.mock('../tools/components/PdfToCsv', () => ({ default: () => <div /> }))
vi.mock('./components/BudgetSummary', () => ({ default: () => <div /> }))
vi.mock('./components/BudgetTable', () => ({ default: () => <div data-testid="budget-table" /> }))
vi.mock('./components/CategoryGroupManager', () => ({ default: () => <div /> }))
vi.mock('./components/CashflowBarChart', () => ({ default: () => <div /> }))
vi.mock('./components/CashflowSankey', () => ({ default: () => <div /> }))

let store: MemoryFileStore

const renderBudget = (flagOn: boolean) =>
  render(
    <FlagContext.Provider value={{ resolveFlag: () => flagOn } as unknown as FlagContextValue}>
      <FileStoreContext.Provider value={{ fileStore: store, isReady: true } as unknown as FileStoreContextValue}>
        <MemoryRouter initialEntries={['/budget/spreadsheet']}>
          <Budget />
        </MemoryRouter>
      </FileStoreContext.Provider>
    </FlagContext.Provider>,
  )

const headers = () => screen.getAllByRole('columnheader').map(h => h.textContent)

beforeEach(() => {
  localStorage.clear()
  store = new MemoryFileStore()
  mockUseBudget.spreadsheetMode = 'aggregated'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 18))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Budget with the category-budget-targets flag off', () => {
  it('renders the original aggregated table with no target columns, elements or live region', () => {
    const { container } = renderBudget(false)

    expect(headers()).toEqual(['Group', ...'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' '), 'Total'])
    expect(container.innerHTML).not.toContain('budget-target')
    expect(screen.queryByRole('button', { name: /monthly target/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('never reads, subscribes to or writes budget/targets.json', async () => {
    await store.writeJSON(TARGETS_PATH, { version: 1, groups: {} })
    const exists = vi.spyOn(store, 'exists')
    const readJSON = vi.spyOn(store, 'readJSON')
    const subscribe = vi.spyOn(store, 'subscribe')
    const writeJSON = vi.spyOn(store, 'writeJSON')

    renderBudget(false)
    await Promise.resolve()

    expect(exists).not.toHaveBeenCalled()
    expect(readJSON).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(writeJSON).not.toHaveBeenCalled()
  })
})

describe('Budget with the category-budget-targets flag on', () => {
  it('adds the columns once targets have loaded', async () => {
    renderBudget(true)

    expect(await screen.findByRole('columnheader', { name: 'Vs target' })).toBeInTheDocument()
    expect(headers().slice(-3)).toEqual(['Total', 'Monthly target', 'Vs target'])
  })

  it('shows a stored target with its verdict', async () => {
    await store.writeJSON(TARGETS_PATH, {
      version: 1,
      groups: { dining: { label: 'Dining', history: [{ from: null, monthly: 500 }] } },
    })
    renderBudget(true)

    const row = await screen.findByRole('row', { name: /^Dining/ })
    expect(within(row).getByRole('button', { name: 'Dining monthly target $500, edit' })).toBeInTheDocument()
    expect(within(row).getAllByText('$120 over')).toHaveLength(2) // June period cell and Vs target
  })

  it('sets a target from the keyboard, announces it and persists it', async () => {
    const user = userEvent.setup()
    renderBudget(true)

    await user.click(await screen.findByRole('button', { name: 'Set monthly target for Dining' }))
    await user.keyboard('500{Enter}')

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dining target set to $500 a month.'))
    expect(screen.getByRole('button', { name: 'Dining monthly target $500, edit' })).toHaveFocus()
    expect(await store.readJSON(TARGETS_PATH, null)).toEqual({
      version: 1,
      groups: { dining: { label: 'Dining', history: [{ from: null, monthly: 500 }] } },
    })
    expect(
      within(screen.getByRole('row', { name: /^Dining/ }))
        .getAllByRole('cell')
        .at(-1),
    ).toHaveTextContent('$120 over')
  })

  it('reverts and shows the save error when the write fails', async () => {
    const user = userEvent.setup()
    renderBudget(true)
    await user.click(await screen.findByRole('button', { name: 'Set monthly target for Dining' }))
    vi.spyOn(store, 'writeJSON').mockRejectedValue(new Error('disk gone'))
    await user.keyboard('500{Enter}')

    expect(
      await screen.findAllByText("Couldn't save the target. Check that your data folder is still available."),
    ).not.toHaveLength(0)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Set monthly target for Dining' })).toBeInTheDocument()
  })

  it('shows the alert and disables editing when the file is unreadable, leaving the file untouched', async () => {
    await store.writeJSON(TARGETS_PATH, { version: 2, groups: {} })
    const writeJSON = vi.spyOn(store, 'writeJSON')
    renderBudget(true)

    expect(await screen.findByRole('alert')).toHaveTextContent('Your targets file couldn')
    expect(screen.getByRole('button', { name: 'Set monthly target for Dining' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(writeJSON).not.toHaveBeenCalled()
  })

  it('leaves the Income tab without target columns', async () => {
    const user = userEvent.setup()
    renderBudget(true)
    await screen.findByRole('columnheader', { name: 'Vs target' })

    await user.click(screen.getByRole('button', { name: 'Income' }))

    expect(screen.queryByRole('columnheader', { name: 'Vs target' })).not.toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('leaves the Detailed view alone', async () => {
    mockUseBudget.spreadsheetMode = 'detailed'
    renderBudget(true)

    expect(await screen.findByTestId('budget-table')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Vs target' })).not.toBeInTheDocument()
  })
})
