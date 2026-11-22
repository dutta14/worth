import type { AnnualReview, ReviewInputs, ReviewNote } from '../types'
import { chooseCashflow, summarizeBudgetYear } from './cashflow'
import { snapshotGoals } from './goals'
import { buildMonthTotals, buildNetWorthReview, emptyNetWorthReview } from './netWorth'
import { rankGroups } from './spending'

const emptyReview = (year: number): AnnualReview => ({
  year,
  status: 'empty',
  netWorth: emptyNetWorthReview(year),
  cashflow: chooseCashflow(
    { monthsCovered: [], gapMonths: [], unreadableMonths: [], income: 0, expenses: 0 },
    undefined,
  ),
  spending: null,
  goals: [],
  skippedGoals: 0,
  notes: [],
  prior: null,
})

function buildNotes(r: Omit<AnnualReview, 'notes' | 'prior'>, today: Date): ReviewNote[] {
  const { netWorth, cashflow, spending, status, year } = r
  const { start, end } = netWorth
  const notes: ReviewNote[] = []
  const singleMonth = start.month !== null && start.month === end.month
  const inProgress = status === 'in-progress'

  for (const [which, anchor] of [
    ['start', start],
    ['end', end],
  ] as const) {
    if (anchor.status === 'incomplete') {
      notes.push({ code: 'anchor-incomplete', which, month: anchor.month!, accounts: anchor.missing })
    }
  }
  // The in-progress note already says the end month; a lone month is covered by single-month.
  for (const [which, anchor] of [
    ['start', start],
    ['end', end],
  ] as const) {
    if (anchor.status !== 'nearest' || singleMonth || (which === 'end' && inProgress)) continue
    notes.push({ code: 'anchor-nearest', which, month: anchor.month! })
  }
  if (inProgress) {
    const fallback = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`
    notes.push({
      code: 'in-progress',
      throughMonth: end.month ?? cashflow.monthsCovered[cashflow.monthsCovered.length - 1] ?? fallback,
    })
  }
  if (singleMonth && (start.status === 'exact' || start.status === 'nearest')) notes.push({ code: 'single-month' })
  if (netWorth.startNegative && netWorth.change !== null) notes.push({ code: 'negative-start' })
  if (cashflow.source === 'budget-partial') {
    notes.push({
      code: 'budget-partial',
      gapMonths: cashflow.gapMonths,
      covered: cashflow.monthsCovered.length,
      expected: cashflow.monthsCovered.length + cashflow.gapMonths.length,
    })
  }
  if (cashflow.unreadableMonths.length > 0) notes.push({ code: 'unreadable', months: cashflow.unreadableMonths })
  if (cashflow.source === 'manual') notes.push({ code: 'source-manual' })
  if (cashflow.mismatch) notes.push({ code: 'mismatch' })
  if (cashflow.income !== null && cashflow.income <= 0) notes.push({ code: 'income-zero' })
  if (spending && spending.refundOnlyTotal > 0) notes.push({ code: 'refund-groups', amount: spending.refundOnlyTotal })
  if (spending && spending.uncategorizedShare !== null) {
    notes.push({ code: 'uncategorized', share: spending.uncategorizedShare })
  }
  return notes
}

function build(i: ReviewInputs, withPrior: boolean): AnnualReview {
  const { year, today } = i
  if (year > today.getFullYear()) return emptyReview(year)

  const netWorth = buildNetWorthReview(year, buildMonthTotals(i.accounts, i.balances))
  const budget = summarizeBudgetYear(year, today, i.transactionsByMonth, i.unreadableMonths, i.categoryGroups)
  const cashflow = chooseCashflow(budget, i.manual[year])

  if (netWorth.start.status === 'missing' && netWorth.end.status === 'missing' && cashflow.source === 'none') {
    return { ...emptyReview(year), netWorth, cashflow }
  }

  const spending =
    cashflow.monthsCovered.length > 0 && cashflow.source !== 'manual'
      ? rankGroups(cashflow.monthsCovered, i.transactionsByMonth, i.categoryGroups)
      : null
  const { goals, skipped: skippedGoals } = snapshotGoals(
    year,
    i.goals,
    i.profileBirthday,
    i.growth,
    i.accounts,
    i.balances,
    netWorth.start,
    netWorth.end,
  )
  const core = {
    year,
    status: year === today.getFullYear() ? ('in-progress' as const) : ('complete' as const),
    netWorth,
    cashflow,
    spending,
    goals,
    skippedGoals,
  }

  let prior: AnnualReview['prior'] = null
  if (withPrior) {
    const p = build({ ...i, year: year - 1 }, false)
    if (p.status !== 'empty') {
      prior = {
        netWorthChange: p.netWorth.change,
        income: p.cashflow.income,
        expenses: p.cashflow.expenses,
        savingsRate: p.cashflow.savingsRate,
      }
    }
  }

  return { ...core, notes: buildNotes(core, today), prior }
}

/** Pure composition of every review section for one year. `today` is injected; only its year and month are read. */
export function selectAnnualReview(i: ReviewInputs): AnnualReview {
  return build(i, true)
}
