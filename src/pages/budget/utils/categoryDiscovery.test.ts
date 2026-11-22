import { describe, it, expect } from 'vitest'
import { emptyStore } from '../../../test/importHelpers'
import { addDiscoveredCategories, discoverCategories } from './categoryDiscovery'

const groups = emptyStore().categoryGroups ?? []

describe('discoverCategories', () => {
  it('sorts new categories by sign, with mixed-sign categories treated as expenses', () => {
    const found = discoverCategories(groups, [
      { category: 'Salary', amount: 100 },
      { category: 'Dining', amount: -5 },
      { category: 'Refunds', amount: 10 },
      { category: 'Refunds', amount: -2 },
    ])
    expect(found).toEqual({ expense: ['Dining', 'Refunds'], income: ['Salary'] })
  })

  it('ignores categories a group already holds', () => {
    const known = [{ id: 'others', name: 'Others', categories: ['Dining'] }]
    expect(discoverCategories(known, [{ category: 'Dining', amount: -5 }])).toEqual({ expense: [], income: [] })
  })

  it('treats a zero amount as an expense only when it is marked as spending', () => {
    expect(discoverCategories(groups, [{ category: 'Free', amount: 0 }])).toEqual({ expense: [], income: [] })
    expect(discoverCategories(groups, [{ category: 'Free', amount: 0, spending: true }]).expense).toEqual(['Free'])
  })
})

describe('addDiscoveredCategories', () => {
  it('adds expense and income categories to their Others groups', () => {
    const { store, newCategories } = addDiscoveredCategories(emptyStore(), [
      { category: 'Dining', amount: -5 },
      { category: 'Salary', amount: 5 },
    ])
    expect(newCategories).toEqual(['Dining', 'Salary'])
    expect(store.categoryGroups?.find(g => g.id === 'others')?.categories).toEqual(['Dining'])
    expect(store.categoryGroups?.find(g => g.id === 'income-others')?.categories).toEqual(['Salary'])
  })

  it('returns the same store when nothing is new', () => {
    const base = emptyStore()
    const { store, newCategories } = addDiscoveredCategories(base, [])
    expect(store).toBe(base)
    expect(newCategories).toEqual([])
  })
})
