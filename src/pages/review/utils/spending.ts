import { getExpenseGroups } from '../../budget/utils/budgetStorage'
import type { CategoryGroup, Transaction } from '../../budget/types'
import type { GroupSpend, SpendingReview } from '../types'
import { classifyCategories, REMOVED_GROUP_ID } from './cashflow'
import { roundCents } from './math'

export const UNCATEGORIZED_CATEGORY = 'Uncategorized'
const UNCATEGORIZED_GROUP_ID = 'uncategorized'
const UNCATEGORIZED_THRESHOLD_PERCENT = 20
const TOP_GROUP_COUNT = 5

/**
 * Ranks expense groups by net spend over the given month keys. Refunds reduce the group they belong to,
 * a category in several groups counts in the first one, and unfiled categories fall into a synthetic group.
 */
export function rankGroups(
  months: string[],
  transactionsByMonth: Record<string, Transaction[]>,
  categoryGroups: CategoryGroup[],
): SpendingReview {
  const { removed, income } = classifyCategories(categoryGroups)

  const categorySums = new Map<string, number>()
  for (const month of months) {
    for (const t of transactionsByMonth[month] ?? []) {
      if (removed.has(t.category) || income.has(t.category)) continue
      categorySums.set(t.category, (categorySums.get(t.category) ?? 0) + t.amount)
    }
  }

  const groups = getExpenseGroups(categoryGroups).filter(g => g.id !== REMOVED_GROUP_ID)
  const groupOf = new Map<string, string>()
  for (const g of groups) {
    for (const category of g.categories) if (!groupOf.has(category)) groupOf.set(category, g.id)
  }

  const sums = new Map<string, number>()
  for (const [category, sum] of categorySums) {
    const id = groupOf.get(category) ?? UNCATEGORIZED_GROUP_ID
    sums.set(id, (sums.get(id) ?? 0) + sum)
  }

  const all: { id: string; name: string; amount: number }[] = [
    ...groups.map(g => ({ id: g.id, name: g.name, amount: -(sums.get(g.id) ?? 0) })),
    { id: UNCATEGORIZED_GROUP_ID, name: UNCATEGORIZED_CATEGORY, amount: -(sums.get(UNCATEGORIZED_GROUP_ID) ?? 0) },
  ].map(g => ({ ...g, amount: roundCents(g.amount) }))

  const positive = all
    .filter(g => g.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const positiveTotal = positive.reduce((s, g) => s + g.amount, 0)
  const shareOf = (amount: number) => (positiveTotal > 0 ? (amount / positiveTotal) * 100 : 0)

  const top: GroupSpend[] = positive
    .slice(0, TOP_GROUP_COUNT)
    .map(g => ({ id: g.id, name: g.name, amount: g.amount, share: shareOf(g.amount) }))
  const rest = positive.slice(TOP_GROUP_COUNT)
  const restAmount = roundCents(rest.reduce((s, g) => s + g.amount, 0))

  const refundOnlyTotal = roundCents(all.filter(g => g.amount < 0).reduce((s, g) => s - g.amount, 0))

  const uncategorizedSpend = -(categorySums.get(UNCATEGORIZED_CATEGORY) ?? 0)
  const uncategorizedPercent = uncategorizedSpend > 0 ? shareOf(uncategorizedSpend) : 0

  return {
    top,
    other: rest.length > 0 ? { count: rest.length, amount: restAmount, share: shareOf(restAmount) } : null,
    refundOnlyTotal,
    uncategorizedShare: uncategorizedPercent >= UNCATEGORIZED_THRESHOLD_PERCENT ? uncategorizedPercent : null,
  }
}
