import type { AnnualReview, ReviewNote } from '../types'
import {
  formatList,
  formatMoney,
  formatMonthLong,
  formatMonthName,
  formatMonthShort,
  formatPercent,
  pluralize,
} from './format'

export interface NoteLink {
  label: string
  to: string
}
export interface NoteDescription {
  text: string
  link: NoteLink | null
}

const SPREADSHEET_LINK: NoteLink = { label: 'Open the spreadsheet', to: '/net-worth/dashboard/spreadsheet' }
const CASHFLOW_LINK: NoteLink = { label: 'Open Cashflow', to: '/budget' }
const GROWTH_LINK: NoteLink = { label: 'Open Growth', to: '/net-worth/growth/savings' }
const GROUPS_LINK: NoteLink = { label: 'Open Groups', to: '/budget/groups' }

const moneyDiffers = (a: number | null, b: number): a is number => a !== null && Math.round(a) !== Math.round(b)

function describeMismatch(review: AnnualReview): string {
  const m = review.cashflow.mismatch
  const kept = 'This review uses your transactions.'
  if (!m) return kept
  if (moneyDiffers(m.manualIncome, m.budgetIncome)) {
    return `Your Growth log shows ${formatMoney(m.manualIncome)} of income and your transactions add up to ${formatMoney(m.budgetIncome)}. ${kept}`
  }
  if (m.manualSavings !== null) {
    return `Your Growth log shows ${formatMoney(m.manualSavings)} of savings and your transactions add up to ${formatMoney(m.budgetSavings)}. ${kept}`
  }
  return kept
}

function describeNearest(note: Extract<ReviewNote, { code: 'anchor-nearest' }>, review: AnnualReview): string {
  const { start, end } = review.netWorth
  const covers = start.month && end.month ? `${formatMonthShort(start.month)} to ${formatMonthShort(end.month)}` : ''
  if (note.which === 'end') {
    return `There are no balances for December ${review.year}. The change runs to ${formatMonthShort(note.month)}.`
  }
  // A start in the review year means tracking began then; one in the prior year is only the latest month before it.
  return note.month.startsWith(`${review.year}-`)
    ? `Your balances start in ${formatMonthShort(note.month)}, so the change covers ${covers}.`
    : `There are no balances for December ${review.year - 1}. The change starts from ${formatMonthShort(note.month)}.`
}

/** The one sentence (and optional link) a note shows in the page. */
export function describeNote(note: ReviewNote, review: AnnualReview): NoteDescription {
  const plain = (text: string, link: NoteLink | null = null): NoteDescription => ({ text, link })
  switch (note.code) {
    case 'anchor-incomplete':
      return plain(
        `${formatMonthLong(note.month)} is missing a balance for ${formatList(note.accounts.map(a => a.name))}. Add it in the spreadsheet to see the change for this year.`,
        SPREADSHEET_LINK,
      )
    case 'anchor-nearest':
      return plain(describeNearest(note, review))
    case 'in-progress':
      return plain(
        `${review.year} is still in progress. This review covers January to ${formatMonthName(note.throughMonth)}.`,
      )
    case 'single-month':
      return plain('Only one month of balances is recorded, so there is no change to show.')
    case 'negative-start':
      return plain(
        'Net worth was negative at the start of the year, so the percent is relative to the size of that figure.',
      )
    case 'budget-partial':
      return plain(
        `Transactions are missing for ${formatList(note.gapMonths.map(formatMonthShort))}. Income and expenses cover ${note.covered} of ${note.expected} months.`,
        CASHFLOW_LINK,
      )
    case 'unreadable': {
      const files =
        note.months.length === 1
          ? '1 transaction file could not be read and is'
          : `${note.months.length} transaction files could not be read and are`
      return plain(`${files} left out: ${formatList(note.months.map(formatMonthShort))}.`)
    }
    case 'source-manual':
      return plain(
        'Income and savings come from the yearly log in Growth. Add transactions in Cashflow for a breakdown by group.',
        GROWTH_LINK,
      )
    case 'mismatch':
      return plain(describeMismatch(review), GROWTH_LINK)
    case 'income-zero':
      return plain(`Savings rate is not available because no income is recorded for ${review.year}.`)
    case 'refund-groups':
      return plain(`Refunds in groups with no net spending reduced expenses by ${formatMoney(note.amount)}.`)
    case 'uncategorized':
      return plain(
        `${formatPercent(note.share)} of spending is in Uncategorized. You can sort it in Cashflow, Groups.`,
        GROUPS_LINK,
      )
  }
}

/** "3 notes about this data follow." for screen readers. */
export const describeNoteCount = (count: number): string =>
  `${count === 1 ? '1 note about this data follows' : `${pluralize(count, 'note')} about this data follow`}.`
