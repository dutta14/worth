import { MIN_PLAUSIBLE_YEAR } from './constants'
import type { DateFormat } from './types'

/*
 * Pure string math: no Date object touches a parsed value, so the result cannot shift with the local
 * timezone (the legacy `new Date(y, m, d)` and `new Date(text).toISOString()` paths can).
 */

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

type Part = 'year' | 'month' | 'day' | 'monthName' | 'shortYear'

interface FormatSpec {
  pattern: RegExp
  parts: Part[]
}

export const DATE_FORMATS: readonly DateFormat[] = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'MM-DD-YYYY',
  'DD-MM-YYYY',
  'DD.MM.YYYY',
  'MM/DD/YY',
  'DD/MM/YY',
  'D MMM YYYY',
  'MMM D, YYYY',
  'YYYYMMDD',
]

const FORMAT_SPECS: Record<DateFormat, FormatSpec> = {
  'YYYY-MM-DD': { pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, parts: ['year', 'month', 'day'] },
  'YYYY/MM/DD': { pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, parts: ['year', 'month', 'day'] },
  'MM/DD/YYYY': { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, parts: ['month', 'day', 'year'] },
  'DD/MM/YYYY': { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, parts: ['day', 'month', 'year'] },
  'MM-DD-YYYY': { pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, parts: ['month', 'day', 'year'] },
  'DD-MM-YYYY': { pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, parts: ['day', 'month', 'year'] },
  'DD.MM.YYYY': { pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, parts: ['day', 'month', 'year'] },
  'MM/DD/YY': { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, parts: ['month', 'day', 'shortYear'] },
  'DD/MM/YY': { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, parts: ['day', 'month', 'shortYear'] },
  'D MMM YYYY': { pattern: /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4})$/, parts: ['day', 'monthName', 'year'] },
  'MMM D, YYYY': {
    pattern: /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/,
    parts: ['monthName', 'day', 'year'],
  },
  YYYYMMDD: { pattern: /^(\d{4})(\d{2})(\d{2})$/, parts: ['year', 'month', 'day'] },
}

// A trailing clock time, optionally with AM/PM and a zone, such as "T10:30:00Z" or " 3:45 PM".
const TIME_SUFFIX =
  /[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s*[AaPp]\.?[Mm]\.?)?(?:\s*(?:Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?))?$/

/** The latest year parseDate accepts by default: next year, in UTC so it cannot depend on the local zone. */
export const maxPlausibleYear = (): number => new Date().getUTCFullYear() + 1

export interface ParseDateOptions {
  maxYear?: number
}

const MAX_DATE_LENGTH = 40

// The format patterns only pass 3 to 9 letters, so a prefix identifies exactly one month.
const monthFromName = (word: string): number | null => {
  const lower = word.toLowerCase()
  const index = MONTH_NAMES.findIndex(name => name.startsWith(lower))
  return index === -1 ? null : index + 1
}

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

const stripTime = (text: string): string => {
  const trimmed = text.trim()
  const match = trimmed.match(TIME_SUFFIX)
  return match && match.index !== undefined && match.index > 0 ? trimmed.slice(0, match.index) : trimmed
}

/** Splits `text` into raw parts for `format`; null when the text does not have that shape. */
function matchShape(text: string, format: DateFormat): Partial<Record<Part, string>> | null {
  // No date is this long; the cap keeps the regexes cheap on huge free-text cells.
  if (text.length > MAX_DATE_LENGTH) return null
  const spec = FORMAT_SPECS[format]
  const match = stripTime(text).match(spec.pattern)
  if (!match) return null
  const parts: Partial<Record<Part, string>> = {}
  spec.parts.forEach((part, i) => {
    parts[part] = match[i + 1]
  })
  return parts
}

/**
 * Parses `text` as `format` into YYYY-MM-DD. Returns null for text of another shape, impossible
 * calendar dates (2026-02-30), and years outside 1990..maxYear (default: next year).
 */
export function parseDate(text: string, format: DateFormat, options: ParseDateOptions = {}): string | null {
  const parts = matchShape(text, format)
  if (!parts) return null

  const month = parts.monthName !== undefined ? monthFromName(parts.monthName) : Number(parts.month)
  if (month === null) return null
  const day = Number(parts.day)
  let year = Number(parts.year ?? parts.shortYear)
  if (parts.shortYear !== undefined) year += year >= 90 ? 1900 : 2000

  const maxYear = options.maxYear ?? maxPlausibleYear()
  if (year < MIN_PLAUSIBLE_YEAR || year > maxYear) return null
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** True when `text` has the shape of a date in any supported format, without checking the calendar. */
export function looksLikeDate(text: string): boolean {
  return DATE_FORMATS.some(format => matchShape(text, format) !== null)
}

/**
 * Formats under which every parseable sample is a valid date. Samples that fit no format at all
 * (footers, junk) are ignored so one bad cell cannot hide the answer. More than one result means the
 * data is ambiguous (for example 03/04/2026) and the user has to choose.
 */
export function detectDateFormats(samples: string[], options: ParseDateOptions = {}): DateFormat[] {
  const cells = samples.map(s => s.trim()).filter(s => s !== '')
  const usable = cells.filter(cell => DATE_FORMATS.some(format => parseDate(cell, format, options) !== null))
  if (usable.length === 0) return []
  return DATE_FORMATS.filter(format => usable.every(cell => parseDate(cell, format, options) !== null))
}
