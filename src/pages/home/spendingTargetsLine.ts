import type { CategoryGroup } from '../budget/types'
import { evaluatePeriod, sumByCategory, summarizeGroups } from '../budget/utils/budgetTargets'
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

/**
 * One calm sentence about the anchor month. Follows the Budget page's semantics (refunds net against spend),
 * not the Home chart's, which counts every non-income transaction as spend.
 * Returns null when no expense group has a target in effect for the month.
 */
export function buildSpendingTargetsLine(args: {
  groups: readonly CategoryGroup[]
  targets: BudgetTargetsFile
  anchorMonth: MonthKey
  transactions: ReadonlyArray<{ category: string; amount: number }>
  nowMonth: MonthKey
}): SpendingTargetsLine | null {
  const { groups, targets, anchorMonth, transactions, nowMonth } = args

  const removed = new Set(groups.find(group => group.id === 'removed')?.categories ?? [])
  const sums = sumByCategory(transactions, removed)
  const monthsWithData = new Set([anchorMonth])

  const evaluated = groups.filter(isExpenseGroup).flatMap((group): Array<{ name: string; result: TargetResult }> => {
    const result = evaluatePeriod({
      record: targets.groups[group.id],
      monthKeys: [anchorMonth],
      monthsWithData,
      signedNetFor: () => group.categories.reduce((sum, category) => sum + (sums[category] ?? 0), 0),
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
