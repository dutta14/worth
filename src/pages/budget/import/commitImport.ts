import type { BudgetStore } from '../types'
import { parseCSV as parseCSVRows, serializeCSV } from '../../../utils/csvUtils'
import type { FileStore } from '../../../utils/fileStoreTypes'
import { monthCsvPath, saveMonths, SaveMonthsError } from '../utils/budgetStorage'
import { addDiscoveredCategories } from '../utils/categoryDiscovery'
import { appendRowsToMonthCsv, replaceMonthCsv } from './mergeCsv'
import { noopPreImportSnapshot, type PreImportSnapshot } from './importStorage'
import type { ImportPlan } from './types'

/** What an import changed, kept in memory so it can be reversed. `before` is null when the month had no file. */
export interface UndoRecord {
  months: Record<string, { before: string | null; after: string }>
  addedCategories: string[]
  addedYears: number[]
}

export interface CommitSuccess {
  ok: true
  imported: number
  months: string[]
  newCategories: string[]
  snapshotFailed: boolean
  undo: UndoRecord
}

export interface CommitFailure {
  ok: false
  /** 'unmergeable': an existing month file has no Date, Category and Amount header, so nothing was written. */
  reason: 'write' | 'unmergeable'
  /** Months whose write failed, or that could not be merged (nothing is written in that case). */
  failedMonths: string[]
  /** True when the month files were written but categories.json was not. */
  categoriesFailed: boolean
  /** True when every month that had been written was put back. */
  restored: boolean
}

export type CommitResult = CommitSuccess | CommitFailure

export type UndoResult = { ok: true } | { ok: false; failedMonths: string[] }

export interface ExecuteImportArgs {
  fileStore: FileStore
  store: BudgetStore
  plan: ImportPlan
  snapshot?: PreImportSnapshot
}

/** Month text as a reload would produce it, so it can be compared with the in-memory store. */
const normalizeCsv = (text: string): string => serializeCSV(parseCSVRows(text))

const yearOf = (monthKey: string): number => parseInt(monthKey.split('-')[0], 10)

async function restoreMonths(fileStore: FileStore, months: UndoRecord['months']): Promise<string[]> {
  const keys = Object.keys(months)
  const settled = await Promise.allSettled(
    keys.map(key => {
      const { before } = months[key]
      return before === null
        ? fileStore.delete(monthCsvPath(key))
        : fileStore.writeCSV(monthCsvPath(key), parseCSVRows(before))
    }),
  )
  return keys.filter((_, i) => settled[i].status === 'rejected')
}

/**
 * Applies a plan: merges (or replaces) each touched month, adds new categories, and writes only those
 * months plus categories.json. Months that cannot be merged are reported before anything is written, and
 * a failed write puts every touched month back. Returns the new in-memory store on success only.
 * Success is returned only after every awaited write has resolved.
 */
export async function executeImport({
  fileStore,
  store,
  plan,
  snapshot = noopPreImportSnapshot,
}: ExecuteImportArgs): Promise<{ result: CommitResult; store: BudgetStore | null }> {
  const touched = Object.keys(plan.months).filter(month => plan.months[month].added.length > 0)
  const months: UndoRecord['months'] = {}
  const unmergeable: string[] = []

  for (const month of touched) {
    const rows = plan.months[month].added
    const before = store.csvs[month]?.csv ?? null
    const text = plan.options.replaceMonths ? replaceMonthCsv(rows) : appendRowsToMonthCsv(before, rows)
    if (text === null) unmergeable.push(month)
    else months[month] = { before, after: normalizeCsv(text) }
  }
  if (unmergeable.length > 0) {
    return {
      result: { ok: false, reason: 'unmergeable', failedMonths: unmergeable, categoriesFailed: false, restored: true },
      store: null,
    }
  }

  const csvs = { ...store.csvs }
  for (const month of touched) csvs[month] = { month, csv: months[month].after, uploadedAt: '' }
  const years = [...new Set([...store.years, ...touched.map(yearOf)])].sort((a, b) => a - b)
  const addedYears = years.filter(year => !store.years.includes(year))
  const discovered = addDiscoveredCategories(
    { ...store, csvs, years },
    touched.flatMap(month =>
      plan.months[month].added.map(row => ({
        category: row.resolvedCategory,
        amount: row.amountCents,
        spending: row.amountCents === 0,
      })),
    ),
  )

  let snapshotFailed = false
  try {
    await snapshot('import')
  } catch {
    snapshotFailed = true
  }

  try {
    await saveMonths(fileStore, discovered.store, touched)
  } catch (error) {
    const failed = await restoreMonths(fileStore, months)
    return {
      result: {
        ok: false,
        reason: 'write',
        failedMonths: error instanceof SaveMonthsError ? error.failedMonths : touched,
        categoriesFailed: error instanceof SaveMonthsError && error.categoriesFailed,
        restored: failed.length === 0,
      },
      store: null,
    }
  }

  const undo: UndoRecord = { months, addedCategories: discovered.newCategories, addedYears }
  return {
    result: {
      ok: true,
      imported: plan.totals.newRows,
      months: touched,
      newCategories: discovered.newCategories,
      snapshotFailed,
      undo,
    },
    store: discovered.store,
  }
}

/** Undo is offered only while every touched month still holds exactly what the import wrote. */
export function canUndoImport(record: UndoRecord, store: BudgetStore): boolean {
  return Object.entries(record.months).every(([month, { after }]) => {
    const current = store.csvs[month]?.csv
    return current !== undefined && normalizeCsv(current) === after
  })
}

/** Puts the touched months back, removes the categories and years the import added, and writes the result. */
export async function executeUndo({
  fileStore,
  store,
  record,
}: {
  fileStore: FileStore
  store: BudgetStore
  record: UndoRecord
}): Promise<{ result: UndoResult; store: BudgetStore | null }> {
  const csvs = { ...store.csvs }
  const restored: string[] = []
  for (const [month, { before }] of Object.entries(record.months)) {
    if (before === null) delete csvs[month]
    else {
      csvs[month] = { month, csv: before, uploadedAt: '' }
      restored.push(month)
    }
  }

  const added = new Set(record.addedCategories)
  const usedYears = new Set(Object.keys(csvs).map(yearOf))
  const next: BudgetStore = {
    ...store,
    csvs,
    years: store.years.filter(year => !record.addedYears.includes(year) || usedYears.has(year)),
    categoryGroups: (store.categoryGroups || []).map(group => ({
      ...group,
      categories: group.categories.filter(category => !added.has(category)),
    })),
  }

  const deleted = Object.keys(record.months).filter(month => record.months[month].before === null)
  const deletes = await Promise.allSettled(deleted.map(month => fileStore.delete(monthCsvPath(month))))
  const failedDeletes = deleted.filter((_, i) => deletes[i].status === 'rejected')
  try {
    await saveMonths(fileStore, next, restored)
  } catch (error) {
    const failedMonths = error instanceof SaveMonthsError ? error.failedMonths : restored
    return { result: { ok: false, failedMonths: [...failedDeletes, ...failedMonths] }, store: null }
  }
  if (failedDeletes.length > 0) return { result: { ok: false, failedMonths: failedDeletes }, store: null }
  return { result: { ok: true }, store: next }
}
