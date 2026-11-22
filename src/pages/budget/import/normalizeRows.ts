import { serializeCSV } from '../../../utils/csvUtils'
import { MAX_RAW_LENGTH } from './constants'
import { modalWidth } from './headerDetect'
import { parseAmountToCents } from './parseAmount'
import { detectDateFormats, parseDate } from './parseDate'
import type { ColumnMapping, DateFormat, NormalizedRow, SkippedRow } from './types'

export interface NormalizeOptions {
  /** 1-based record number of `records[0]` (HeaderDetection.firstSourceRow). Defaults to 1. */
  firstSourceRow?: number
  /** Expected record width. Defaults to the most common width in `records`. */
  columnCount?: number
  /** Latest accepted year; defaults to next year. */
  maxYear?: number
}

export interface NormalizeResult {
  rows: NormalizedRow[]
  skipped: SkippedRow[]
}

const isBlankRecord = (record: string[]): boolean => record.every(cell => cell.trim() === '')

const cellAt = (record: string[], index: number | null): string => (index === null ? '' : (record[index] ?? '').trim())

const rawText = (record: string[]): string => {
  const raw = serializeCSV([record])
  return raw.length > MAX_RAW_LENGTH ? `${raw.slice(0, MAX_RAW_LENGTH)}…` : raw
}

/** The date format to use: the chosen one, or the only one the data allows; null when it is still ambiguous. */
function resolveDateFormat(records: string[][], mapping: ColumnMapping, maxYear?: number): DateFormat | null {
  if (mapping.dateFormat !== null) return mapping.dateFormat
  const candidates = detectDateFormats(
    records.map(record => cellAt(record, mapping.date)),
    { maxYear },
  )
  return candidates.length === 1 ? candidates[0] : null
}

/** Debit is spending and credit is income whatever sign the bank prints; a row may carry both (0.00 in one). */
function splitAmount(debit: string, credit: string, decimal: ColumnMapping['decimalSeparator']): number | null {
  const debitCents = debit === '' ? 0 : parseAmountToCents(debit, decimal)
  const creditCents = credit === '' ? 0 : parseAmountToCents(credit, decimal)
  if (debitCents === null || creditCents === null) return null
  return Math.abs(creditCents) - Math.abs(debitCents) || 0
}

function singleAmount(text: string, mapping: ColumnMapping): number | null {
  const cents = parseAmountToCents(text, mapping.decimalSeparator)
  if (cents === null) return null
  return mapping.signConvention === 'positive-is-spending' ? -cents || 0 : cents
}

type ParsedFields = Omit<NormalizedRow, 'sourceRow'>

/** Parses one non-blank record into its fields, or returns the reason it cannot be used. */
function parseRecord(
  record: string[],
  mapping: ColumnMapping,
  dateFormat: DateFormat | null,
  width: number,
  maxYear: number | undefined,
): ParsedFields | SkippedRow['reason'] {
  if (record.length < width || record.slice(width).some(cell => cell.trim() !== '')) return 'column-count'

  const dateText = cellAt(record, mapping.date)
  const split = mapping.amountMode === 'split'
  const amountText = cellAt(record, mapping.amount)
  const debitText = cellAt(record, mapping.debit)
  const creditText = cellAt(record, mapping.credit)
  const moneyBlank = split ? debitText === '' && creditText === '' : amountText === ''

  if (dateText === '' && moneyBlank) return 'empty'
  const date = dateFormat === null ? null : parseDate(dateText, dateFormat, { maxYear })
  if (date === null) return 'bad-date'
  if (split && moneyBlank) return 'empty'

  const amountCents = split
    ? splitAmount(debitText, creditText, mapping.decimalSeparator)
    : singleAmount(amountText, mapping)
  if (amountCents === null) return 'bad-amount'

  const category = cellAt(record, mapping.category)
  return {
    date,
    amountCents,
    description: cellAt(record, mapping.description),
    category: category === '' ? null : category,
  }
}

/**
 * Turns data records into rows with an ISO date and integer cents (negative = spending), and lists every
 * record it could not use with its row number and a reason. Records that are entirely blank are ignored
 * without being listed. Never throws.
 *
 * Ragged records (wrong width) are skipped as 'column-count'; extra trailing empty cells are tolerated.
 * With `dateFormat: null` the format is taken from the data only when it is unambiguous; otherwise every
 * row is skipped as 'bad-date' rather than guessing between DD/MM and MM/DD.
 */
export function normalizeRows(
  records: string[][],
  mapping: ColumnMapping,
  options: NormalizeOptions = {},
): NormalizeResult {
  const rows: NormalizedRow[] = []
  const skipped: SkippedRow[] = []
  const firstSourceRow = options.firstSourceRow ?? 1
  const present = records.filter(record => !isBlankRecord(record))
  const width = options.columnCount ?? modalWidth(present)
  const dateFormat = resolveDateFormat(present, mapping, options.maxYear)

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (isBlankRecord(record)) continue
    const sourceRow = firstSourceRow + i
    const result = parseRecord(record, mapping, dateFormat, width, options.maxYear)
    if (typeof result === 'string') {
      skipped.push({ sourceRow, reason: result, raw: rawText(record) })
    } else {
      rows.push({ sourceRow, ...result })
    }
  }

  return { rows, skipped }
}
