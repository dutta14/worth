import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Budget from './Budget'
import { FlagContext, type FlagContextValue } from '../../flags/FlagContext'
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
  uploadCSV: vi.fn(),
  removeCSV: vi.fn(),
  updateCategoryGroups: vi.fn(),
  updateIncomeCategoryGroups: vi.fn(),
  mergeCategories: vi.fn(),
  categoryHasTransactions: vi.fn(() => false),
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

vi.mock('./hooks/useCSVUpload', () => ({
  useCSVUpload: () => ({
    csvPreview: { csv: 'Date,Category,Amount\n2025-01-01,A,-1', monthKey: '2025-01' },
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
vi.mock('./components/ManualTransactionEntry', () => ({ default: () => <div /> }))
vi.mock('./components/BudgetTable', () => ({ default: () => <div /> }))
vi.mock('./components/BudgetAggregatedView', () => ({ default: () => <div /> }))
vi.mock('./components/CategoryGroupManager', () => ({ default: () => <div /> }))
vi.mock('./components/CSVPreviewModal', () => ({ default: () => <div data-testid="csv-preview-modal" /> }))
vi.mock('./components/CashflowBarChart', () => ({ default: () => <div /> }))
vi.mock('./components/CashflowSankey', () => ({ default: () => <div /> }))

const flagValue = (importWizard: boolean): FlagContextValue => ({
  resolveFlag: ((flag: { id: string; default: unknown }) =>
    flag.id === 'import-wizard' ? importWizard : flag.default) as FlagContextValue['resolveFlag'],
  overrides: {},
  rolloutConfig: { version: 1, updatedAt: '', flags: {} },
  setOverride: () => {},
  resetAllOverrides: () => {},
  saveRolloutConfig: async () => {},
  refresh: async () => {},
  isAdmin: false,
  isLoading: false,
  error: null,
  environment: 'staging',
  clientId: 'test',
})

const renderBudget = (importWizard: boolean, route = '/budget/spreadsheet') =>
  render(
    <FlagContext.Provider value={flagValue(importWizard)}>
      <MemoryRouter initialEntries={[route]}>
        <Budget />
      </MemoryRouter>
    </FlagContext.Provider>,
  )

beforeEach(() => {
  localStorage.clear()
  mockUseBudget.yearTransactions = { '2025-01': [{ date: '2025-01-15', category: 'Salary', amount: 5000 }] }
  mockUseBudget.monthsWithData = new Set(['2025-01'])
})

describe('Budget with the import-wizard flag off', () => {
  it('keeps the legacy menu items, preview modal and file inputs, and mounts no wizard input', async () => {
    const user = userEvent.setup()
    renderBudget(false)
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Upload CSV' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Bulk Upload' })).toBeInTheDocument()
    expect(screen.getByTestId('csv-preview-modal')).toBeInTheDocument()
    expect(screen.getByTestId('quick-upload-input')).toBeInTheDocument()
    expect(screen.queryByTestId('import-wizard-input')).not.toBeInTheDocument()
  })
})

describe('Budget with the import-wizard flag on', () => {
  it('replaces the legacy menu items, modal and inputs with the wizard entry points', async () => {
    const user = userEvent.setup()
    renderBudget(true)
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Import CSV…' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Import several CSVs…' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Upload CSV' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('csv-preview-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quick-upload-input')).not.toBeInTheDocument()
  })

  it('opens the single-file picker from Import CSV…', async () => {
    const user = userEvent.setup()
    renderBudget(true)
    const input = screen.getByTestId('import-wizard-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import CSV…' }))
    expect(click).toHaveBeenCalledOnce()
    expect(input.multiple).toBe(false)
  })

  it('opens the multi-file picker from Import several CSVs…', async () => {
    const user = userEvent.setup()
    renderBudget(true)
    const input = screen.getByTestId('import-wizard-input') as HTMLInputElement
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import several CSVs…' }))
    expect(input.multiple).toBe(true)
  })

  it('opens the picker from the empty-year Import CSV button on any view', async () => {
    const user = userEvent.setup()
    mockUseBudget.yearTransactions = {}
    mockUseBudget.monthsWithData = new Set<string>()
    renderBudget(true, '/budget/cashflow')
    const input = screen.getByTestId('import-wizard-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await user.click(screen.getByRole('button', { name: 'Import CSV' }))
    expect(click).toHaveBeenCalledOnce()
  })
})
