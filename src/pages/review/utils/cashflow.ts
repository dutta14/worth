import { getIncomeGroups } from '../../budget/utils/budgetStorage'
import type { CategoryGroup, Transaction } from '../../budget/types'
import type { ManualYearLog } from '../../tools/utils/savingsOverrides'
import type { CashflowReview } from '../types'
import { roundCents } from './math'
import { monthsOfYear } from './netWorth'

export const REMOVED_GROUP_ID = 'removed'

export interface CategoryClasses {
  removed: Set<string>
  income: Set<string>
}

/** Same classification as the Budget page: removed first, then income-group membership, else expense. */
export function classifyCategories(categoryGroups: CategoryGroup[]): CategoryClasses {
  const removed = new Set(categoryGroups.find(g => g.id === REMOVED_GROUP_ID)?.categories ?? [])
  const income = new Set(getIncomeGroups(categoryGroups).flatMap(g => (g.id !== REMOVED_GROUP_ID ? g.categories : [])))
  return { removed, income }
}

/** Month keys of `year` that have a readable CSV and are not flagged unreadable. */
export function readableMonths(
  year: number,
  transactionsByMonth: Record<string, Transaction[]>,
  unreadableMonths: string[],
): string[] {
  const unreadable = new Set(unreadableMonths)
  return monthsOfYear(year).filter(m => transactionsByMonth[m] !== undefined && !unreadable.has(m))
}

export interface BudgetYear {
  monthsCovered: string[]
  gapMonths: string[]
  unreadableMonths: string[]
  /** Signed sum of income-group categories */
  income: number
  /** Negated signed sum of every other non-removed category, so refunds reduce it */
  expenses: number
}

export function summarizeBudgetYear(
  year: number,
  today: Date,
  transactionsByMonth: Record<string, Transaction[]>,
  unreadableMonths: string[],
  categoryGroups: CategoryGroup[],
): BudgetYear {
  const unreadable = unreadableMonths.filter(m => m.startsWith(`${year}-`)).sort()
  const covered = readableMonths(year, transactionsByMonth, unreadable)

  let expectedCount = 12
  if (year >= today.getFullYear()) {
    const latest = covered[covered.length - 1]
    expectedCount = year > today.getFullYear() || !latest ? 0 : parseInt(latest.slice(5), 10)
  }
  const coveredSet = new Set(covered)
  const gapMonths = monthsOfYear(year)
    .slice(0, expectedCount)
    .filter(m => !coveredSet.has(m))

  const { removed, income: incomeCats } = classifyCategories(categoryGroups)
  let income = 0
  let expenseSum = 0
  for (const month of covered) {
    for (const t of transactionsByMonth[month]) {
      if (removed.has(t.category)) continue
      if (incomeCats.has(t.category)) income += t.amount
      else expenseSum += t.amount
    }
  }

  return {
    monthsCovered: covered,
    gapMonths,
    unreadableMonths: unreadable,
    income: roundCents(income),
    expenses: roundCents(-expenseSum),
  }
}

const mismatchLimit = (budgetValue: number): number => Math.max(100, 0.01 * Math.abs(budgetValue))

const rateOf = (income: number | null, savings: number | null): number | null =>
  income !== null && savings !== null && income > 0 ? (savings / income) * 100 : null

/** Picks one source for the year's figures; sources are never mixed field by field. */
export function chooseCashflow(budget: BudgetYear, manual: ManualYearLog | undefined): CashflowReview {
  const base = {
    monthsCovered: budget.monthsCovered,
    gapMonths: budget.gapMonths,
    unreadableMonths: budget.unreadableMonths,
  }
  const hasCovered = budget.monthsCovered.length > 0
  const budgetSavings = roundCents(budget.income - budget.expenses)

  if (hasCovered && budget.gapMonths.length === 0) {
    const manualIncome = manual?.netIncome ?? null
    const manualSavings = manual?.savings ?? null
    const incomeDiffers = manualIncome !== null && Math.abs(budget.income - manualIncome) > mismatchLimit(budget.income)
    const savingsDiffers =
      manualSavings !== null && Math.abs(budgetSavings - manualSavings) > mismatchLimit(budgetSavings)
    return {
      ...base,
      source: 'budget',
      income: budget.income,
      expenses: budget.expenses,
      savings: budgetSavings,
      savingsRate: rateOf(budget.income, budgetSavings),
      mismatch:
        incomeDiffers || savingsDiffers
          ? { manualIncome, manualSavings, budgetIncome: budget.income, budgetSavings, incomeDiffers, savingsDiffers }
          : null,
    }
  }

  if (manual?.netIncome !== undefined) {
    const income = manual.netIncome
    const savings = manual.savings ?? null
    return {
      ...base,
      source: 'manual',
      income,
      expenses: savings !== null ? roundCents(income - savings) : null,
      savings,
      savingsRate: rateOf(income, savings),
      mismatch: null,
    }
  }

  if (hasCovered) {
    return {
      ...base,
      source: 'budget-partial',
      income: budget.income,
      expenses: budget.expenses,
      savings: budgetSavings,
      savingsRate: rateOf(budget.income, budgetSavings),
      mismatch: null,
    }
  }

  return { ...base, source: 'none', income: null, expenses: null, savings: null, savingsRate: null, mismatch: null }
}
