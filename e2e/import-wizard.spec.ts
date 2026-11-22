import { test, expect } from './fixtures/base'
import { BudgetPage } from './pages/budget.page'
import { CURRENT_YEAR, csvFile, seedEmptyBudget } from './fixtures/budget.fixtures'
import { readCsvFile, readJsonFile } from './fixtures/filestore-helpers'

const BANK_CSV = [
  'Transaction Date,Description,Amount',
  `${CURRENT_YEAR}-03-01,Payroll Acme Corp,3200.00`,
  `${CURRENT_YEAR}-03-02,Starbucks,-6.75`,
  `${CURRENT_YEAR}-04-03,Shell Oil,-48.20`,
].join('\n')

const MARCH = `transactions/${CURRENT_YEAR}/${CURRENT_YEAR}-03.csv`
const APRIL = `transactions/${CURRENT_YEAR}/${CURRENT_YEAR}-04.csv`

test.describe('Import wizard (flag on)', () => {
  test.beforeEach(async ({ page }) => {
    await seedEmptyBudget(page)
    // Registered after seedBudget, whose init script clears localStorage.
    await page.addInitScript(() => localStorage.setItem('flag-overrides', JSON.stringify({ 'import-wizard': true })))
  })

  test('E1: imports a bank CSV through Columns and Review, then skips duplicates on a repeat import', async ({
    page,
  }) => {
    const budget = new BudgetPage(page)
    await budget.goto()

    await budget.emptyImportBtn.click()
    const dialog = page.getByRole('dialog', { name: 'Import transactions' })
    await page.getByTestId('import-wizard-input').setInputFiles(csvFile('bank.csv', BANK_CSV))

    await expect(dialog.getByRole('heading', { name: 'Columns' })).toBeFocused()
    const continueBtn = dialog.getByRole('button', { name: 'Continue to review' })
    await expect(continueBtn).toHaveAttribute('aria-disabled', 'true')
    await dialog.getByRole('radio', { name: 'Negative numbers are spending' }).check()
    await expect(continueBtn).toHaveAttribute('aria-disabled', 'false')
    await continueBtn.click()

    await expect(dialog.getByRole('heading', { name: 'Review before importing' })).toBeFocused()
    await expect(dialog.getByText('3 new transactions across 2 months')).toBeVisible()
    expect(await readCsvFile(page, MARCH)).toEqual([])

    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await expect(dialog.getByRole('heading', { name: 'Import complete' })).toBeVisible()

    expect(await readCsvFile(page, MARCH)).toEqual([
      ['Date', 'Category', 'Amount', 'Description'],
      [`${CURRENT_YEAR}-03-01`, 'Uncategorized income', '3200.00', 'Payroll Acme Corp'],
      [`${CURRENT_YEAR}-03-02`, 'Uncategorized', '-6.75', 'Starbucks'],
    ])
    expect(await readCsvFile(page, APRIL)).toEqual([
      ['Date', 'Category', 'Amount', 'Description'],
      [`${CURRENT_YEAR}-04-03`, 'Uncategorized', '-48.20', 'Shell Oil'],
    ])
    const categories = await readJsonFile<{ categoryGroups: { id: string; categories: string[] }[] }>(
      page,
      'budget/categories.json',
      { categoryGroups: [] },
    )
    expect(categories.categoryGroups.find(group => group.id === 'others')?.categories).toContain('Uncategorized')
    expect(categories.categoryGroups.find(group => group.id === 'income-others')?.categories).toContain(
      'Uncategorized income',
    )

    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    // Same file again: the wizard recognises every row and writes nothing.
    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' }).click()
    await page.getByTestId('import-wizard-input').setInputFiles(csvFile('bank.csv', BANK_CSV))
    await dialog.getByRole('radio', { name: 'Negative numbers are spending' }).check()
    await dialog.getByRole('button', { name: 'Continue to review' }).click()
    await expect(dialog.getByRole('heading', { name: 'Review before importing' })).toBeVisible()
    await expect(dialog.getByText('Nothing new to import. Every transaction is already in your budget.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Import 0 transactions' })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await readCsvFile(page, MARCH)).toHaveLength(3)
  })

  test('undoes an import from the result step', async ({ page }) => {
    const budget = new BudgetPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await page.getByTestId('import-wizard-input').setInputFiles(csvFile('bank.csv', BANK_CSV))
    const dialog = page.getByRole('dialog', { name: 'Import transactions' })
    await dialog.getByRole('radio', { name: 'Negative numbers are spending' }).check()
    await dialog.getByRole('button', { name: 'Continue to review' }).click()
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await dialog.getByRole('button', { name: 'Undo import' }).click()
    await expect(dialog.getByRole('heading', { name: 'Import undone' })).toBeVisible()
    expect(await readCsvFile(page, MARCH)).toEqual([])
  })
})

test.describe('Import wizard (flag off)', () => {
  test('keeps the legacy upload menu and preview modal', async ({ page }) => {
    await seedEmptyBudget(page)
    const budget = new BudgetPage(page)
    await budget.goto()
    await expect(page.getByTestId('import-wizard-input')).toHaveCount(0)
    await budget.emptyImportBtn.click()
    await expect(page.getByRole('dialog', { name: 'Import transactions' })).toHaveCount(0)
  })
})
