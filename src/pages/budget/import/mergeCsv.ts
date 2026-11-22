import { parseCSV as parseCSVRows, serializeCSV } from '../../../utils/csvUtils'
import { findLegacyColumns } from '../utils/csvParser'
import { parseAmountToCents } from './parseAmount'
import { parseDate } from './parseDate'
import type { PlannedRow } from './types'

export const CANONICAL_HEADER = ['Date', 'Category', 'Amount', 'Description']

export interface ExistingRow {
  date: string
  amountCents: number
  description: string
}

/** Integer cents as the two-decimal text the legacy parser reads, for example -1250 -> "-12.50". */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents)
  const text = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  return cents < 0 ? `-${text}` : text
}

const headerOf = (row: string[]): string[] => row.map(cell => cell.trim().toLowerCase())

const isoDateOf = (text: string): string | null => {
  const trimmed = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return parseDate(trimmed, 'MM/DD/YYYY')
}

/**
 * Reads the rows of a month file for duplicate detection. Unlike the legacy parser it keeps rows with a
 * blank category, so rows the budget does not show still count as already imported.
 */
export function readExistingRows(csvText: string | null): ExistingRow[] {
  if (!csvText || csvText.trim() === '') return []
  const [header, ...body] = parseCSVRows(csvText)
  const { dateIdx, amtIdx, descIdx } = findLegacyColumns(headerOf(header))
  if (dateIdx === -1 || amtIdx === -1) return []

  const rows: ExistingRow[] = []
  for (const record of body) {
    const date = isoDateOf(record[dateIdx] ?? '')
    const amountCents = parseAmountToCents(record[amtIdx] ?? '', '.')
    if (date === null || amountCents === null) continue
    rows.push({ date, amountCents, description: descIdx === -1 ? '' : (record[descIdx] ?? '').trim() })
  }
  return rows
}

function toRecord(
  row: PlannedRow,
  width: number,
  columns: { dateIdx: number; catIdx: number; amtIdx: number; descIdx: number },
) {
  const record = Array.from({ length: width }, () => '')
  record[columns.dateIdx] = row.date
  record[columns.catIdx] = row.resolvedCategory
  record[columns.amtIdx] = formatCents(row.amountCents)
  record[columns.descIdx] = row.description
  return record
}

/** A month made only of the imported rows, under the canonical header. */
export function replaceMonthCsv(rows: PlannedRow[]): string {
  const columns = { dateIdx: 0, catIdx: 1, amtIdx: 2, descIdx: 3 }
  return serializeCSV([CANONICAL_HEADER, ...rows.map(row => toRecord(row, 4, columns))])
}

/**
 * Appends rows to a month file's text in the file's own column order, leaving every existing byte as it is.
 * A file with no Description column gets one added (existing rows padded with blanks) so nothing is dropped.
 * Returns null when the existing text has no Date, Category and Amount header, because appending would
 * produce a file that parses differently from what the user sees.
 */
export function appendRowsToMonthCsv(existing: string | null, rows: PlannedRow[]): string | null {
  if (existing === null || existing.trim() === '') return replaceMonthCsv(rows)

  const parsed = parseCSVRows(existing)
  const columns = findLegacyColumns(headerOf(parsed[0]))
  if (columns.dateIdx === -1 || columns.catIdx === -1 || columns.amtIdx === -1) return null

  if (columns.descIdx === -1) {
    const width = Math.max(...parsed.map(record => record.length)) + 1
    const padded = parsed.map((record, i) => [
      ...record,
      ...Array.from({ length: width - 1 - record.length }, () => ''),
      i === 0 ? 'Description' : '',
    ])
    const widened = { ...columns, descIdx: width - 1 }
    return serializeCSV([...padded, ...rows.map(row => toRecord(row, width, widened))])
  }

  const width = Math.max(parsed[0].length, columns.descIdx + 1)
  const lines = serializeCSV(rows.map(row => toRecord(row, width, columns)))
  if (lines === '') return existing
  return `${existing.endsWith('\n') ? existing : `${existing}\n`}${lines}`
}
