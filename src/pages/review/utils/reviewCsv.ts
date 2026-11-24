import { serializeCSV } from '../../../utils/csvUtils'
import type { AnnualReview, NetWorthAnchor, NetWorthReview } from '../types'
import { formatList, pluralize } from './format'
import { describeNote } from './noteText'

export const CSV_HEADER = ['section', 'item', 'label', 'value', 'unit', 'share_percent', 'note']

const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)$/
const FORMULA_START = /^[=+\-@\t\r]/

/** Stops spreadsheets from running text as a formula; numeric-looking text is left alone. */
const safeText = (text: string): string => (FORMULA_START.test(text) && !NUMERIC_TEXT.test(text) ? `'${text}` : text)

const fixed = (n: number | null): string => {
  if (n === null) return ''
  const text = n.toFixed(2)
  return text === '-0.00' ? '0.00' : text
}

type Unit = 'text' | 'year' | 'date' | 'month' | 'usd' | 'percent'

const textRow = (section: string, item: string, label: string, value: string, unit: Unit, note = ''): string[] => [
  section,
  item,
  safeText(label),
  safeText(value),
  unit,
  '',
  safeText(note),
]

const numberRow = (
  section: string,
  item: string,
  label: string,
  value: number | null,
  unit: 'usd' | 'percent',
  note = '',
  share: number | null = null,
): string[] => [
  section,
  item,
  safeText(label),
  fixed(value),
  unit,
  fixed(share),
  safeText(value === null && note === '' ? 'Not available' : note),
]

const usable = (a: NetWorthAnchor): boolean => a.status === 'exact' || a.status === 'nearest'

const anchorNote = (a: NetWorthAnchor): string =>
  a.status === 'incomplete' && a.missing.length > 0
    ? `incomplete, missing ${formatList(a.missing.map(m => m.name))}`
    : a.status

const changeReason = ({ start, end }: NetWorthReview): string => {
  if (!usable(start) && !usable(end)) return 'Starting and ending net worth are not available'
  if (!usable(start)) return 'Starting net worth is not available'
  if (!usable(end)) return 'Ending net worth is not available'
  return 'Only one month of balances is recorded'
}

const netWorthRows = ({ netWorth }: AnnualReview): string[][] => {
  const { start, end, change, changePct } = netWorth
  const totalOf = (a: NetWorthAnchor) => (usable(a) ? a.total : null)
  const reason = (a: NetWorthAnchor) => (usable(a) ? '' : `${anchorNote(a)}; no total`)
  const pctReason =
    changePct !== null
      ? ''
      : change === null
        ? changeReason(netWorth)
        : 'Percent change not available, starting net worth is 0'
  return [
    textRow('networth', 'start_month', 'Starting month', start.month ?? '', 'month', anchorNote(start)),
    numberRow('networth', 'start', 'Starting net worth', totalOf(start), 'usd', reason(start)),
    textRow('networth', 'end_month', 'Ending month', end.month ?? '', 'month', anchorNote(end)),
    numberRow('networth', 'end', 'Ending net worth', totalOf(end), 'usd', reason(end)),
    numberRow('networth', 'change', 'Net worth change', change, 'usd', change === null ? changeReason(netWorth) : ''),
    numberRow('networth', 'change_percent', 'Net worth change percent', changePct, 'percent', pctReason),
  ]
}

const cashflowRows = ({ cashflow }: AnnualReview): string[][] => {
  const { source, income, expenses, savings, savingsRate, monthsCovered, gapMonths } = cashflow
  const sourceNote =
    source === 'manual'
      ? 'Yearly log in Growth'
      : source === 'none'
        ? 'No income or expense data'
        : `${monthsCovered.length} of ${monthsCovered.length + gapMonths.length} months`
  const missing = source === 'none' ? 'No income or expense data' : 'Not recorded'
  const rateReason = income === 0 ? 'No income recorded' : savings === null ? missing : 'Not available'
  return [
    textRow('cashflow', 'source', 'Cashflow source', source, 'text', sourceNote),
    numberRow('cashflow', 'income', 'Income', income, 'usd', income === null ? missing : ''),
    numberRow('cashflow', 'expenses', 'Expenses', expenses, 'usd', expenses === null ? missing : ''),
    numberRow('cashflow', 'savings', 'Savings', savings, 'usd', savings === null ? missing : ''),
    numberRow(
      'cashflow',
      'savings_rate',
      'Savings rate',
      savingsRate,
      'percent',
      savingsRate === null ? rateReason : '',
    ),
  ]
}

const spendingRows = ({ spending }: AnnualReview): string[][] => {
  if (!spending) return []
  const rows = spending.top.map((g, i) => numberRow('spending', `group_${i + 1}`, g.name, g.amount, 'usd', '', g.share))
  if (spending.other) {
    const { count, amount, share } = spending.other
    rows.push(numberRow('spending', 'other', 'All other groups', amount, 'usd', pluralize(count, 'group'), share))
  }
  return rows
}

const goalRows = ({ goals }: AnnualReview): string[][] =>
  goals.flatMap(g => {
    const balanceNote = (balance: number | null) =>
      balance === null ? 'Not available' : `FI balance ${fixed(balance)} usd of ${fixed(g.target)} usd target`
    return [
      numberRow('goals', `goal_${g.goalId}_start`, g.name, g.startPct, 'percent', balanceNote(g.startBalance)),
      numberRow('goals', `goal_${g.goalId}_end`, g.name, g.endPct, 'percent', balanceNote(g.endBalance)),
      numberRow('goals', `goal_${g.goalId}_gw_balance`, `${g.name}: GW balance`, g.endGwBalance, 'usd'),
    ]
  })

const noteRows = (review: AnnualReview): string[][] =>
  review.notes.map((note, i) => textRow('notes', `note_${i + 1}`, 'Note', describeNote(note, review).text, 'text'))

/** The review as CSV text (layout in docs/specs/annual-review.md section 4.9). `generatedOn` is YYYY-MM-DD. */
export function buildReviewCsv(review: AnnualReview, generatedOn: string): string {
  const rows = [
    CSV_HEADER,
    textRow('report', 'year', 'Year', String(review.year), 'year'),
    textRow('report', 'status', 'Review status', review.status.replace('-', '_'), 'text'),
    textRow('report', 'generated', 'Generated on', generatedOn, 'date'),
    ...netWorthRows(review),
    ...cashflowRows(review),
    ...spendingRows(review),
    ...goalRows(review),
    ...noteRows(review),
  ]
  return `${serializeCSV(rows)}\n`
}

export const reviewCsvFilename = (year: number): string => `worth-annual-review-${year}.csv`

/** Saves the CSV through the browser, the same way the Wealth spreadsheet export does. */
export function downloadReviewCsv(csv: string, year: number): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = reviewCsvFilename(year)
  a.click()
  URL.revokeObjectURL(url)
}
