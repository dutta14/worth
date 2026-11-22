import type { Page } from '@playwright/test'
import {
  CURRENT_YEAR,
  DEFAULT_GROUPS,
  seedBudget,
  seedEmptyBudget,
  type BudgetStore,
  type CategoryGroup,
} from './budget.fixtures'
import { seedFileStore, type SeedEntry } from './seed-filestore'

/**
 * Synthetic bank exports for the import wizard (docs/specs/import-wizard.md, section 7.4). Dates use the current year
 * so the wizard's 1990 to next-year bound never rejects them whenever the suite runs.
 */
export const Y = CURRENT_YEAR

export const monthPath = (month: string, year = Y) => `transactions/${year}/${year}-${month}.csv`

/** F02b: no category column, signed amounts, ISO dates across two months. */
export const BANK_CSV = [
  'Transaction Date,Description,Amount',
  `${Y}-03-01,Payroll Acme Corp,3200.00`,
  `${Y}-03-02,Starbucks,-6.75`,
  `${Y}-04-03,Shell Oil,-48.20`,
].join('\n')

/** F01: separate money out and money in columns, MM/DD/YYYY, a balance column to ignore, a quoted comma. */
export const DEBIT_CREDIT_CSV = [
  'Date,Description,Debit,Credit,Balance',
  `10/01/${Y},PAYROLL ACME CORP,,3200.00,5200.00`,
  `10/02/${Y},STARBUCKS #1234,6.75,,5193.25`,
  `10/03/${Y},SHELL OIL 5551,48.20,,5145.05`,
  `10/15/${Y},TRANSFER FROM SAVINGS,0.00,500.00,5645.05`,
  `10/20/${Y},"RENT, OCTOBER",1850.00,,3795.05`,
].join('\n')

/** F03: a card export where charges are positive and the file carries its own categories. */
export const CARD_CSV = [
  'Transaction Date,Post Date,Description,Category,Type,Amount',
  `10/02/${Y},10/03/${Y},STARBUCKS #1234,Food & Drink,Sale,6.75`,
  `10/15/${Y},10/16/${Y},WHOLEFDS MKT 10,Groceries,Sale,82.14`,
  `10/25/${Y},10/25/${Y},AUTOPAY PAYMENT THANK YOU,,Payment,-500.00`,
].join('\n')

/** F04 text: semicolons, DD.MM.YYYY, comma decimals. Send it through `windows1252`. */
export const EUROPEAN_CSV = [
  'Buchungstag;Valuta;Buchungstext;Betrag;Waehrung',
  `03.10.${Y};03.10.${Y};Bäckerei Müller;-4,50;EUR`,
  `05.10.${Y};05.10.${Y};Miete Oktober;-1.234,56;EUR`,
  `15.10.${Y};15.10.${Y};Gehalt Süd GmbH;2.800,00;EUR`,
].join('\n')

/** F10: every date reads under both MM/DD/YYYY and DD/MM/YYYY. */
export const AMBIGUOUS_CSV = [
  'Date,Description,Amount',
  `03/04/${Y},Hardware Store,-31.00`,
  `05/06/${Y},Coffee Shop,-4.25`,
].join('\n')

/** F13: two identical same-day rows that must both import. */
export const SAME_DAY_CSV = [
  'Date,Description,Amount',
  `${Y}-10-02,Coffee Shop,-4.25`,
  `${Y}-10-02,Coffee Shop,-4.25`,
  `${Y}-10-03,Grocery Store,-60.00`,
].join('\n')

/** F15: an unterminated quote and ragged rows between two good rows. */
export const MALFORMED_CSV = [
  'Date,Description,Amount',
  `${Y}-10-01,Good row one,-10.00`,
  `${Y}-10-02,"Unterminated quote,-20.00`,
  `${Y}-10-03,Too few columns`,
  `${Y}-10-05,Good row two,-40.00`,
].join('\n')

/** F05: one statement spanning October and November. */
export const TWO_MONTH_CSV = [
  'Date,Description,Amount',
  `${Y}-10-29,Grocery Store,-54.10`,
  `${Y}-10-31,Electric Bill,-92.00`,
  `${Y}-11-01,Payroll Acme Corp,3200.00`,
  `${Y}-11-02,Coffee Shop,-4.25`,
].join('\n')

/** A statement that crosses the new year. */
export const CROSS_YEAR_CSV = [
  'Date,Description,Amount',
  `${Y - 1}-12-30,Holiday Market,-35.00`,
  `${Y}-01-02,Payroll Acme Corp,3200.00`,
].join('\n')

/** F11: the legacy canonical shape, which skips the Columns step. */
export const LEGACY_CSV = [
  'Date,Category,Amount,Description',
  `${Y}-03-01,Salary,3200,Payroll`,
  `${Y}-03-02,Dining,-6.75,Starbucks`,
].join('\n')

export const csvBytes = (name: string, text: string, encoding: BufferEncoding = 'utf8') => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text, encoding),
})

/** Registered after `seedBudget`, whose init script clears localStorage. */
export async function enableImportWizard(page: Page) {
  await page.addInitScript(() => localStorage.setItem('flag-overrides', JSON.stringify({ 'import-wizard': true })))
}

export async function seedWizardEmpty(page: Page) {
  await seedEmptyBudget(page)
  await enableImportWizard(page)
}

export interface WizardSeed {
  months?: Record<string, string>
  groups?: CategoryGroup[]
  files?: SeedEntry[]
}

/** Seeds month CSVs (keyed "MM", current year) and extra files, then turns the wizard on. */
export async function seedWizardBudget(page: Page, seed: WizardSeed = {}) {
  const csvs: BudgetStore['csvs'] = {}
  for (const [month, csv] of Object.entries(seed.months ?? {})) {
    const key = `${Y}-${month}`
    csvs[key] = { month: key, csv, uploadedAt: `${key}-15T00:00:00.000Z` }
  }
  await seedBudget(page, {
    store: { csvs, configs: {}, years: [Y], categoryGroups: seed.groups ?? DEFAULT_GROUPS },
  })
  if (seed.files?.length) await seedFileStore(page, seed.files)
  await enableImportWizard(page)
}

export const FOOD_GROUPS: CategoryGroup[] = [
  { id: 'food', name: 'Food', categories: ['Dining', 'Groceries'] },
  { id: 'others', name: 'Others', categories: [] },
  { id: 'income-others', name: 'Income', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: [] },
]

type E2EStore = {
  listFiles: (path: string) => Promise<string[]>
  readJSON: (path: string, fallback: unknown) => Promise<unknown>
  writeJSON: (path: string, data: unknown) => Promise<void>
  writeCSV: (path: string, rows: string[][]) => Promise<void>
}
type E2EWindow = Window & typeof globalThis & { __e2eFileStore?: E2EStore; __restoreListFiles?: () => void }

/** Lists the month CSV files the budget holds for a year. */
export const listMonthFiles = (page: Page, year = Y): Promise<string[]> => listFolder(page, `transactions/${year}`)

/** Lists the files in a folder of the in-memory file store. */
export function listFolder(page: Page, folder: string): Promise<string[]> {
  return page.evaluate(async folder => (await (window as E2EWindow).__e2eFileStore?.listFiles(folder)) ?? [], folder)
}

/** Rewrites categories.json unchanged, which is the signal the Budget page uses to reload its files. */
export function touchCategories(page: Page): Promise<void> {
  return page.evaluate(async () => {
    const store = (window as E2EWindow).__e2eFileStore
    await store?.writeJSON('budget/categories.json', await store.readJSON('budget/categories.json', {}))
  })
}

/** Writes a month the way an outside editor would, without going through the wizard. */
export function overwriteMonth(page: Page, path: string, rows: string[][]): Promise<void> {
  return page.evaluate(({ path, rows }) => (window as E2EWindow).__e2eFileStore?.writeCSV(path, rows), { path, rows })
}

/** Makes every read under transactions/ fail, as if the worth folder had been disconnected. */
export function breakTransactionReads(page: Page): Promise<void> {
  return page.evaluate(() => {
    const win = window as E2EWindow
    const store = win.__e2eFileStore!
    const original = store.listFiles.bind(store)
    store.listFiles = async (dir: string) => {
      if (dir.startsWith('transactions')) throw new Error('permission denied')
      return original(dir)
    }
    win.__restoreListFiles = () => {
      store.listFiles = original
    }
  })
}

export function restoreTransactionReads(page: Page): Promise<void> {
  return page.evaluate(() => (window as E2EWindow).__restoreListFiles?.())
}

/** A one-page PDF with a three-column table, built by hand so no binary fixture is checked in. */
export function tablePdf(rows: string[][]): Buffer {
  const columnX = [50, 190, 420]
  const lines = rows.flatMap((row, r) =>
    row.map(
      (cell, c) => `BT /F1 11 Tf 1 0 0 1 ${columnX[c]} ${700 - r * 24} Tm (${cell.replace(/[()\\]/g, '\\$&')}) Tj ET`,
    ),
  )
  const stream = lines.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const offset = Buffer.byteLength(pdf)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
