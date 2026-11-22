import { Page, Locator } from '@playwright/test'
import { ImportWizardPage } from './import-wizard.page'

type FilePayload = { name: string; mimeType: string; buffer: Buffer }

export class BudgetPage {
  readonly page: Page
  readonly wizard: ImportWizardPage

  // Title / shell
  readonly title: Locator
  readonly emptyState: Locator
  readonly emptyStateTitle: Locator
  readonly emptyStateDesc: Locator
  readonly emptyImportBtn: Locator

  // Year nav
  readonly prevYearBtn: Locator
  readonly nextYearBtn: Locator
  readonly yearLabel: Locator

  // View mode + time period
  readonly spreadsheetBtn: Locator
  readonly cashflowBtn: Locator
  readonly groupsBtn: Locator

  // Upload
  readonly uploadDropDown: Locator
  readonly uploadMenu: Locator
  readonly addTxnMenuItem: Locator
  readonly uploadCsvMenuItem: Locator
  readonly bulkUploadMenuItem: Locator

  // Manual transaction entry
  readonly addTxnBtn: Locator
  readonly txnForm: Locator
  readonly txnDate: Locator
  readonly txnDesc: Locator
  readonly txnAmount: Locator
  readonly txnCategory: Locator
  readonly txnCatListbox: Locator
  readonly txnSave: Locator

  // Summary
  readonly summaryIncome: Locator
  readonly summaryExpense: Locator
  readonly summarySave: Locator
  readonly incomeValue: Locator
  readonly expenseValue: Locator
  readonly saveRateValue: Locator

  // Category Group Manager
  readonly groupManager: Locator

  // Budget Tables
  readonly tableSections: Locator
  readonly incomeTab: Locator
  readonly expenseTab: Locator
  readonly incomeTable: Locator
  readonly expenseTable: Locator

  constructor(page: Page) {
    this.page = page
    this.wizard = new ImportWizardPage(page)

    this.title = page.locator('.budget-title')
    this.emptyState = page.locator('.budget-empty-year')
    this.emptyStateTitle = page.locator('.budget-empty-year-title')
    this.emptyStateDesc = page.locator('.budget-empty-year-desc')
    this.emptyImportBtn = page.locator('.budget-action-btn--accent')

    this.prevYearBtn = page.locator('.budget-year-btn[title="Previous year"]')
    this.nextYearBtn = page.locator('.budget-year-btn[title="Next year"]')
    this.yearLabel = page.locator('.budget-year-label')

    this.cashflowBtn = page.locator('.budget-header-left .tab-bar .tab-btn', {
      hasText: /^Overview$/,
    })
    this.spreadsheetBtn = page.locator('.budget-header-left .tab-bar .tab-btn', {
      hasText: /^Spreadsheet$/,
    })
    this.groupsBtn = page.locator('.budget-header-left .tab-bar .tab-btn', { hasText: /^Groups$/ })

    this.uploadDropDown = page.locator('.budget-overflow-btn')
    this.uploadMenu = page.locator('.budget-upload-menu')
    this.addTxnMenuItem = this.uploadMenu.getByRole('menuitem', { name: 'Add Transaction' })
    this.uploadCsvMenuItem = this.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' })
    this.bulkUploadMenuItem = this.uploadMenu.getByRole('menuitem', { name: 'Import several CSVs…' })

    this.addTxnBtn = this.addTxnMenuItem
    this.txnForm = page.locator('form.budget-txn-form')
    this.txnDate = page.locator('#txn-date')
    this.txnDesc = page.locator('#txn-desc')
    this.txnAmount = page.locator('#txn-amount')
    this.txnCategory = page.locator('#txn-category')
    this.txnCatListbox = page.locator('#txn-cat-listbox')
    this.txnSave = page.locator('button.budget-txn-save')

    this.summaryIncome = page.locator('.budget-summary-card--income')
    this.summaryExpense = page.locator('.budget-summary-card--expense')
    this.summarySave = page.locator('.budget-summary-card--save')
    this.incomeValue = this.summaryIncome.locator('.budget-summary-value')
    this.expenseValue = this.summaryExpense.locator('.budget-summary-value')
    this.saveRateValue = this.summarySave.locator('.budget-summary-value')

    this.groupManager = page.locator('.budget-group-manager')

    this.tableSections = page.locator('.budget-table-section')
    this.incomeTab = page.locator('.budget-agg-tabs-row > .tab-bar').getByRole('button', { name: 'Income' })
    this.expenseTab = page.locator('.budget-agg-tabs-row > .tab-bar').getByRole('button', { name: 'Expenses' })
    this.incomeTable = page
      .locator('.budget-table-section')
      .filter({ has: page.locator('.budget-table-title', { hasText: /^Income/ }) })
    this.expenseTable = page
      .locator('.budget-table-section')
      .filter({ has: page.locator('.budget-table-title', { hasText: /^Expenses/ }) })
  }

  async goto() {
    await this.page.goto('/worth/#/budget/spreadsheet')
    await this.page.waitForLoadState('domcontentloaded')
    await this.title.waitFor({ state: 'visible' })
  }

  async gotoCashflow() {
    await this.page.goto('/worth/#/budget')
    await this.page.waitForLoadState('domcontentloaded')
    await this.title.waitFor({ state: 'visible' })
  }

  async setViewMode(mode: 'cashflow' | 'spreadsheet' | 'groups') {
    const labels: Record<typeof mode, string> = {
      cashflow: 'Overview',
      spreadsheet: 'Spreadsheet',
      groups: 'Groups',
    }
    await this.page.locator('.budget-header-left .tab-bar').locator('.tab-btn', { hasText: labels[mode] }).click()
  }

  async setSpreadsheetMode(mode: 'aggregated' | 'detailed') {
    await this.page
      .locator('.budget-agg-tabs-right .tab-bar')
      .locator('.tab-btn', { hasText: mode === 'aggregated' ? 'Aggregated' : 'Detailed' })
      .click()
  }

  async setSpreadsheetCategory(category: 'income' | 'expense') {
    await (category === 'income' ? this.incomeTab : this.expenseTab).click()
  }

  async setTimePeriod(period: 'M' | 'Q' | 'H') {
    await this.page.locator('.budget-header-right .tab-bar').locator('.tab-btn', { hasText: period }).click()
  }

  /**
   * Opens the import wizard and hands it one or more CSVs. An empty year offers only the single-file button;
   * several files need the overflow menu, which appears once the year has data.
   */
  async startImport(...files: FilePayload[]) {
    if (files.length === 1 && (await this.emptyImportBtn.isVisible())) {
      await this.emptyImportBtn.click()
    } else {
      await this.uploadDropDown.click()
      await (files.length > 1 ? this.bulkUploadMenuItem : this.uploadCsvMenuItem).click()
    }
    await this.wizard.pick(...files)
  }

  /** Imports one canonical-shape CSV through the wizard and closes it. */
  async importCSV(name: string, csv: string) {
    await this.startImport({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await this.wizard.heading('Review before importing').waitFor()
    await this.wizard.importBtn.click()
    await this.wizard.heading('Import complete').waitFor()
    await this.wizard.close()
  }

  /** Open the manual transaction entry form. */
  async openManualEntry() {
    if (await this.txnForm.isVisible()) return
    if (!(await this.uploadMenu.isVisible())) {
      await this.uploadDropDown.click()
    }
    await this.addTxnBtn.click()
    await this.txnForm.waitFor({ state: 'visible' })
  }

  /**
   * Fill the manual entry form. Picks the first matching option from the
   * autocomplete listbox to mimic real keyboard selection.
   */
  async fillManualEntry(opts: { date: string; description?: string; amount: string; category: string }) {
    await this.openManualEntry()
    await this.txnDate.fill(opts.date)
    if (opts.description !== undefined) {
      await this.txnDesc.fill(opts.description)
    }
    await this.txnAmount.fill(opts.amount)

    await this.txnCategory.click()
    await this.txnCategory.fill(opts.category)
    // If the typed category matches an existing option, select it. Otherwise
    // press Enter to keep the free-text value (combobox stays open).
    const firstOption = this.txnCatListbox.locator('li[role="option"]').first()
    if (await firstOption.isVisible()) {
      await firstOption.click()
    }
  }

  async submitManualEntry() {
    await this.txnSave.click()
  }

  /** Open the category group manager view if not already visible. */
  async openGroupManager() {
    if (await this.groupManager.isVisible()) return
    await this.setViewMode('groups')
    await this.groupManager.waitFor({ state: 'visible' })
  }

  /** Right-click a month header in the expense table to open context menu. */
  async openMonthContextMenu(monthIndex: number) {
    await this.setSpreadsheetCategory('expense')
    const monthHeader = this.expenseTable.locator('th.budget-th--month').nth(monthIndex)
    await monthHeader.click({ button: 'right' })
    await this.page.locator('.budget-ctx-menu').waitFor({ state: 'visible' })
  }
}
