import { plural } from '../../../utils/plural'
import type { ImportPlan, PlannedRow, SkipReason } from './types'

export type ReviewFilter = 'all' | 'new' | 'duplicates' | 'skipped'

export interface ReviewEntry {
  key: string
  kind: 'new' | 'duplicate' | 'skipped'
  fileName: string
  fileIndex: number
  sourceRow: number
  date: string
  description: string
  category: string
  amountCents: number | null
  /** Set for skipped rows. */
  reason?: SkipReason
}

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  'bad-date': 'Date not recognized',
  'bad-amount': 'Amount not recognized',
  empty: 'Empty row',
  'column-count': 'Wrong number of columns',
}

const entryOf = (row: PlannedRow, kind: 'new' | 'duplicate'): ReviewEntry => ({
  key: `${row.fileIndex}:${row.sourceRow}`,
  kind,
  fileName: row.fileName,
  fileIndex: row.fileIndex,
  sourceRow: row.sourceRow,
  date: row.date,
  description: row.description,
  category: row.resolvedCategory,
  amountCents: row.amountCents,
})

/** Every row of the plan as one list in file order: new, duplicate and skipped. */
export function reviewEntries(plan: ImportPlan): ReviewEntry[] {
  const duplicates = new Set<PlannedRow>()
  const months = Object.values(plan.months)
  months.forEach(month => month.duplicateRows.forEach(row => duplicates.add(row)))

  const entries: ReviewEntry[] = []
  months.forEach(month => {
    month.added.forEach(row => entries.push(entryOf(row, duplicates.has(row) ? 'duplicate' : 'new')))
    if (plan.options.skipDuplicates) month.duplicateRows.forEach(row => entries.push(entryOf(row, 'duplicate')))
  })
  plan.skipped.forEach(row =>
    entries.push({
      key: `${row.fileIndex}:${row.sourceRow}:skipped`,
      kind: 'skipped',
      fileName: row.fileName,
      fileIndex: row.fileIndex,
      sourceRow: row.sourceRow,
      date: '',
      description: row.raw,
      category: '',
      amountCents: null,
      reason: row.reason,
    }),
  )
  return entries.sort((a, b) => a.fileIndex - b.fileIndex || a.sourceRow - b.sourceRow)
}

export const filterEntries = (entries: ReviewEntry[], filter: ReviewFilter): ReviewEntry[] =>
  filter === 'all'
    ? entries
    : entries.filter(
        entry => entry.kind === (filter === 'new' ? 'new' : filter === 'duplicates' ? 'duplicate' : 'skipped'),
      )

export const countLabel = (n: number, one: string, other: string): string =>
  `${n.toLocaleString()} ${plural(n, one, other)}`
