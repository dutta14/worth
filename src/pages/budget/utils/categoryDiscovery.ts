import type { BudgetStore, CategoryGroup } from '../types'
import { getExpenseGroups, getIncomeGroups, updateGlobalCategoryGroups } from './budgetStorage'

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
