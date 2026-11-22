import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import BudgetAggregatedView from '../budget/components/BudgetAggregatedView'
import type { CategoryGroup } from '../budget/types'
import { sumByCategory } from '../budget/utils/budgetTargets'
import type { BudgetTargetsFile } from '../budget/utils/budgetTargets'
import { buildSpendingTargetsLine } from './spendingTargetsLine'

type Tx = { category: string; amount: number }

const groups: CategoryGroup[] = [
  { id: 'dining', name: 'Dining', categories: ['Restaurants', 'Dining Rewards'] },
  { id: 'others', name: 'Others', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: [] },
]

const targets = (monthly: number): BudgetTargetsFile => ({
  version: 1,
  groups: { dining: { label: 'Dining', history: [{ from: null, monthly }] } },
})

/** What `useBudget` hands the Budget table: signed net per category and month. */
const toCategorySums = (byMonth: Record<string, Tx[]>) => {
  const sums: Record<string, Record<string, number>> = {}
  for (const [month, txs] of Object.entries(byMonth)) {
    for (const [category, total] of Object.entries(sumByCategory(txs, new Set()))) {
      sums[category] = { ...sums[category], [month]: total }
    }
  }
  return sums
}

const budgetVerdict = (byMonth: Record<string, Tx[]>, monthly: number): string => {
  render(
    <BudgetAggregatedView
      year={2026}
      type="expense"
      categoryGroups={groups}
      categorySums={toCategorySums(byMonth)}
      timePeriod="month"
      targetsConfig={{
        targets: targets(monthly),
        monthsWithData: new Set(Object.keys(byMonth)),
        nowMonthKey: '2026-11',
        readOnly: false,
        message: '',
        messageId: 0,
        onSetTarget: async () => ({ ok: true }),
      }}
    />,
  )
  const cells = within(screen.getByRole('row', { name: /^Dining/ })).getAllByRole('cell')
  return cells.at(-1)!.textContent ?? ''
}

const homeLine = (byMonth: Record<string, Tx[]>, monthly: number) =>
  buildSpendingTargetsLine({
    groups,
    targets: targets(monthly),
    anchorMonth: '2026-10',
    transactionsByMonth: byMonth,
    nowMonth: '2026-11',
  })?.text

describe('Home targets line and Budget Vs target agree', () => {
  const cases: Array<{ name: string; byMonth: Record<string, Tx[]>; monthly: number; budget: string; home: string }> = [
    {
      name: 'a rewards category that is positive all year is ignored by both',
      byMonth: {
        '2026-10': [
          { category: 'Restaurants', amount: -400 },
          { category: 'Dining Rewards', amount: 100 },
        ],
      },
      monthly: 350,
      budget: '$50 over',
      home: 'October: Dining is over target',
    },
    {
      name: 'a category that is negative in another month of the year is counted by both',
      byMonth: {
        '2026-03': [{ category: 'Dining Rewards', amount: -5 }],
        '2026-10': [
          { category: 'Restaurants', amount: -400 },
          { category: 'Dining Rewards', amount: 100 },
        ],
      },
      // Budget compares the whole year: $5 + $300 = $305 against two months at $350 each.
      monthly: 350,
      budget: '$395 under',
      home: 'October: Dining is within target',
    },
  ]

  for (const { name, byMonth, monthly, budget, home } of cases) {
    it(name, () => {
      expect(budgetVerdict(byMonth, monthly)).toContain(budget)
      expect(homeLine(byMonth, monthly)).toBe(home)
    })
  }
})
