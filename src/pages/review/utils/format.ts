import { formatCurrency, formatMonth } from '../../data/types'

export const NOT_AVAILABLE = 'Not available'
export const NO_CHANGE = 'No change'

export type DeltaKind = 'usd' | 'percent' | 'points'

const MONTH_NAMES_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** Formats the magnitude once and reports whether it rounds to zero, so "-0.0" never appears. */
function formatMagnitude(n: number, formatter: Intl.NumberFormat): { text: string; isZero: boolean } {
  const text = formatter.format(Math.abs(n))
  return { text, isZero: Number(text.replace(/,/g, '')) === 0 }
}

/** Whole US dollars, "-$1,234" for negatives. */
export function formatMoney(n: number | null): string {
  if (n === null) return NOT_AVAILABLE
  const { isZero } = formatMagnitude(n, wholeNumber)
  return formatCurrency(isZero ? 0 : n)
}

/** One decimal and a percent sign, "-2.1%" for negatives. */
export function formatPercent(n: number | null): string {
  if (n === null) return NOT_AVAILABLE
  const { text, isZero } = formatMagnitude(n, oneDecimal)
  return `${n < 0 && !isZero ? '-' : ''}${text}%`
}

/** "Up $X", "Down $X", "Up N.N%", "Up N.N points", or "No change" when the rounded value is 0. */
export function formatDelta(n: number | null, kind: DeltaKind): string {
  if (n === null) return NOT_AVAILABLE
  const { text, isZero } = formatMagnitude(n, kind === 'usd' ? wholeNumber : oneDecimal)
  if (isZero) return NO_CHANGE
  const direction = n < 0 ? 'Down' : 'Up'
  if (kind === 'usd') return `${direction} $${text}`
  if (kind === 'percent') return `${direction} ${text}%`
  return `${direction} ${text} ${text === '1.0' ? 'point' : 'points'}`
}

/** "A", "A and B", "A, B, and C". */
export function formatList(items: string[]): string {
  if (items.length <= 2) return items.join(' and ')
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/** "1 month", "2 months". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** "Dec 2024" */
export const formatMonthShort = formatMonth

/** "December 2024" */
export function formatMonthLong(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTH_NAMES_LONG[parseInt(m, 10) - 1]} ${y}`
}

/** "December", for sentences that already carry the year elsewhere. */
export function formatMonthName(ym: string): string {
  return formatMonthLong(ym).split(' ')[0]
}

const AXIS_UNITS = [
  { min: 1e6, divisor: 1e6, suffix: 'M' },
  { min: 1e3, divisor: 1e3, suffix: 'K' },
  { min: 0, divisor: 1, suffix: '' },
]
const axisUnit = (v: number) => AXIS_UNITS.find(u => Math.abs(v) >= u.min)!

/**
 * Short dollar labels ("$1.25M", "-$20K") for a set of axis values, with just enough decimals
 * that every label reads back as exactly its gridline value.
 */
export function formatAxisLabels(values: number[]): string[] {
  const exact = (decimals: number) =>
    values.every(v => {
      const { divisor } = axisUnit(v)
      return Math.abs(Number((v / divisor).toFixed(decimals)) * divisor - v) < 1e-6
    })
  let decimals = 0
  while (decimals < 6 && !exact(decimals)) decimals += 1
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals })
  return values.map(v => {
    const { divisor, suffix } = axisUnit(v)
    const magnitude = number.format(Math.abs(v) / divisor)
    return `${v < 0 && Number(magnitude.replace(/,/g, '')) !== 0 ? '-' : ''}$${magnitude}${suffix}`
  })
}

/** "2026-11-08" in the local time zone. */
export function formatIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
