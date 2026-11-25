import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Budget from './Budget'
import { emptyStore } from '../../test/importHelpers'
import type { BudgetViewMode, SpreadsheetMode } from './types'

const mockUseBudget = {
  store: emptyStore(),
  commitImport: vi.fn(),
  undoImport: vi.fn(),
  selectedYear: 2025,
  setSelectedYear: vi.fn(),
  viewMode: 'spreadsheet' as BudgetViewMode,
  setViewMode: vi.fn(),
  spreadsheetMode: 'aggregated' as SpreadsheetMode,
  setSpreadsheetMode: vi.fn(),
  removeCSV: vi.fn(),
  updateCategoryGroups: vi.fn(),
  updateIncomeCategoryGroups: vi.fn(),
  mergeCategories: vi.fn(),
  categoryTransactionCounts: new Map<string, number>(),
  deleteCategory: vi.fn(),
  addTransaction: vi.fn(),
  years: [2024, 2025],
  yearTransactions: {} as Record<string, unknown[]>,
  categoryGroups: [],
  incomeCategoryGroups: [],
  removedCategories: new Set<string>(),
  incomeRemovedCategories: new Set<string>(),
  incomeCatSet: new Set<string>(),
  categorySums: {},
  summary: { totalIncome: 0, totalExpense: 0, saveRate: 0 },
  monthsWithData: new Set<string>(),
}

vi.mock('./hooks/useBudget', () => ({ useBudget: () => mockUseBudget }))

vi.mock('../tools/components/PdfToCsv', () => ({
  default: ({ onUseInWizard }: { onUseInWizard: (csv: string) => void }) => (
    <button onClick={() => onUseInWizard('Date,Category,Amount,Description\n2025-01-02,Dining,-6.75,Cafe')}>
      use-in-wizard
    </button>
  ),
}))
vi.mock('./components/BudgetSummary', () => ({ default: () => <div /> }))
vi.mock('./components/ManualTransactionEntry', () => ({ default: () => <div /> }))
vi.mock('./components/BudgetTable', () => ({
  default: ({ onImportCSV }: { onImportCSV: () => void }) => <button onClick={onImportCSV}>table-import</button>,
}))
vi.mock('./components/BudgetAggregatedView', () => ({ default: () => <div /> }))
vi.mock('./components/CategoryGroupManager', () => ({ default: () => <div /> }))
vi.mock('./components/CashflowBarChart', () => ({ default: () => <div /> }))
vi.mock('./components/CashflowSankey', () => ({ default: () => <div /> }))

const renderBudget = (route = '/budget/spreadsheet') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Budget />
    </MemoryRouter>,
  )

beforeEach(() => {
  localStorage.clear()
  mockUseBudget.yearTransactions = { '2025-01': [{ date: '2025-01-15', category: 'Salary', amount: 5000 }] }
  mockUseBudget.monthsWithData = new Set(['2025-01'])
  mockUseBudget.spreadsheetMode = 'aggregated'
})

describe('Budget import wizard entry points', () => {
  it('offers the wizard entry points in the more actions menu', async () => {
    const user = userEvent.setup()
    renderBudget()
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Import CSV…' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Import several CSVs…' })).toBeInTheDocument()
  })

  it('opens the single-file picker from Import CSV…', async () => {
    const user = userEvent.setup()
    renderBudget()
    const input = screen.getByTestId('import-wizard-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import CSV…' }))
    expect(click).toHaveBeenCalledOnce()
    expect(input.multiple).toBe(false)
  })

  it('opens the multi-file picker from Import several CSVs…', async () => {
    const user = userEvent.setup()
    renderBudget()
    const input = screen.getByTestId('import-wizard-input') as HTMLInputElement
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import several CSVs…' }))
    expect(input.multiple).toBe(true)
  })

  it('opens the picker from the empty-year Import CSV button on any view', async () => {
    const user = userEvent.setup()
    mockUseBudget.yearTransactions = {}
    mockUseBudget.monthsWithData = new Set<string>()
    renderBudget('/budget/cashflow')
    const input = screen.getByTestId('import-wizard-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await user.click(screen.getByRole('button', { name: 'Import CSV' }))
    expect(click).toHaveBeenCalledOnce()
  })

  it('opens the wizard from the table month menu callback (E4)', async () => {
    const user = userEvent.setup()
    mockUseBudget.spreadsheetMode = 'detailed'
    renderBudget()
    const input = screen.getByTestId('import-wizard-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await user.click(screen.getByRole('button', { name: 'table-import' }))
    expect(click).toHaveBeenCalledOnce()
  })

  it('hands the PDF tool output to the wizard and closes the PDF modal (E6)', async () => {
    const user = userEvent.setup()
    localStorage.setItem('lab-pdf-to-csv', '1')
    renderBudget()
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'PDF → CSV' }))
    await user.click(await screen.findByRole('button', { name: 'use-in-wizard' }))
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'PDF → CSV' })).not.toBeInTheDocument()
  })
})
