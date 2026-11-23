import type { PageType } from '../types'

export type NavGroupId = Extract<PageType, 'goal' | 'net-worth' | 'budget'>

export interface NavChild {
  id: string
  label: string
  path: string
  isActive: (pathname: string) => boolean
}

export interface NavGroup {
  id: NavGroupId
  label: string
  defaultPath: string
  children: ReadonlyArray<NavChild>
}

const stripTrailingSlash = (pathname: string): string => pathname.replace(/\/+$/, '')

const matchesPrefix = (pathname: string, prefix: string): boolean => {
  const path = stripTrailingSlash(pathname)
  return path === prefix || path.startsWith(`${prefix}/`)
}

const prefixMatcher =
  (prefix: string) =>
  (pathname: string): boolean =>
    matchesPrefix(pathname, prefix)

const WEALTH_PREFIXES = ['/net-worth/allocation', '/net-worth/growth', '/net-worth/review'] as const

const budgetViewMode = (pathname: string): 'groups' | 'spreadsheet' | 'cashflow' => {
  const path = stripTrailingSlash(pathname)
  if (path.endsWith('/groups')) return 'groups'
  if (path.endsWith('/spreadsheet')) return 'spreadsheet'
  return 'cashflow'
}

const isBudgetPath = (pathname: string): boolean => matchesPrefix(pathname, '/budget')

export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    id: 'goal',
    label: 'Planning',
    defaultPath: '/goal/plans',
    children: [
      {
        id: 'plans',
        label: 'Goals',
        path: '/goal/plans',
        // Goal detail routes sit under /goal/plans/:id, and bare /goal redirects to /goal/plans.
        isActive: pathname => stripTrailingSlash(pathname) === '/goal' || matchesPrefix(pathname, '/goal/plans'),
      },
      { id: 'leverage', label: 'Leverage', path: '/goal/leverage', isActive: prefixMatcher('/goal/leverage') },
      { id: 'paydown', label: 'Pay Down', path: '/goal/paydown', isActive: prefixMatcher('/goal/paydown') },
      {
        id: 'calculator',
        label: 'FIRE Calculator',
        path: '/goal/calculator',
        isActive: prefixMatcher('/goal/calculator'),
      },
      { id: 'taxes', label: 'Taxes', path: '/taxes', isActive: prefixMatcher('/taxes') },
    ],
  },
  {
    id: 'net-worth',
    label: 'Wealth',
    defaultPath: '/net-worth/dashboard',
    children: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/net-worth/dashboard',
        // Dashboard is the fallback for every /net-worth path the other tabs do not claim, as in Data.tsx.
        isActive: pathname => !WEALTH_PREFIXES.some(prefix => matchesPrefix(pathname, prefix)),
      },
      {
        id: 'allocation',
        label: 'Allocation',
        path: '/net-worth/allocation',
        isActive: prefixMatcher(WEALTH_PREFIXES[0]),
      },
      { id: 'growth', label: 'Growth', path: '/net-worth/growth', isActive: prefixMatcher(WEALTH_PREFIXES[1]) },
      { id: 'review', label: 'Review', path: '/net-worth/review', isActive: prefixMatcher(WEALTH_PREFIXES[2]) },
    ],
  },
  {
    id: 'budget',
    label: 'Cashflow',
    defaultPath: '/budget/cashflow',
    children: [
      {
        id: 'cashflow',
        label: 'Overview',
        path: '/budget/cashflow',
        isActive: pathname => isBudgetPath(pathname) && budgetViewMode(pathname) === 'cashflow',
      },
      {
        id: 'spreadsheet',
        label: 'Spreadsheet',
        path: '/budget/spreadsheet',
        isActive: pathname => isBudgetPath(pathname) && budgetViewMode(pathname) === 'spreadsheet',
      },
      {
        id: 'groups',
        label: 'Groups',
        path: '/budget/groups',
        isActive: pathname => isBudgetPath(pathname) && budgetViewMode(pathname) === 'groups',
      },
      { id: 'transactions', label: 'Transactions', path: '/transactions', isActive: prefixMatcher('/transactions') },
    ],
  },
]

export const getNavGroup = (id: PageType): NavGroup | undefined => NAV_GROUPS.find(group => group.id === id)

export const isNavGroupId = (value: string): value is NavGroupId => NAV_GROUPS.some(group => group.id === value)

/** The page heading: the active sub-item's label, so it matches the sidebar entry the user chose. */
export const getNavTitle = (groupId: NavGroupId, pathname: string): string => {
  const group = NAV_GROUPS.find(g => g.id === groupId)
  if (!group) return ''
  return group.children.find(child => child.isActive(pathname))?.label ?? group.label
}

export const getActiveChildId = (group: NavGroup, pathname: string): string | undefined =>
  group.children.find(child => child.isActive(pathname))?.id
