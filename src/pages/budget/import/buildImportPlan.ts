import type { CategoryGroup } from '../types'
import { discoverCategories } from '../utils/categoryDiscovery'
import { UNCATEGORIZED_EXPENSE, UNCATEGORIZED_INCOME } from './constants'
import { applyDedupe, dedupeKey } from './dedupe'
import { readExistingRows } from './mergeCsv'
import { categoryResolver, compileRules, matchRules, type CategoryRule } from './rules'
import type {
  ImportOptions,
  ImportPlan,
  MonthPlan,
  NormalizedRow,
  PlanFileSummary,
  PlannedRow,
  PlanSkippedRow,
  SkippedRow,
} from './types'

export interface PlanFileInput {
  name: string
  rows: NormalizedRow[]
  skipped: SkippedRow[]
  /** Tokenizer messages for this file, such as an unterminated quote. */
  notices?: string[]
}

export interface PlanInput {
  files: PlanFileInput[]
  /** Existing month files by 'YYYY-MM'. */
  existingCsvs: Record<string, string>
  categoryGroups: CategoryGroup[]
  options: ImportOptions
  /** Applied, in order, to rows that arrive without a category. Defaults to none. */
  rules?: CategoryRule[]
}

export const monthOf = (date: string): string => date.slice(0, 7)

/** Zero amounts use the expense fallback. */
export const fallbackCategoryFor = (amountCents: number): string =>
  amountCents > 0 ? UNCATEGORIZED_INCOME : UNCATEGORIZED_EXPENSE

/**
 * Turns normalized rows into a commit plan without touching storage: groups rows by their own date, gives
 * rows without a category the category of the first matching rule, files the rest under the sign-based
 * fallbacks, drops duplicates, and counts what will change. File-supplied category names match existing
 * ones case-insensitively and take the existing spelling; rules never override a category from the file.
 */
export function buildImportPlan({ files, existingCsvs, categoryGroups, options, rules = [] }: PlanInput): ImportPlan {
  const spelling = new Map<string, string>()
  const remember = (name: string): string => {
    const key = name.trim().toLowerCase()
    const known = spelling.get(key)
    if (known !== undefined) return known
    spelling.set(key, name)
    return name
  }
  categoryGroups.flatMap(group => group.categories).forEach(remember)
  const compiledRules = compileRules(rules, categoryResolver(categoryGroups))
  const ruled = new Set<PlannedRow>()
  const passedOver = new Map<PlannedRow, string[]>()

  const known = new Map<string, Map<string, number>>()
  const monthPlans = new Map<string, MonthPlan>()
  const summaries: PlanFileSummary[] = []
  const skipped: PlanSkippedRow[] = []
  const notices: string[] = []

  const monthPlan = (month: string): MonthPlan => {
    let plan = monthPlans.get(month)
    if (plan) return plan
    const existing = readExistingRows(existingCsvs[month] ?? null)
    known.set(month, options.replaceMonths ? new Map() : countKeys(existing))
    plan = {
      added: [],
      duplicateRows: [],
      existingCount: existing.length,
      hasExistingFile: (existingCsvs[month] ?? '').trim() !== '',
    }
    monthPlans.set(month, plan)
    return plan
  }

  for (const [fileIndex, file] of files.entries()) {
    const summary: PlanFileSummary = { name: file.name, newRows: 0, duplicates: 0, skipped: file.skipped.length }
    summaries.push(summary)
    notices.push(...(file.notices ?? []))
    file.skipped.forEach(row => skipped.push({ ...row, fileName: file.name, fileIndex }))

    const byMonth = new Map<string, PlannedRow[]>()
    for (const row of file.rows) {
      const match = row.category === null ? matchRules(compiledRules, row.description) : null
      const category = row.category ?? match?.category ?? null
      const planned: PlannedRow = {
        ...row,
        fileName: file.name,
        fileIndex,
        fallback: category === null,
        resolvedCategory: remember(category ?? fallbackCategoryFor(row.amountCents)),
      }
      if (match?.category) ruled.add(planned)
      if (match && match.skipped.length > 0) passedOver.set(planned, match.skipped)
      const month = monthOf(row.date)
      const list = byMonth.get(month)
      if (list) list.push(planned)
      else byMonth.set(month, [planned])
    }

    for (const [month, rows] of byMonth) {
      const plan = monthPlan(month)
      const { accepted, duplicates } = applyDedupe(rows, known.get(month)!)
      const added = options.skipDuplicates ? accepted : rows
      for (const row of added) plan.added.push(row)
      for (const row of duplicates) plan.duplicateRows.push(row)
      summary.newRows += added.length
      summary.duplicates += duplicates.length
    }
  }

  const months: Record<string, MonthPlan> = {}
  for (const month of [...monthPlans.keys()].sort()) months[month] = monthPlans.get(month)!

  const addedRows = Object.values(months).flatMap(plan => plan.added)
  const discovered = discoverCategories(
    categoryGroups,
    addedRows.map(row => ({
      category: row.resolvedCategory,
      amount: row.amountCents,
      spending: row.amountCents === 0,
    })),
  )

  return {
    months,
    options,
    totals: {
      newRows: addedRows.length,
      duplicates: summaries.reduce((sum, file) => sum + file.duplicates, 0),
      skipped: skipped.length,
      spendingCents: addedRows.reduce((sum, row) => (row.amountCents < 0 ? sum - row.amountCents : sum), 0),
      incomeCents: addedRows.reduce((sum, row) => (row.amountCents > 0 ? sum + row.amountCents : sum), 0),
    },
    files: summaries,
    newCategories: [
      ...discovered.expense.map(name => ({ name, group: 'expense' as const })),
      ...discovered.income.map(name => ({ name, group: 'income' as const })),
    ],
    fallbackCount: addedRows.filter(row => row.fallback).length,
    rulesApplied: addedRows.filter(row => ruled.has(row)).length,
    rulesSkipped: new Set(addedRows.flatMap(row => passedOver.get(row) ?? [])).size,
    skipped,
    notices,
  }
}

function countKeys(rows: Pick<NormalizedRow, 'date' | 'amountCents' | 'description'>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = dedupeKey(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
