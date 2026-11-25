import type { BudgetStore, CategoryGroup } from '../types'
import { getExpenseGroups, getIncomeGroups, updateGlobalCategoryGroups } from './budgetStorage'
import { parseCSVLine } from './csvParser'

export const OTHERS_GROUP_ID = 'others'
export const REMOVED_GROUP_ID = 'removed'
export const INCOME_OTHERS_GROUP_ID = 'income-others'

export const addCategoriesToGroup = (
  groups: CategoryGroup[],
  groupId: string,
  categories: string[],
): CategoryGroup[] => {
  if (categories.length === 0) return groups

  const dedupedCategories = [...new Set(categories)]
  const targetGroup = groups.find(g => g.id === groupId)
  if (targetGroup) {
    return groups.map(g => (g.id === groupId ? { ...g, categories: [...g.categories, ...dedupedCategories] } : g))
  }

  return [
    ...groups,
    {
      id: groupId,
      name: 'Others',
      categories: dedupedCategories,
      ...(groupId === INCOME_OTHERS_GROUP_ID ? { type: 'income' } : {}),
    },
  ]
}

export const mergeGroupsByType = (
  storeGroups: CategoryGroup[],
  nextGroups: CategoryGroup[],
  type: 'expense' | 'income',
): CategoryGroup[] => {
  const otherGroups = storeGroups.filter(group =>
    type === 'income' ? group.type !== 'income' : group.type === 'income',
  )
  return type === 'income'
    ? [...getExpenseGroups(otherGroups), ...nextGroups]
    : [...nextGroups, ...getIncomeGroups(otherGroups)]
}

export interface DiscoveryItem {
  category: string
  amount: number
  /** Counts the row as spending even when `amount` is zero (zero-amount rows use the expense fallback). */
  spending?: boolean
}

export interface DiscoveredCategories {
  expense: string[]
  income: string[]
}

/**
 * Sorts categories that no group contains yet by sign: a negative amount makes a category an expense, a
 * positive one makes it income unless it was already seen as an expense, so a mixed-sign category is an expense.
 */
export function discoverCategories(groups: CategoryGroup[], items: DiscoveryItem[]): DiscoveredCategories {
  const grouped = new Set(groups.flatMap(group => group.categories))
  const types = new Map<string, 'expense' | 'income'>()

  items.forEach(item => {
    if (grouped.has(item.category)) return
    if (item.amount < 0 || item.spending) {
      types.set(item.category, 'expense')
      return
    }
    if (item.amount > 0 && !types.has(item.category)) types.set(item.category, 'income')
  })

  const names = (type: 'expense' | 'income') =>
    [...types.entries()].filter(([, kind]) => kind === type).map(([category]) => category)
  return { expense: names('expense'), income: names('income') }
}

/** Adds newly discovered categories to the "Others" group of the matching type. */
export function addDiscoveredCategories(
  store: BudgetStore,
  items: DiscoveryItem[],
): { store: BudgetStore; newCategories: string[] } {
  const { expense, income } = discoverCategories(store.categoryGroups || [], items)
  let next = store

  if (expense.length > 0) {
    const expenseGroups = addCategoriesToGroup(getExpenseGroups(next.categoryGroups || []), OTHERS_GROUP_ID, expense)
    next = updateGlobalCategoryGroups(next, mergeGroupsByType(next.categoryGroups || [], expenseGroups, 'expense'))
  }
  if (income.length > 0) {
    const incomeGroups = addCategoriesToGroup(
      getIncomeGroups(store.categoryGroups || []),
      INCOME_OTHERS_GROUP_ID,
      income,
    ).map(group => ({ ...group, type: 'income' as const }))
    next = updateGlobalCategoryGroups(next, mergeGroupsByType(next.categoryGroups || [], incomeGroups, 'income'))
  }

  return { store: next, newCategories: [...expense, ...income] }
}

/** Transaction count per category across every year's CSV; categories without transactions are absent. */
export function countTransactionsByCategory(csvs: BudgetStore['csvs']): Map<string, number> {
  const counts = new Map<string, number>()
  for (const csvData of Object.values(csvs)) {
    const lines = csvData.csv.split(/\r?\n/)
    if (lines.length < 2) continue
    const catIdx = parseCSVLine(lines[0])
      .map(h => h.trim().toLowerCase())
      .findIndex(h => h === 'category')
    if (catIdx === -1) continue
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      const category = parseCSVLine(lines[i])[catIdx]?.trim()
      if (category) counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  return counts
}
