import type { CategoryGroup } from '../budget/types'
import { evaluatePeriod, isExpenseCategory, sumByCategory, summarizeGroups } from '../budget/utils/budgetTargets'
import type { BudgetTargetsFile, MonthKey, TargetResult } from '../budget/utils/budgetTargets'

export interface SpendingTargetsLine {
  text: string
  /** Drives the icon shape: up-triangle when any group is over, check otherwise. */
  anyOver: boolean
}

const monthNameFormat = new Intl.DateTimeFormat('en-US', { month: 'long' })

const monthName = (monthKey: MonthKey): string => {
  const [year, month] = monthKey.split('-').map(Number)
  return monthNameFormat.format(new Date(year, month - 1, 1))
}

// Same local-time convention as the rest of SpendingPeek.
export const currentMonthKey = (now: Date = new Date()): MonthKey =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

// Targets exist for expense groups only; income groups and "Remove from Budget" are never compared.
const isExpenseGroup = (group: CategoryGroup): boolean =>
  group.type !== 'income' && group.id !== 'income-others' && group.id !== 'removed'

type Transaction = { category: string; amount: number }

/** Signed net per category and month, like Budget's `categorySums`, with the removed categories left out. */
function buildCategorySums(
  transactionsByMonth: Readonly<Record<MonthKey, ReadonlyArray<Transaction>>>,
  excluded: ReadonlySet<string>,
): Record<string, Record<MonthKey, number>> {
  const sums: Record<string, Record<MonthKey, number>> = {}
  for (const [month, transactions] of Object.entries(transactionsByMonth)) {
    for (const [category, total] of Object.entries(sumByCategory(transactions, excluded))) {
      sums[category] = { ...sums[category], [month]: total }
    }
  }
  return sums
}

/**
 * One calm sentence about the anchor month. Matches the Budget table: refunds net against spend and a category
 * counts only if it has a negative month in the anchor month's year, so `transactionsByMonth` must hold every
 * month of that year. The Home chart still counts every non-income transaction as spend.
 * Returns null when no expense group has a target in effect for the month.
 */
export function buildSpendingTargetsLine(args: {
  groups: readonly CategoryGroup[]
  targets: BudgetTargetsFile
  anchorMonth: MonthKey
  transactionsByMonth: Readonly<Record<MonthKey, ReadonlyArray<Transaction>>>
  nowMonth: MonthKey
}): SpendingTargetsLine | null {
  const { groups, targets, anchorMonth, transactionsByMonth, nowMonth } = args

  const removed = new Set(groups.find(group => group.id === 'removed')?.categories ?? [])
  const sums = buildCategorySums(transactionsByMonth, removed)
  const monthsWithData = new Set([anchorMonth])

  const evaluated = groups.filter(isExpenseGroup).flatMap((group): Array<{ name: string; result: TargetResult }> => {
    const result = evaluatePeriod({
      record: targets.groups[group.id],
      monthKeys: [anchorMonth],
      monthsWithData,
      signedNetFor: month =>
        group.categories
          .filter(category => isExpenseCategory(sums[category]))
          .reduce((sum, category) => sum + (sums[category]?.[month] ?? 0), 0),
      nowMonth,
    })
    return result ? [{ name: group.name, result }] : []
  })

  const { evaluated: total, over } = summarizeGroups(evaluated.map(entry => entry.result))
  if (total === 0) return null

  const prefix = `${monthName(anchorMonth)}${anchorMonth === nowMonth ? ' so far' : ''}:`
  const verdict = (() => {
    if (total === 1) return `${evaluated[0].name} is ${over > 0 ? 'over' : 'within'} target`
    if (over > 0) return `over target in ${over} of ${total} groups`
    return total === 2 ? 'within target in both groups' : `within target in all ${total} groups`
  })()

  return { text: `${prefix} ${verdict}`, anyOver: over > 0 }
}
