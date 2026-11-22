import { test, expect } from './fixtures/base'
import { BudgetPage } from './pages/budget.page'
import { ImportWizardPage } from './pages/import-wizard.page'
import { CURRENT_YEAR, csvFile } from './fixtures/budget.fixtures'
import { readCsvFile, readJsonFile } from './fixtures/filestore-helpers'
import {
  AMBIGUOUS_CSV,
  BANK_CSV,
  CARD_CSV,
  CROSS_YEAR_CSV,
  DEBIT_CREDIT_CSV,
  EUROPEAN_CSV,
  FOOD_GROUPS,
  LEGACY_CSV,
  MALFORMED_CSV,
  SAME_DAY_CSV,
  TWO_MONTH_CSV,
  Y,
  csvBytes,
  breakTransactionReads,
  listFolder,
  listMonthFiles,
  monthPath,
  overwriteMonth,
  restoreTransactionReads,
  tablePdf,
  touchCategories,
  seedWizardBudget,
  seedWizardEmpty,
} from './fixtures/import-wizard.fixtures'

const MARCH = monthPath('03')
const APRIL = monthPath('04')
const HEADER = ['Date', 'Category', 'Amount', 'Description']

test.describe('Import wizard', () => {
  test.beforeEach(async ({ page }) => {
    await seedWizardEmpty(page)
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
    // The first import remembered the format, so the Columns step is skipped.
    await expect(dialog.getByRole('heading', { name: 'Review before importing' })).toBeVisible()
    await expect(dialog.getByText('Using saved format: bank', { exact: true })).toBeVisible()
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

test.describe('Import wizard: column mapping (AC-1 to AC-14)', () => {
  test.beforeEach(async ({ page }) => {
    await seedWizardEmpty(page)
  })

  test('maps separate money out and money in columns to one signed amount', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('statement.csv', DEBIT_CREDIT_CSV))

    await expect(wizard.heading('Columns')).toBeFocused()
    await wizard.dialog.getByRole('radio', { name: 'Separate debit and credit columns' }).check()
    await wizard.dialog.getByLabel('Money out column').selectOption({ label: 'Debit' })
    await wizard.dialog.getByLabel('Money in column').selectOption({ label: 'Credit' })
    await wizard.dialog.getByLabel('Description column').selectOption({ label: 'Description' })
    await wizard.toReview()
    await expect(wizard.dialog.getByText('5 new transactions across 1 month')).toBeVisible()
    await expect(wizard.dialog.getByText('Spending $1,904.95. Income $3,700.00.')).toBeVisible()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()

    const october = await readCsvFile(page, monthPath('10'))
    expect(october[0]).toEqual(HEADER)
    expect(october.slice(1).map(row => [row[2], row[3]])).toEqual([
      ['3200.00', 'PAYROLL ACME CORP'],
      ['-6.75', 'STARBUCKS #1234'],
      ['-48.20', 'SHELL OIL 5551'],
      ['500.00', 'TRANSFER FROM SAVINGS'],
      ['-1850.00', 'RENT, OCTOBER'],
    ])
  })

  test('keeps Continue disabled until an ambiguous date format is chosen', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('dates.csv', AMBIGUOUS_CSV))
    await wizard.chooseSign('Negative numbers are spending')

    const group = wizard.dialog.getByRole('group', { name: 'How are dates written?' })
    await expect(group.getByRole('radio')).toHaveCount(2)
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(0)
    await expect(wizard.continueBtn).toHaveAttribute('aria-disabled', 'true')
    await expect(wizard.dialog.getByText('Choose a date format to continue.')).toBeVisible()
    await wizard.continueBtn.click({ force: true })
    await expect(wizard.heading('Columns')).toBeVisible()

    await group.getByRole('radio', { name: /^DD\/MM\/YYYY/ }).check()
    await expect(wizard.dialog.getByText(`"03/04/${Y}" reads as Apr 3, ${Y}`)).toBeVisible()
    await expect(wizard.continueBtn).toHaveAttribute('aria-disabled', 'false')
    await wizard.toReview()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    const rows = await readCsvFile(page, monthPath('04'))
    expect(rows.slice(1).map(row => row[0])).toEqual([`${Y}-04-03`])
    expect((await readCsvFile(page, monthPath('06'))).slice(1).map(row => row[0])).toEqual([`${Y}-06-05`])
  })

  test('reads a semicolon file with comma decimals saved as Windows-1252', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvBytes('konto.csv', EUROPEAN_CSV, 'latin1'))

    await expect(wizard.heading('Columns')).toBeFocused()
    await expect(wizard.dialog.getByLabel('Columns are separated by')).toHaveValue(';')
    await wizard.dialog.getByLabel('Date column').selectOption({ label: 'Buchungstag' })
    await wizard.dialog.getByLabel('Description column').selectOption({ label: 'Buchungstext' })
    await wizard.dialog.getByLabel('Amount column', { exact: true }).selectOption({ label: 'Betrag' })
    await wizard.dialog.getByRole('radio', { name: 'Comma (1.234,50)' }).check()
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()

    const rows = await readCsvFile(page, monthPath('10'))
    expect(rows.slice(1).map(row => [row[0], row[2], row[3]])).toEqual([
      [`${Y}-10-03`, '-4.50', 'Bäckerei Müller'],
      [`${Y}-10-05`, '-1234.56', 'Miete Oktober'],
      [`${Y}-10-15`, '2800.00', 'Gehalt Süd GmbH'],
    ])
  })

  test('keeps the categories a card export supplies and files the rest by sign', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('card.csv', CARD_CSV))

    await wizard.dialog.getByLabel('Category column (optional)').selectOption({ label: 'Category' })
    await wizard.chooseSign('Positive numbers are spending')
    await wizard.toReview()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()

    const rows = await readCsvFile(page, monthPath('10'))
    expect(rows.slice(1).map(row => [row[1], row[2]])).toEqual([
      ['Food & Drink', '-6.75'],
      ['Groceries', '-82.14'],
      ['Uncategorized income', '500.00'],
    ])
  })

  test('lists rows it cannot read with their row numbers and still imports the rest', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('messy.csv', MALFORMED_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()

    await wizard.dialog.getByRole('button', { name: /could not be read/ }).click()
    const table = wizard.dialog.getByRole('region', { name: 'Rows in this import' })
    await expect(table.getByRole('row')).not.toHaveCount(1)
    await expect(table.getByText(/^Skipped:/).first()).toBeVisible()
    await wizard.dialog.getByRole('button', { name: 'All', exact: true }).click()
    await expect(wizard.importBtn).toHaveAccessibleName('Import 2 transactions')
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    const rows = await readCsvFile(page, monthPath('10'))
    expect(rows.slice(1).map(row => row[3])).toEqual(['Good row one', 'Good row two'])
  })

  test('skips the Columns step for a file with the legacy canonical headers', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('2026-03.csv', LEGACY_CSV))
    await expect(wizard.heading('Review before importing')).toBeFocused()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    expect((await readCsvFile(page, MARCH)).slice(1)).toEqual([
      [`${Y}-03-01`, 'Salary', '3200.00', 'Payroll'],
      [`${Y}-03-02`, 'Dining', '-6.75', 'Starbucks'],
    ])
  })
})

test.describe('Import wizard: saved formats (AC-38, AC-39)', () => {
  test('writes the format file and brings back the Columns step from Change', async ({ page }) => {
    await seedWizardEmpty(page)
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.importSigned(csvFile('bank.csv', BANK_CSV))

    const saved = await readJsonFile<{ schemaVersion: number; mappings: { name: string }[] }>(
      page,
      'budget/import-formats.json',
      { schemaVersion: 0, mappings: [] },
    )
    expect(saved.schemaVersion).toBe(1)
    expect(saved.mappings.map(format => format.name)).toEqual(['bank'])
    await wizard.close()

    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' }).click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await expect(wizard.heading('Review before importing')).toBeFocused()
    await wizard.dialog.getByRole('button', { name: 'Change' }).click()
    await expect(wizard.heading('Columns')).toBeFocused()
    await expect(wizard.dialog.getByLabel('Date column')).toHaveValue('0')
  })

  test('warns about a saved formats file from a newer version and never rewrites it', async ({ page }) => {
    const newer = { schemaVersion: 99, mappings: [{ name: 'future', somethingNew: true }] }
    await seedWizardBudget(page, {
      files: [{ path: 'budget/import-formats.json', data: newer, type: 'json' }],
    })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))

    await expect(wizard.dialog.getByText('saved by a newer version of Worth')).toBeVisible()
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    expect(await readJsonFile(page, 'budget/import-formats.json', null)).toEqual(newer)
    expect((await readCsvFile(page, MARCH)).length).toBe(3)
  })
})

test.describe('Import wizard: month split (AC-15 to AC-19)', () => {
  test.beforeEach(async ({ page }) => {
    await seedWizardEmpty(page)
  })

  test('splits a statement into month files whatever the filename says', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('statement.csv', TWO_MONTH_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()

    const months = wizard.dialog.getByRole('list', { name: 'Transactions by month' })
    await expect(months.getByRole('listitem')).toHaveText([
      /Oct.*2 new, 0 skipped as duplicates/,
      /Nov.*2 new, 0 skipped as duplicates/,
    ])
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    await expect(wizard.dialog.getByText('Imported 4 transactions into 2 months.', { exact: true })).toBeVisible()
    expect((await readCsvFile(page, monthPath('10'))).length).toBe(3)
    expect((await readCsvFile(page, monthPath('11'))).length).toBe(3)
    expect(await listMonthFiles(page)).toEqual([`${Y}-10.csv`, `${Y}-11.csv`])
  })

  test('writes rows that cross the new year into both year folders', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.importSigned(csvFile('december.csv', CROSS_YEAR_CSV))

    expect((await readCsvFile(page, monthPath('12', Y - 1))).slice(1).map(row => row[3])).toEqual(['Holiday Market'])
    expect((await readCsvFile(page, monthPath('01'))).slice(1).map(row => row[3])).toEqual(['Payroll Acme Corp'])
  })

  test('builds one plan for several files and skips what the second repeats', async ({ page }) => {
    await seedWizardBudget(page, {
      months: { '02': `Date,Category,Amount,Description\n${Y}-02-01,Rent,-900,Landlord` },
    })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import several CSVs…' }).click()
    await wizard.pick(csvFile('first.csv', BANK_CSV), csvFile('overlap.csv', BANK_CSV))

    await expect(wizard.heading('Columns')).toBeFocused()
    await expect(wizard.dialog.getByText('File 1 of 2: first.csv')).toBeVisible()
    // Both files share a column signature, so one Columns step answers for the pair.
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()

    await expect(wizard.dialog.getByText('3 new transactions across 2 months')).toBeVisible()
    await expect(wizard.dialog.getByText('3 duplicates skipped')).toBeVisible()
    const files = wizard.dialog.getByRole('list', { name: 'Transactions by file' })
    await expect(files.getByRole('listitem')).toHaveText([
      'first.csv: 3 new, 0 duplicates, 0 could not be read',
      'overlap.csv: 0 new, 3 duplicates, 0 could not be read',
    ])
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    expect((await readCsvFile(page, MARCH)).length).toBe(3)
  })
})

const EXISTING_MARCH = [
  'Date,Category,Amount,Description',
  `${Y}-03-01,Salary,3200.00,Payroll Acme Corp`,
  `${Y}-03-02,Coffee,-6.75,Starbucks`,
  `${Y}-03-09,Rent,-900.00,Landlord`,
].join('\n')

test.describe('Import wizard: merge and duplicates (AC-18, AC-20 to AC-24)', () => {
  test('appends only new rows, recognises a recategorised row, and leaves existing rows as they were', async ({
    page,
  }) => {
    await seedWizardBudget(page, { months: { '03': EXISTING_MARCH } })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    const before = await readCsvFile(page, MARCH)
    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' }).click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()

    await expect(wizard.dialog.getByText('1 new transaction across 1 month')).toBeVisible()
    await expect(wizard.dialog.getByText('2 duplicates skipped')).toBeVisible()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()

    const after = await readCsvFile(page, MARCH)
    expect(after).toEqual(before)
    expect(await readCsvFile(page, APRIL)).toEqual([HEADER, [`${Y}-04-03`, 'Uncategorized', '-48.20', 'Shell Oil']])
  })

  test('imports both of two identical same-day rows once, then adds nothing on a repeat', async ({ page }) => {
    await seedWizardEmpty(page)
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('coffee.csv', SAME_DAY_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await expect(wizard.dialog.getByText('3 new transactions across 1 month')).toBeVisible()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    await wizard.close()
    expect((await readCsvFile(page, monthPath('10'))).slice(1).map(row => row[3])).toEqual([
      'Coffee Shop',
      'Coffee Shop',
      'Grocery Store',
    ])

    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' }).click()
    await wizard.pick(csvFile('coffee.csv', SAME_DAY_CSV))
    await expect(
      wizard.dialog.getByText('Nothing new to import. Every transaction is already in your budget.'),
    ).toBeVisible()
    await expect(wizard.dialog.getByText('3 duplicates skipped')).toBeVisible()
  })

  test('warns that turning Skip duplicates off counts matching rows twice, and then imports them', async ({ page }) => {
    await seedWizardBudget(page, { months: { '03': EXISTING_MARCH } })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' }).click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()

    await wizard.dialog.getByRole('checkbox', { name: 'Skip duplicates' }).uncheck()
    await expect(wizard.dialog.getByText('Turning this off will count matching transactions twice.')).toBeVisible()
    await expect(wizard.importBtn).toHaveAccessibleName('Import 3 transactions')
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    expect(await readCsvFile(page, MARCH)).toHaveLength(6)
  })

  test('replaces an existing month only when asked, and undo brings the old rows back', async ({ page }) => {
    await seedWizardBudget(page, { months: { '03': EXISTING_MARCH } })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    const before = await readCsvFile(page, MARCH)
    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' }).click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()

    await wizard.dialog.getByRole('checkbox', { name: 'Replace existing months' }).check()
    await expect(wizard.dialog.getByText(/Existing transactions in Mar \d{4} will be replaced/)).toBeVisible()
    await wizard.dialog.getByRole('checkbox', { name: 'Skip duplicates' }).uncheck()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    expect((await readCsvFile(page, MARCH)).slice(1).map(row => row[3])).toEqual(['Payroll Acme Corp', 'Starbucks'])

    await wizard.dialog.getByRole('button', { name: 'Undo import' }).click()
    await expect(wizard.heading('Import undone')).toBeVisible()
    expect(await readCsvFile(page, MARCH)).toEqual(before)
    expect(await listMonthFiles(page)).toEqual([`${Y}-03.csv`])
  })
})

test.describe('Import wizard: categorization rules (AC-25 to AC-29)', () => {
  test('sorts matching rows into the rule category and saves the rule file', async ({ page }) => {
    await seedWizardBudget(page, { groups: FOOD_GROUPS })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()

    await wizard.dialog.getByRole('button', { name: 'Manage rules' }).click()
    const rules = page.getByRole('dialog', { name: 'Categorization rules' })
    await expect(rules.getByText('No rules yet. Add one to sort a merchant automatically.')).toBeVisible()
    await rules.getByLabel('Description contains').fill('STARBUCKS')
    await rules.getByLabel('Category', { exact: true }).selectOption('Dining')
    await rules.getByRole('button', { name: 'Add rule' }).click()
    await expect(rules.getByRole('list', { name: 'Categorization rules' }).getByRole('listitem')).toContainText([
      'STARBUCKS goes to Dining',
    ])
    await expect(rules.getByRole('status')).toHaveText('Rule saved: STARBUCKS.')
    await rules.getByRole('button', { name: 'Done' }).click()

    await expect(wizard.dialog.getByText('1 transaction sorted by your rules', { exact: true })).toBeVisible()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()

    expect((await readCsvFile(page, MARCH)).slice(1).map(row => [row[1], row[3]])).toEqual([
      ['Uncategorized income', 'Payroll Acme Corp'],
      ['Dining', 'Starbucks'],
    ])
    const saved = await readJsonFile<{ rules: { match: { value: string }; category: string; enabled: boolean }[] }>(
      page,
      'budget/category-rules.json',
      { rules: [] },
    )
    expect(saved.rules.map(rule => [rule.match.value, rule.category, rule.enabled])).toEqual([
      ['STARBUCKS', 'Dining', true],
    ])
  })

  test('reorders, turns off and deletes rules from the keyboard-reachable buttons', async ({ page }) => {
    await seedWizardBudget(page, {
      groups: FOOD_GROUPS,
      files: [
        {
          path: 'budget/category-rules.json',
          type: 'json',
          data: {
            schemaVersion: 1,
            rules: [
              {
                id: 'r1',
                match: { field: 'description', type: 'contains', value: 'STARBUCKS' },
                category: 'Dining',
                enabled: true,
              },
              {
                id: 'r2',
                match: { field: 'description', type: 'contains', value: 'SHELL' },
                category: 'Groceries',
                enabled: true,
              },
            ],
          },
        },
      ],
    })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await expect(wizard.dialog.getByText('2 transactions sorted by your rules', { exact: true })).toBeVisible()

    await wizard.dialog.getByRole('button', { name: 'Manage rules' }).click()
    const rules = page.getByRole('dialog', { name: 'Categorization rules' })
    await expect(rules.getByRole('heading', { name: 'Categorization rules' })).toBeFocused()
    await rules.getByRole('button', { name: 'Move down: STARBUCKS' }).press('Enter')
    await expect(rules.getByRole('status')).toHaveText('Moved rule STARBUCKS to position 2 of 2.')
    await expect(rules.getByRole('list', { name: 'Categorization rules' }).getByRole('listitem')).toHaveText([
      /SHELL goes to Groceries/,
      /STARBUCKS goes to Dining/,
    ])
    await expect(rules.getByRole('button', { name: 'Move up: STARBUCKS' })).toBeFocused()

    const shell = rules.getByRole('switch', { name: 'Active: SHELL' })
    await shell.press('Space')
    await expect(shell).toHaveAttribute('aria-checked', 'false')
    await rules.getByRole('button', { name: 'Delete rule: SHELL' }).click()
    await expect(rules.getByRole('listitem')).toHaveCount(1)
    await expect(rules.getByRole('button', { name: 'Delete rule: STARBUCKS' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(rules).toBeHidden()
    await expect(wizard.dialog).toBeVisible()
    await expect(wizard.dialog.getByText('1 transaction sorted by your rules', { exact: true })).toBeVisible()
  })

  test('rejects a too-short value and a missing category with described field errors', async ({ page }) => {
    await seedWizardBudget(page, { groups: FOOD_GROUPS })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await wizard.dialog.getByRole('button', { name: 'Manage rules' }).click()
    const rules = page.getByRole('dialog', { name: 'Categorization rules' })

    await rules.getByLabel('Description contains').fill('a')
    await rules.getByRole('button', { name: 'Add rule' }).click()
    const value = rules.getByLabel('Description contains')
    await expect(value).toHaveAttribute('aria-invalid', 'true')
    await expect(value).toHaveAccessibleDescription('Error: Enter at least 2 characters.')
    await value.fill('cafe')
    await rules.getByRole('button', { name: 'Add rule' }).click()
    await expect(rules.getByLabel('Category', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(rules.getByLabel('Category', { exact: true })).toHaveAccessibleDescription('Error: Choose a category.')
  })
})

test.describe('Import wizard: safety (AC-32 to AC-36)', () => {
  test('writes nothing when cancelled at the Columns step, the Review step or by Escape, even after a reload', async ({
    page,
  }) => {
    await seedWizardEmpty(page)
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    // The page keeps its own categories and summary files; the wizard adds nothing to them.
    const budgetFiles = await listFolder(page, 'budget')
    const expectNothingWritten = async () => {
      expect(await listMonthFiles(page)).toEqual([])
      expect(await listFolder(page, 'budget')).toEqual(budgetFiles)
    }

    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await expect(wizard.heading('Columns')).toBeFocused()
    await expect(wizard.dialog.getByText('Nothing has been saved yet.')).toBeVisible()
    await wizard.dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(wizard.dialog).toBeHidden()
    await expectNothingWritten()

    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await wizard.dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(wizard.dialog).toBeHidden()
    await expectNothingWritten()

    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await page.keyboard.press('Escape')
    await expect(wizard.dialog).toBeHidden()
    await expectNothingWritten()

    await page.reload()
    await expect(budget.emptyState).toBeVisible()
    await expectNothingWritten()
  })

  test('keeps the dialog open when the backdrop is clicked, so mapping work is not lost', async ({ page }) => {
    await seedWizardEmpty(page)
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')

    await page.locator('.iw-overlay').click({ position: { x: 4, y: 4 } })
    await expect(wizard.dialog).toBeVisible()
    await expect(wizard.dialog.getByRole('radio', { name: 'Negative numbers are spending' })).toBeChecked()
  })

  test('disables Undo with an explanation once a touched month has changed', async ({ page }) => {
    await seedWizardEmpty(page)
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.importSigned(csvFile('bank.csv', BANK_CSV))

    await overwriteMonth(page, MARCH, [HEADER, ['2000-01-01', 'Other', '-1.00', 'Edited elsewhere']])
    await touchCategories(page)
    const undo = wizard.dialog.getByRole('button', { name: 'Undo import' })
    await expect(undo).toHaveAttribute('aria-disabled', 'true')
    await expect(
      wizard.dialog.getByText('Undo is not available because these months changed after the import.'),
    ).toBeVisible()
    await undo.click({ force: true })
    await expect(wizard.heading('Import complete')).toBeVisible()
    expect((await readCsvFile(page, MARCH))[1][3]).toBe('Edited elsewhere')
  })
})

test.describe('Import wizard: paused when files are unreadable (AC-34)', () => {
  test('refuses to import while the budget cannot be read and recovers once it can', async ({ page }) => {
    await seedWizardBudget(page, { months: { '03': EXISTING_MARCH } })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await breakTransactionReads(page)
    await touchCategories(page)

    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' }).click()
    await expect(wizard.heading('Import is paused')).toBeFocused()
    await expect(wizard.dialog.getByRole('alert')).toContainText('importing is paused to protect your data')
    await expect(wizard.dialog.getByRole('button', { name: 'Choose another file' })).toHaveCount(0)
    await wizard.dialog.getByRole('button', { name: 'Close' }).click()
    await expect(wizard.dialog).toBeHidden()
    expect(await readCsvFile(page, MARCH)).toHaveLength(4)

    await restoreTransactionReads(page)
    await touchCategories(page)
    await budget.uploadDropDown.click()
    const chooser = page.waitForEvent('filechooser')
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import CSV…' }).click()
    await (await chooser).setFiles(csvFile('bank.csv', BANK_CSV))
    await expect(wizard.heading('Columns')).toBeFocused()
  })
})

test.describe('Import wizard: entry points (AC-41, AC-42)', () => {
  test('E3: Import CSV in an empty year opens the wizard from the Overview tab', async ({ page }) => {
    await seedWizardEmpty(page)
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.gotoCashflow()
    await expect(budget.emptyState).toBeVisible()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await expect(wizard.heading('Columns')).toBeFocused()
  })

  test('E2: Import several CSVs reads each file into one review', async ({ page }) => {
    await seedWizardBudget(page, {
      months: { '02': `Date,Category,Amount,Description\n${Y}-02-01,Rent,-900,Landlord` },
    })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'Import several CSVs…' }).click()
    await wizard.pick(csvFile('march.csv', BANK_CSV), csvFile('october.csv', SAME_DAY_CSV))
    await expect(wizard.dialog.getByText('File 1 of 2: march.csv')).toBeVisible()
  })

  test('E4: the month header menu opens the wizard in place of the legacy file input', async ({ page }) => {
    await seedWizardBudget(page, {
      months: { '03': EXISTING_MARCH },
      groups: [
        { id: 'fixed', name: 'Fixed', categories: ['Rent', 'Coffee'] },
        { id: 'others', name: 'Others', categories: ['Salary'] },
        { id: 'removed', name: 'Remove from Budget', categories: [] },
      ],
    })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.setSpreadsheetMode('detailed')
    await budget.openMonthContextMenu(2)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import into Mar…' }).click()
    await (await chooser).setFiles(csvFile('bank.csv', BANK_CSV))
    await expect(wizard.heading('Columns')).toBeFocused()
  })

  test('E5: Drive shows the wizard hint and sends dropped CSVs through the wizard', async ({ page }) => {
    await seedWizardBudget(page, { months: { '03': EXISTING_MARCH } })
    const wizard = new ImportWizardPage(page)
    await page.goto(`/worth/#/drive/budget/${Y}`)
    const dropZone = page.locator('.drive-dropzone')
    await expect(dropZone).toContainText('Worth reads dates from the rows, not the filename.')
    await page.locator('.drive-dropzone input[type="file"]').setInputFiles(csvFile('statement.csv', BANK_CSV))
    await expect(wizard.heading('Columns')).toBeFocused()
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    await wizard.close()
    expect((await readCsvFile(page, APRIL)).length).toBe(2)
  })

  test('E6: PDF to CSV hands its table to the wizard without a download', async ({ page }) => {
    await seedWizardBudget(page, { months: { '03': EXISTING_MARCH } })
    await page.addInitScript(() => localStorage.setItem('lab-pdf-to-csv', '1'))
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    const downloads: string[] = []
    page.on('download', download => downloads.push(download.suggestedFilename()))
    await budget.goto()
    await budget.uploadDropDown.click()
    await budget.uploadMenu.getByRole('menuitem', { name: 'PDF → CSV' }).click()
    const pdf = page.getByRole('dialog', { name: 'PDF → CSV' })
    await pdf.locator('input[type="file"]').setInputFiles({
      name: 'statement.pdf',
      mimeType: 'application/pdf',
      buffer: tablePdf([
        ['Date', 'Description', 'Amount'],
        [`${Y}-04-03`, 'Shell Oil', '-48.20'],
        [`${Y}-04-09`, 'Corner Market', '-23.10'],
      ]),
    })
    const overlay = pdf.locator('.pdf2csv-overlay')
    await expect(pdf.locator('.pdf2csv-canvas')).toBeVisible()
    const box = (await overlay.boundingBox())!
    await page.mouse.move(box.x + 2, box.y + 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2)
    await page.mouse.up()
    await expect(pdf.getByRole('heading', { name: /Extracted Table/ })).toBeVisible()

    await pdf.getByRole('button', { name: 'Review in import wizard' }).click()
    await expect(pdf).toBeHidden()
    await expect(wizard.heading('Columns')).toBeFocused()
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await expect(wizard.dialog.getByText('2 new transactions across 1 month')).toBeVisible()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    expect((await readCsvFile(page, APRIL)).slice(1).map(row => row[3])).toEqual(['Shell Oil', 'Corner Market'])
    expect(downloads).toEqual([])
  })
})

const UNSORTED_MARCH = [
  'Date,Category,Amount,Description',
  `${Y}-03-01,Uncategorized income,3200.00,Payroll Acme Corp`,
  `${Y}-03-02,Uncategorized,-6.75,Starbucks Reserve`,
  `${Y}-03-05,Uncategorized,-4.10,STARBUCKS 1234`,
  `${Y}-03-09,Uncategorized,-48.20,Shell Oil`,
].join('\n')

const STARBUCKS_RULE = {
  path: 'budget/category-rules.json',
  type: 'json' as const,
  data: {
    schemaVersion: 1,
    rules: [
      {
        id: 'r1',
        match: { field: 'description', type: 'contains', value: 'starbucks' },
        category: 'Dining',
        enabled: true,
      },
    ],
  },
}

const TXN_GROUPS = [
  { id: 'food', name: 'Food', categories: ['Dining'] },
  { id: 'others', name: 'Others', categories: ['Uncategorized'] },
  { id: 'income-others', name: 'Income', categories: ['Uncategorized income'] },
  { id: 'removed', name: 'Remove from Budget', categories: [] },
]

test.describe('Import wizard: Transactions page (AC-30, AC-31, E7)', () => {
  test('E7: the empty page offers Import, and imported rows appear in the list', async ({ page }) => {
    await seedWizardEmpty(page)
    const wizard = new ImportWizardPage(page)
    await page.goto('/worth/#/transactions')
    await expect(page.getByRole('heading', { name: 'No transactions yet' })).toBeVisible()
    await expect(page.getByText('Import a CSV to see transactions here.')).toBeVisible()

    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await (await chooser).setFiles(csvFile('bank.csv', BANK_CSV))
    await expect(wizard.heading('Columns')).toBeFocused()
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await wizard.importBtn.click()
    await expect(wizard.heading('Import complete')).toBeVisible()
    await wizard.close()

    const list = page.getByRole('region', { name: 'All transactions' })
    await expect(list.getByText('Starbucks')).toBeVisible()
    await expect(list.getByText('Shell Oil')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused()
  })

  test('applies saved rules to uncategorized transactions after a confirmation, and undoes it', async ({ page }) => {
    await seedWizardBudget(page, { months: { '03': UNSORTED_MARCH }, groups: TXN_GROUPS, files: [STARBUCKS_RULE] })
    await page.goto('/worth/#/transactions')
    const list = page.getByRole('region', { name: 'All transactions' })
    await expect(list.getByText('Shell Oil')).toBeVisible()

    await page.getByRole('button', { name: 'Apply rules to uncategorized' }).click()
    const dialog = page.getByRole('dialog', { name: 'Apply rules to 2 uncategorized transactions?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Only uncategorized transactions change.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect((await readCsvFile(page, MARCH)).map(row => row[1])).not.toContain('Dining')

    await page.getByRole('button', { name: 'Apply rules to uncategorized' }).click()
    await page.getByRole('button', { name: 'Apply rules', exact: true }).click()
    const done = page.getByRole('dialog', { name: 'Rules applied' })
    await expect(done.locator('p', { hasText: 'Recategorized 2 transactions.' })).toBeVisible()
    expect((await readCsvFile(page, MARCH)).slice(1).map(row => row[1])).toEqual([
      'Uncategorized income',
      'Dining',
      'Dining',
      'Uncategorized',
    ])

    await done.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('dialog', { name: 'Undone' })).toBeVisible()
    expect((await readCsvFile(page, MARCH)).slice(1).map(row => row[1])).toEqual([
      'Uncategorized income',
      'Uncategorized',
      'Uncategorized',
      'Uncategorized',
    ])
  })

  test('creates a rule from the category editor with a live match count and applies it', async ({ page }) => {
    await seedWizardBudget(page, { months: { '03': UNSORTED_MARCH }, groups: TXN_GROUPS })
    await page.goto('/worth/#/transactions')
    await page.getByRole('button', { name: 'Edit category for Starbucks Reserve' }).click()
    await page.getByRole('button', { name: 'Always categorize merchants like this as…' }).click()

    const dialog = page.getByRole('dialog', { name: 'Create a rule' })
    await expect(dialog.getByLabel('Description contains')).toBeFocused()
    await expect(dialog.getByLabel('Description contains')).toHaveValue('Starbucks Reserve')
    await dialog.getByLabel('Description contains').fill('Starbucks')
    await dialog.getByLabel('Category', { exact: true }).selectOption('Dining')
    await expect(dialog.getByText('2 transactions match "Starbucks".')).toBeVisible()
    await dialog.getByRole('button', { name: 'Create rule and apply to 2' }).click()
    await expect(dialog.locator('p', { hasText: 'Rule saved. Recategorized 2 transactions.' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()

    expect((await readCsvFile(page, MARCH)).slice(1).map(row => row[1])).toEqual([
      'Uncategorized income',
      'Dining',
      'Dining',
      'Uncategorized',
    ])
    const saved = await readJsonFile<{ rules: { category: string }[] }>(page, 'budget/category-rules.json', {
      rules: [],
    })
    expect(saved.rules.map(rule => rule.category)).toEqual(['Dining'])
    await expect(page.getByRole('button', { name: 'Edit category for Starbucks Reserve' })).toContainText('Dining')
  })
})

/** Parses the `rgb()` or `rgba()` string Chromium returns for a computed colour. */
const parseRgb = (value: string): [number, number, number] => {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) throw new Error(`Unexpected colour format: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const [lr, lg, lb] = [r, g, b].map(channel => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

const contrastRatio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test.describe('Import wizard: keyboard and accessibility (AC-43 to AC-46)', () => {
  test.beforeEach(async ({ page }) => {
    await seedWizardEmpty(page)
  })

  test('completes an import with the keyboard alone and returns focus to where it started', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()

    await budget.emptyImportBtn.focus()
    await page.keyboard.press('Enter')
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await expect(wizard.heading('Columns')).toBeFocused()

    await wizard.dialog.getByRole('radio', { name: 'Negative numbers are spending' }).focus()
    await page.keyboard.press('Space')
    await expect(wizard.continueBtn).toHaveAttribute('aria-disabled', 'false')
    await wizard.continueBtn.focus()
    await page.keyboard.press('Enter')

    await expect(wizard.heading('Review before importing')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(wizard.dialog).toBeHidden()
    await expect(budget.emptyImportBtn).toBeFocused()
    expect(await listMonthFiles(page)).toEqual([])
  })

  test('keeps Tab and Shift+Tab inside the open dialog', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await expect(wizard.heading('Columns')).toBeFocused()

    const insideDialog = () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab')
      expect(await insideDialog()).toBe(true)
    }
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await insideDialog()).toBe(true)
    }
  })

  test('announces each step and the result in a polite live region', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))

    await expect(wizard.dialog).toHaveAttribute('aria-modal', 'true')
    await expect(wizard.liveRegion).toHaveAttribute('aria-live', 'polite')
    await expect(wizard.liveRegion).toHaveText('Step 1 of 2: Columns')
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    await expect(wizard.liveRegion).toContainText('Step 2 of 2: Review')
    await wizard.importBtn.click()
    await expect(wizard.liveRegion).toContainText('Imported 3 transactions into 2 months.')
  })

  test('names the review table, its scroll region and the disabled Continue reason', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))

    await expect(wizard.continueBtn).toHaveAttribute('aria-disabled', 'true')
    const reasonId = await wizard.continueBtn.getAttribute('aria-describedby')
    expect(reasonId).toBeTruthy()
    await expect(page.locator(`[id="${reasonId}"]`)).toHaveText('Choose which sign means spending to continue.')

    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()
    const region = wizard.dialog.getByRole('region', { name: 'Rows in this import' })
    await expect(region).toHaveAttribute('tabindex', '0')
    await expect(region.getByRole('table', { name: 'Rows in this import' })).toBeVisible()
    await expect(region.getByRole('columnheader')).toHaveText([
      'Row',
      'Date',
      'Description',
      'Category',
      'Amount',
      'Status',
    ])
  })

  test('gives every control in the open dialog an accessible name', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')
    await wizard.toReview()

    const unnamed = await wizard.dialog.evaluate(dialog =>
      Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [role="radio"], a[href]'))
        .filter(el => {
          const labelled =
            el.getAttribute('aria-label') ||
            el.getAttribute('aria-labelledby') ||
            (el as HTMLInputElement).labels?.length ||
            el.textContent?.trim()
          return !labelled
        })
        .map(el => el.outerHTML.slice(0, 80)),
    )
    expect(unnamed).toEqual([])
  })

  test('keeps the primary button readable in dark mode', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('darkMode', '1'))
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    await expect(page.locator('body')).toHaveClass(/dark/)
    await budget.emptyImportBtn.click()
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')

    const colours = await wizard.continueBtn.evaluate(el => {
      const style = getComputedStyle(el)
      return { color: style.color, background: style.backgroundColor }
    })
    expect(contrastRatio(parseRgb(colours.color), parseRgb(colours.background))).toBeGreaterThanOrEqual(4.5)
  })

  test('makes the dialog controls at least 44px tall on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    await budget.goto()
    // The mobile sidebar covers the page button, so hand the file to the wizard's own input.
    await wizard.pick(csvFile('bank.csv', BANK_CSV))
    await wizard.chooseSign('Negative numbers are spending')

    for (const control of [wizard.continueBtn, wizard.dialog.getByRole('button', { name: 'Cancel' })]) {
      const box = await control.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
  })

  test('sends no request to another host while importing', async ({ page }) => {
    const budget = new BudgetPage(page)
    const wizard = new ImportWizardPage(page)
    const hosts = new Set<string>()
    await budget.goto()
    const pageHost = new URL(page.url()).hostname
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.protocol === 'http:' || url.protocol === 'https:') hosts.add(url.hostname)
    })
    await budget.emptyImportBtn.click()
    await wizard.importSigned(csvFile('bank.csv', BANK_CSV))
    await wizard.close()

    // Web fonts belong to the app shell, not the wizard, and the feature-flag lookup is mocked by the base fixture.
    const shell = new Set([pageHost, 'api.github.com', 'fonts.googleapis.com', 'fonts.gstatic.com'])
    const others = [...hosts].filter(host => !shell.has(host))
    expect(others).toEqual([])
  })
})
