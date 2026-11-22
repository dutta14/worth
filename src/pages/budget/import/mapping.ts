import { findLegacyColumns } from '../utils/csvParser'
import { formatMonth } from './format'
import { suggestMapping } from './headerDetect'
import { parseAmountToCents } from './parseAmount'
import { detectDateFormats, parseDate } from './parseDate'
import type { AmountMode, ColumnMapping, DateFormat, DecimalSeparator, SignConvention } from './types'

/** The Columns step's working copy of a mapping: a choice the user has not made yet is `null`. */
export interface MappingDraft {
  amountMode: AmountMode
  date: number | null
  description: number | null
  amount: number | null
  debit: number | null
  credit: number | null
  category: number | null
  signConvention: SignConvention | null
  dateFormat: DateFormat | null
  decimalSeparator: DecimalSeparator
}

export type MappingProblem = 'date-column' | 'amount-column' | 'money-column' | 'sign' | 'no-dates' | 'date-format'

export interface DateInfo {
  /** Formats under which every readable sample is a valid date. */
  candidates: DateFormat[]
  /** The format in force: the user's pick, or the only candidate. */
  format: DateFormat | null
  /** First non-empty date cell, for the live sample. */
  sample: string | null
}

/** Cells examined when working out which date formats fit; the full file is read with the chosen format. */
const DATE_SAMPLE_LIMIT = 5000

const cell = (record: string[], index: number | null): string => (index === null ? '' : (record[index] ?? '').trim())

/** Commas as decimals ("12,50") are recognized when no sample uses a period decimal. */
function guessDecimal(records: string[][], draft: Pick<MappingDraft, 'amount' | 'debit' | 'credit'>): DecimalSeparator {
  const columns = [draft.amount, draft.debit, draft.credit].filter((c): c is number => c !== null)
  let comma = 0
  let period = 0
  for (const record of records.slice(0, 200)) {
    for (const column of columns) {
      const text = cell(record, column)
      if (/\d,\d{1,2}$/.test(text)) comma++
      else if (/\d\.\d{1,2}$/.test(text)) period++
    }
  }
  return comma > 0 && period === 0 ? ',' : '.'
}

/** Starting point for the Columns step: header-name suggestions, with the sign and date format left unchosen. */
export function initialDraft(headers: string[], records: string[][]): MappingDraft {
  const suggestion = suggestMapping(headers)
  const base = {
    amountMode: suggestion.amountMode ?? 'single',
    date: suggestion.date ?? null,
    description: suggestion.description ?? null,
    amount: suggestion.amount ?? null,
    debit: suggestion.debit ?? null,
    credit: suggestion.credit ?? null,
    category: suggestion.category ?? null,
  } as const
  return { ...base, signConvention: null, dateFormat: null, decimalSeparator: guessDecimal(records, base) }
}

export function dateInfo(records: string[][], draft: MappingDraft): DateInfo {
  if (draft.date === null) return { candidates: [], format: null, sample: null }
  const cells = records.slice(0, DATE_SAMPLE_LIMIT).map(record => cell(record, draft.date))
  const candidates = detectDateFormats(cells)
  const sample = cells.find(text => text !== '') ?? null
  const format =
    draft.dateFormat !== null && candidates.includes(draft.dateFormat)
      ? draft.dateFormat
      : candidates.length === 1
        ? candidates[0]
        : null
  return { candidates, format, sample }
}

/** Spells a date in `format` as "Mar 4, 2026" so the user can see how it was read. */
export function readableDate(text: string, format: DateFormat): string | null {
  const iso = parseDate(text, format)
  if (iso === null) return null
  const [year, month, day] = iso.split('-').map(Number)
  return `${formatMonth(`${year}-${month}`).split(' ')[0]} ${day}, ${year}`
}

export interface ResolvedMapping {
  mapping: ColumnMapping | null
  problems: MappingProblem[]
}

/** Checks a draft against the data and returns a usable mapping, or the reasons Continue must stay disabled. */
export function resolveMapping(records: string[][], draft: MappingDraft): ResolvedMapping {
  const problems: MappingProblem[] = []
  if (draft.date === null) problems.push('date-column')

  if (draft.amountMode === 'single') {
    if (draft.amount === null) problems.push('amount-column')
    else if (draft.signConvention === null) problems.push('sign')
  } else if (draft.debit === null && draft.credit === null) {
    problems.push('money-column')
  }

  if (draft.date !== null) {
    const { candidates, format } = dateInfo(records, draft)
    if (candidates.length === 0) problems.push('no-dates')
    else if (format === null) problems.push('date-format')
  }

  if (problems.length > 0 || draft.date === null) return { mapping: null, problems }
  return {
    mapping: {
      amountMode: draft.amountMode,
      date: draft.date,
      description: draft.description,
      amount: draft.amountMode === 'single' ? draft.amount : null,
      debit: draft.amountMode === 'split' ? draft.debit : null,
      credit: draft.amountMode === 'split' ? draft.credit : null,
      category: draft.category,
      signConvention: draft.signConvention ?? 'negative-is-spending',
      dateFormat: dateInfo(records, draft).format,
      decimalSeparator: draft.decimalSeparator,
    },
    problems: [],
  }
}

/** The draft a mapping would have been built from, so a mapping can be reused for a file with the same headers. */
export const draftFromMapping = (mapping: ColumnMapping): MappingDraft => ({ ...mapping })

/**
 * Mapping for a file whose header is the legacy canonical shape (Date, Category, Amount[, Description]), or
 * null when the Columns step is still needed (no such header, or the dates are ambiguous or unreadable).
 * Spending is negative in that format, as it is in the legacy importer.
 */
export function legacyMapping(headers: string[], records: string[][]): ColumnMapping | null {
  const { dateIdx, catIdx, amtIdx, descIdx } = findLegacyColumns(headers.map(h => h.trim().toLowerCase()))
  if (dateIdx === -1 || catIdx === -1 || amtIdx === -1) return null
  const draft: MappingDraft = {
    amountMode: 'single',
    date: dateIdx,
    description: descIdx === -1 ? null : descIdx,
    amount: amtIdx,
    debit: null,
    credit: null,
    category: catIdx,
    signConvention: 'negative-is-spending',
    dateFormat: null,
    decimalSeparator: '.',
  }
  return resolveMapping(records, draft).mapping
}

/** True when every non-blank value in the mapped amount columns has the same sign (a likely wrong sign choice). */
export function sameSignWarning(records: string[][], draft: MappingDraft): 'positive' | 'negative' | null {
  if (draft.amountMode !== 'single' || draft.amount === null) return null
  let positive = 0
  let negative = 0
  for (const record of records) {
    const cents = parseAmountToCents(cell(record, draft.amount), draft.decimalSeparator)
    if (cents === null || cents === 0) continue
    if (cents > 0) positive++
    else negative++
  }
  if (positive > 0 && negative === 0) return 'positive'
  if (negative > 0 && positive === 0) return 'negative'
  return null
}
