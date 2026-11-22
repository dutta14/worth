import { parseCSV as parseCSVRows, serializeCSV } from '../../../utils/csvUtils'
import type { FileStore } from '../../../utils/fileStoreTypes'
import type { BudgetStore } from '../types'
import { saveMonths, SaveMonthsError } from '../utils/budgetStorage'
import { findLegacyColumns } from '../utils/csvParser'
import { executeUndo, normalizeCsv, type UndoRecord } from './commitImport'
import { UNCATEGORIZED_EXPENSE, UNCATEGORIZED_INCOME } from './constants'
import {
  cleanRuleValue,
  compileRules,
  matchRulesDetailed,
  MIN_RULE_VALUE,
  normalizeDescription,
  type CategoryResolver,
  type CategoryRule,
  type CompiledRule,
  type RuleDraft,
} from './rules'

const FALLBACKS = new Set([UNCATEGORIZED_EXPENSE.toLowerCase(), UNCATEGORIZED_INCOME.toLowerCase()])

/** True for the two categories imports use when a row arrives without one. Rules apply only to these. */
export const isFallbackCategory = (category: string): boolean => FALLBACKS.has(category.trim().toLowerCase())

const headerOf = (row: string[]): string[] => row.map(cell => cell.trim().toLowerCase())

export interface MonthRecategorization {
  before: string
  after: string
  changed: number
}

export interface RecategorizePlan {
  /** Only months with at least one change, keyed by 'YYYY-MM'. */
  months: Record<string, MonthRecategorization>
  changed: number
  /** Rules that matched a row but were passed over because their category no longer exists. */
  skippedRules: number
}

/**
 * Works out which uncategorized rows the rules would move, without writing anything. Edits are made on the
 * parsed cells of the existing month file, so every other column and row is carried over untouched. Rows are
 * addressed by position, never matched by value, so identical same-day rows are told apart.
 * With `onlyRuleId`, only rows that rule would win are changed.
 */
export function planRecategorize(
  csvs: Record<string, { csv: string }>,
  rules: CategoryRule[],
  resolve: CategoryResolver,
  onlyRuleId?: string,
): RecategorizePlan {
  const compiled = compileRules(rules, resolve)
  const skippedRules = new Set<string>()
  const months: Record<string, MonthRecategorization> = {}
  let changed = 0

  for (const month of Object.keys(csvs).sort()) {
    const before = csvs[month].csv
    const rows = parseCSVRows(before)
    if (rows.length < 2) continue
    const { dateIdx, catIdx, amtIdx, descIdx } = findLegacyColumns(headerOf(rows[0]))
    if (dateIdx === -1 || catIdx === -1 || amtIdx === -1 || descIdx === -1) continue

    let next: string[][] | null = null
    let monthChanged = 0
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (!(row[dateIdx] ?? '').trim() || !(row[amtIdx] ?? '').trim()) continue
      const current = (row[catIdx] ?? '').trim()
      if (!isFallbackCategory(current)) continue
      const match = matchRulesDetailed(compiled, row[descIdx] ?? '')
      match.skipped.forEach(id => skippedRules.add(id))
      if (match.category === null || (onlyRuleId !== undefined && match.ruleId !== onlyRuleId)) continue
      if (match.category.trim().toLowerCase() === current.toLowerCase()) continue
      next ??= rows.map(cells => [...cells])
      next[i][catIdx] = match.category
      monthChanged++
    }
    if (next) {
      months[month] = { before, after: normalizeCsv(serializeCSV(next)), changed: monthChanged }
      changed += monthChanged
    }
  }
  return { months, changed, skippedRules: skippedRules.size }
}

export type RecategorizeResult =
  | { ok: true; changed: number; months: string[]; undo: UndoRecord }
  | { ok: false; reason: 'stale' | 'write'; failedMonths: string[]; restored: boolean }

/**
 * Writes a plan. It refuses (`stale`) when a month no longer holds the text the plan was made from, and puts
 * every month back if a write fails. Success is returned only after every write has resolved.
 */
export async function executeRecategorize({
  fileStore,
  store,
  plan,
}: {
  fileStore: FileStore
  store: BudgetStore
  plan: RecategorizePlan
}): Promise<{ result: RecategorizeResult; store: BudgetStore | null }> {
  const touched = Object.keys(plan.months)
  const stale = touched.filter(month => store.csvs[month]?.csv !== plan.months[month].before)
  if (stale.length > 0) {
    return { result: { ok: false, reason: 'stale', failedMonths: stale, restored: true }, store: null }
  }

  const undo: UndoRecord = {
    months: Object.fromEntries(
      touched.map(month => [month, { before: plan.months[month].before, after: plan.months[month].after }]),
    ),
    addedCategories: [],
    addedYears: [],
  }
  const next: BudgetStore = {
    ...store,
    csvs: {
      ...store.csvs,
      ...Object.fromEntries(touched.map(month => [month, { month, csv: plan.months[month].after, uploadedAt: '' }])),
    },
  }
  try {
    await saveMonths(fileStore, next, touched)
  } catch (error) {
    const rolledBack = await executeUndo({ fileStore, store: next, record: undo })
    return {
      result: {
        ok: false,
        reason: 'write',
        failedMonths: error instanceof SaveMonthsError && error.failedMonths.length > 0 ? error.failedMonths : touched,
        restored: rolledBack.result.ok,
      },
      store: null,
    }
  }
  return { result: { ok: true, changed: plan.changed, months: touched, undo }, store: next }
}

/** A transaction reduced to what the live match count needs, so typing does not re-normalize every row. */
export interface ImpactRow {
  text: string
  fallback: boolean
}

export const toImpactRows = (rows: { description?: string; category: string }[]): ImpactRow[] =>
  rows.map(row => ({ text: normalizeDescription(row.description ?? ''), fallback: isFallbackCategory(row.category) }))

export interface RuleImpact {
  /** Transactions whose description contains the value. */
  matches: number
  /** Uncategorized transactions the new rule would move, after rules above it have had their say. */
  applicable: number
}

const NEW_RULE_ID = '__new__'

export function countRuleImpact(
  rows: ImpactRow[],
  rules: CategoryRule[],
  resolve: CategoryResolver,
  draft: RuleDraft,
): RuleImpact {
  const value = cleanRuleValue(draft.value)
  if (value.length < MIN_RULE_VALUE) return { matches: 0, applicable: 0 }
  const needle = normalizeDescription(value)
  const compiled: CompiledRule[] = [
    ...compileRules(rules, resolve),
    { id: NEW_RULE_ID, needle, category: draft.category.trim() || NEW_RULE_ID },
  ]
  let matches = 0
  let applicable = 0
  for (const row of rows) {
    if (!row.text.includes(needle)) continue
    matches++
    if (row.fallback && matchRulesDetailed(compiled, row.text).ruleId === NEW_RULE_ID) applicable++
  }
  return { matches, applicable }
}
