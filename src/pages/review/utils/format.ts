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

const compactMoney = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

/** "$460K", "-$1.2M": short axis labels. */
export function formatMoneyCompact(n: number): string {
  return compactMoney.format(n === 0 ? 0 : n)
}
