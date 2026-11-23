import { describe, it, expect } from 'vitest'
import { NAV_GROUPS, getActiveChildId, getNavGroup, getNavTitle, isNavGroupId } from './sidebarNavConfig'

const activeChild = (groupId: 'goal' | 'net-worth' | 'budget', pathname: string) => {
  const group = getNavGroup(groupId)
  if (!group) throw new Error(`missing group ${groupId}`)
  return getActiveChildId(group, pathname)
}

describe('sidebarNavConfig', () => {
  it('defines Planning, Wealth and Cashflow in sidebar order with their default children first', () => {
    expect(NAV_GROUPS.map(g => [g.id, g.label, g.defaultPath])).toEqual([
      ['goal', 'Planning', '/goal/plans'],
      ['net-worth', 'Wealth', '/net-worth/dashboard'],
      ['budget', 'Cashflow', '/budget/cashflow'],
    ])
    for (const group of NAV_GROUPS) expect(group.children[0].path).toBe(group.defaultPath)
  })

  it('gives every child a unique id within its group', () => {
    for (const group of NAV_GROUPS) {
      const ids = group.children.map(c => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('has every child link active on its own path', () => {
    for (const group of NAV_GROUPS) {
      for (const child of group.children) expect(activeChild(group.id, child.path)).toBe(child.id)
    }
  })

  it('recognises group ids and rejects other page types', () => {
    expect(isNavGroupId('goal')).toBe(true)
    expect(isNavGroupId('net-worth')).toBe(true)
    expect(isNavGroupId('budget')).toBe(true)
    expect(isNavGroupId('home')).toBe(false)
    expect(isNavGroupId('drive')).toBe(false)
    expect(getNavGroup('home')).toBeUndefined()
  })

  describe('Planning', () => {
    it.each([
      ['/goal', 'plans'],
      ['/goal/', 'plans'],
      ['/goal/plans', 'plans'],
      ['/goal/plans/12', 'plans'],
      ['/goal/leverage', 'leverage'],
      ['/goal/paydown', 'paydown'],
      ['/goal/calculator', 'calculator'],
      ['/taxes', 'taxes'],
      ['/taxes/', 'taxes'],
    ])('matches %s to %s', (pathname, expected) => {
      expect(activeChild('goal', pathname)).toBe(expected)
    })

    it('matches nothing for unrelated or look-alike paths', () => {
      expect(activeChild('goal', '/goal/unknown')).toBeUndefined()
      expect(activeChild('goal', '/goal/plansx')).toBeUndefined()
      expect(activeChild('goal', '/taxesx')).toBeUndefined()
    })
  })

  describe('Wealth', () => {
    it.each([
      ['/net-worth', 'dashboard'],
      ['/net-worth/dashboard', 'dashboard'],
      ['/net-worth/dashboard/details', 'dashboard'],
      ['/net-worth/dashboard/manage', 'dashboard'],
      ['/net-worth/unknown', 'dashboard'],
      ['/net-worth/allocation', 'allocation'],
      ['/net-worth/allocation/ratios', 'allocation'],
      ['/net-worth/growth', 'growth'],
      ['/net-worth/growth/income', 'growth'],
      ['/net-worth/review', 'review'],
      ['/net-worth/review/2025', 'review'],
      ['/net-worth/review/', 'review'],
    ])('matches %s to %s', (pathname, expected) => {
      expect(activeChild('net-worth', pathname)).toBe(expected)
    })
  })

  describe('Cashflow', () => {
    it.each([
      ['/budget', 'cashflow'],
      ['/budget/', 'cashflow'],
      ['/budget/cashflow', 'cashflow'],
      ['/budget/unknown', 'cashflow'],
      ['/budget/spreadsheet', 'spreadsheet'],
      ['/budget/spreadsheet/', 'spreadsheet'],
      ['/budget/groups', 'groups'],
      ['/transactions', 'transactions'],
      ['/transactions/', 'transactions'],
    ])('matches %s to %s', (pathname, expected) => {
      expect(activeChild('budget', pathname)).toBe(expected)
    })

    it('does not claim paths outside Cashflow', () => {
      expect(activeChild('budget', '/goal/plans')).toBeUndefined()
      expect(activeChild('budget', '/budgetx')).toBeUndefined()
    })
  })

  describe('getNavTitle', () => {
    it.each([
      ['goal', '/goal', 'Goals'],
      ['goal', '/goal/leverage', 'Leverage'],
      ['goal', '/goal/paydown', 'Pay Down'],
      ['goal', '/goal/calculator', 'FIRE Calculator'],
      ['goal', '/taxes', 'Taxes'],
      ['net-worth', '/net-worth', 'Dashboard'],
      ['net-worth', '/net-worth/allocation', 'Allocation'],
      ['net-worth', '/net-worth/growth/income', 'Growth'],
      ['net-worth', '/net-worth/review/2025', 'Review'],
      ['budget', '/budget/cashflow', 'Overview'],
      ['budget', '/budget/spreadsheet', 'Spreadsheet'],
      ['budget', '/budget/groups', 'Groups'],
      ['budget', '/transactions', 'Transactions'],
    ] as const)('titles %s %s as "%s"', (groupId, pathname, expected) => {
      expect(getNavTitle(groupId, pathname)).toBe(expected)
    })

    it('falls back to the group label when no sub-item matches', () => {
      expect(getNavTitle('budget', '/goal/plans')).toBe('Cashflow')
      expect(getNavTitle('goal', '/net-worth/dashboard')).toBe('Planning')
    })
  })
})
