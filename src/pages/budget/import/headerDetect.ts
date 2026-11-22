import { parseAmountToCents } from './parseAmount'
import { looksLikeDate } from './parseDate'
import type { ColumnMapping } from './types'

export interface HeaderDetection {
  hasHeader: boolean
  /** 0-based index of the header record in the input; -1 when the file has no header. */
  headerIndex: number
  headers: string[]
  /** Records after the header, with trailing blank and footer records removed. */
  dataRecords: string[][]
  /** Non-blank records above the header that were ignored as preamble (account name, date range). */
  preambleCount: number
  /** Non-blank trailing records dropped as footers (totals, balances, generated-on lines). */
  footerCount: number
  /** 1-based record number of `dataRecords[0]`: pass it to normalizeRows so skipped rows cite the file's own rows. */
  firstSourceRow: number
}

export interface DetectHeaderOptions {
  /** `false` forces "first row is data"; `true` falls back to the first non-blank record when nothing is detected. */
  hasHeader?: boolean
  /** Forces the header to this record index (for the "change header row" control). */
  headerIndex?: number
}

const isBlankRecord = (record: string[]): boolean => record.every(cell => cell.trim() === '')
const trimmedLength = (record: string[]): number => {
  let end = record.length
  while (end > 0 && record[end - 1].trim() === '') end--
  return end
}
const hasDateCell = (record: string[]): boolean => record.some(cell => looksLikeDate(cell))
const isAmountCell = (cell: string): boolean =>
  parseAmountToCents(cell, '.') !== null || parseAmountToCents(cell, ',') !== null
const hasAmountCell = (record: string[]): boolean => record.some(isAmountCell)
const looksLikeData = (record: string[]): boolean => hasDateCell(record) && hasAmountCell(record)

const SUMMARY_LABEL =
  /^(?:grand\s+)?(?:sub\s*)?totals?\b|^(?:closing|opening|ending|beginning|available|running|ledger)\b|^balance\b/i
const isSummaryRecord = (record: string[]): boolean => {
  const first = record.find(cell => cell.trim() !== '')
  return !hasAmountCell(record) || (first !== undefined && SUMMARY_LABEL.test(first.trim()))
}

/** The most common record width; ties go to the wider one so a short preamble cannot win. */
export function modalWidth(records: string[][]): number {
  const counts = new Map<number, number>()
  for (const record of records) counts.set(record.length, (counts.get(record.length) ?? 0) + 1)
  let best = 0
  let bestCount = 0
  for (const [width, count] of counts) {
    if (count > bestCount || (count === bestCount && width > best)) {
      best = width
      bestCount = count
    }
  }
  return best
}

function isHeaderLike(record: string[], width: number): boolean {
  const filled = record.filter(cell => cell.trim() !== '')
  const minimum = width < 2 ? 1 : Math.max(2, width - 1)
  return (
    trimmedLength(record) >= minimum &&
    filled.length >= Math.min(2, minimum) &&
    !filled.some(cell => looksLikeDate(cell) || isAmountCell(cell))
  )
}

function findHeaderIndex(records: string[][], width: number): number {
  let relaxed = -1
  for (let index = 0; index < records.length; index++) {
    if (isBlankRecord(records[index])) continue
    // A data row above the candidate means the file has no header: the candidate is a mid-file notes row.
    if (looksLikeData(records[index])) return relaxed
    if (!isHeaderLike(records[index], width)) continue
    let next = index + 1
    while (next < records.length && isBlankRecord(records[next])) next++
    if (next >= records.length || !hasDateCell(records[next])) continue
    if (hasAmountCell(records[next])) return index
    if (relaxed === -1) relaxed = index
  }
  return relaxed
}

/**
 * Drops trailing blank records and footer records. A footer has no date-shaped cell and looks like a summary:
 * it has no amount-like cell, or it starts with a label such as Total or Closing balance. A trailing record
 * with an amount and no date (blank, N/A, Pending) is a transaction with a bad date and stays, so
 * normalizeRows reports it.
 */
function trimTrailing(records: string[][]): { kept: string[][]; footerCount: number } {
  const anyDates = records.some(hasDateCell)
  let end = records.length
  let footerCount = 0
  while (end > 0) {
    const last = records[end - 1]
    if (isBlankRecord(last)) end--
    else if (anyDates && !hasDateCell(last) && isSummaryRecord(last)) {
      end--
      footerCount++
    } else break
  }
  return { kept: records.slice(0, end), footerCount }
}

/**
 * Finds the header row, skipping preamble records (account name, date range) above it and dropping footer
 * records below the data. A header is a text-only record, as wide as the data, followed by a record that
 * has a date and an amount, with no data-looking record (date and amount) above it. Preamble and footer
 * records are counted in the result so callers can account for every source record.
 */
export function detectHeaderRow(records: string[][], options: DetectHeaderOptions = {}): HeaderDetection {
  const nonBlank = records.filter(record => !isBlankRecord(record))
  const width = modalWidth(nonBlank)

  let headerIndex = -1
  if (options.hasHeader !== false) {
    if (options.headerIndex !== undefined) {
      headerIndex = options.headerIndex >= 0 && options.headerIndex < records.length ? options.headerIndex : -1
    } else {
      headerIndex = findHeaderIndex(records, width)
      if (headerIndex === -1 && options.hasHeader === true) headerIndex = records.findIndex(r => !isBlankRecord(r))
    }
  }

  if (headerIndex === -1) {
    const { kept, footerCount } = trimTrailing(records)
    return {
      hasHeader: false,
      headerIndex: -1,
      headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`),
      dataRecords: kept,
      preambleCount: 0,
      footerCount,
      firstSourceRow: 1,
    }
  }

  const { kept, footerCount } = trimTrailing(records.slice(headerIndex + 1))
  return {
    hasHeader: true,
    headerIndex,
    headers: records[headerIndex].map(cell => cell.trim()),
    dataRecords: kept,
    preambleCount: records.slice(0, headerIndex).filter(record => !isBlankRecord(record)).length,
    footerCount,
    firstSourceRow: headerIndex + 2,
  }
}

type MappedField = 'date' | 'amount' | 'debit' | 'credit' | 'description' | 'category'

// Highest priority first. "type" is left out on purpose: it can mean category, debit/credit or payment method.
const SYNONYMS: Record<MappedField, string[]> = {
  date: ['transaction date', 'trans date', 'date', 'posted date', 'posting date', 'post date', 'booking date'],
  amount: ['amount', 'transaction amount', 'amt'],
  debit: ['debit', 'debits', 'debit amount', 'withdrawal', 'withdrawals', 'money out', 'paid out'],
  credit: ['credit', 'credits', 'credit amount', 'deposit', 'deposits', 'money in', 'paid in'],
  description: [
    'description',
    'transaction description',
    'merchant',
    'merchant name',
    'payee',
    'name',
    'memo',
    'narration',
    'narrative',
    'details',
    'transaction details',
    'particulars',
    'original statement',
    'reference',
    'notes',
    'note',
  ],
  category: ['category'],
}

const FIELD_ORDER: MappedField[] = ['date', 'amount', 'debit', 'credit', 'description', 'category']

/** Lowercases, drops diacritics and bracketed units ("Amount (USD)"), and turns punctuation into spaces. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[_\-./#:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Proposes a mapping from header names. Only fields it recognizes are returned; the sign convention, date
 * format and decimal separator are never guessed. Each column is claimed once, and when several columns
 * match, the highest-priority synonym wins, then the leftmost column.
 */
export function suggestMapping(headers: string[]): Partial<ColumnMapping> {
  const normalized = headers.map(normalizeHeader)
  const claimed = new Set<number>()
  const found: Partial<Record<MappedField, number>> = {}

  for (const field of FIELD_ORDER) {
    for (const synonym of SYNONYMS[field]) {
      const index = normalized.findIndex((header, i) => header === synonym && !claimed.has(i))
      if (index !== -1) {
        found[field] = index
        claimed.add(index)
        break
      }
    }
  }

  const suggestion: Partial<ColumnMapping> = {}
  if (found.date !== undefined) suggestion.date = found.date
  if (found.description !== undefined) suggestion.description = found.description
  if (found.category !== undefined) suggestion.category = found.category
  if (found.amount !== undefined) suggestion.amount = found.amount
  if (found.debit !== undefined) suggestion.debit = found.debit
  if (found.credit !== undefined) suggestion.credit = found.credit
  if (found.amount !== undefined) suggestion.amountMode = 'single'
  else if (found.debit !== undefined || found.credit !== undefined) suggestion.amountMode = 'split'
  return suggestion
}
