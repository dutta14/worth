import { describe, it, expect } from 'vitest'
import type { CategoryGroup } from '../budget/types'
import type { BudgetTargetsFile } from '../budget/utils/budgetTargets'
import { buildSpendingTargetsLine, currentMonthKey } from './spendingTargetsLine'

const groups: CategoryGroup[] = [
  { id: 'dining', name: 'Dining', categories: ['Restaurants', 'Coffee'] },
  { id: 'housing', name: 'Housing', categories: ['Rent'] },
  { id: 'travel', name: 'Travel', categories: ['Flights'] },
  { id: 'others', name: 'Others', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: ['Transfers'] },
  { id: 'income-others', name: 'Income', categories: ['Salary'], type: 'income' },
]

const targetsFor = (monthly: Record<string, number>): BudgetTargetsFile => ({
  version: 1,
  groups: Object.fromEntries(
    Object.entries(monthly).map(([id, value]) => [id, { history: [{ from: null, monthly: value }] }]),
  ),
})

const build = (
  monthly: Record<string, number>,
  transactions: Array<{ category: string; amount: number }>,
  overrides: Partial<{
    anchorMonth: string
    nowMonth: string
    groups: CategoryGroup[]
    otherMonths: Record<string, Array<{ category: string; amount: number }>>
  }> = {},
) => {
  const { otherMonths = {}, anchorMonth = '2026-10', ...rest } = overrides
  return buildSpendingTargetsLine({
    groups,
    targets: targetsFor(monthly),
    anchorMonth,
    transactionsByMonth: { ...otherMonths, [anchorMonth]: transactions },
    nowMonth: '2026-11',
    ...rest,
  })
}

describe('currentMonthKey', () => {
  it('uses the local calendar month, zero padded', () => {
    expect(currentMonthKey(new Date(2026, 2, 31))).toBe('2026-03')
    expect(currentMonthKey(new Date(2026, 10, 1))).toBe('2026-11')
  })
})

describe('buildSpendingTargetsLine', () => {
  it('names the group when exactly one group has a target and it is over', () => {
    expect(build({ dining: 500 }, [{ category: 'Restaurants', amount: -620 }])).toEqual({
      text: 'October: Dining is over target',
      anyOver: true,
    })
  })

  it('names the group when exactly one group has a target and it is within', () => {
    expect(build({ dining: 500 }, [{ category: 'Restaurants', amount: -400 }])).toEqual({
      text: 'October: Dining is within target',
      anyOver: false,
    })
  })

  it('treats exactly on target and rounding to on target as within', () => {
    expect(build({ dining: 500 }, [{ category: 'Restaurants', amount: -500.4 }])?.text).toBe(
      'October: Dining is within target',
    )
    expect(build({ dining: 500 }, [{ category: 'Restaurants', amount: -500.6 }])?.text).toBe(
      'October: Dining is over target',
    )
  })

  it('says "both groups" when two groups are within target', () => {
    expect(build({ dining: 500, housing: 2000 }, [{ category: 'Rent', amount: -1900 }])).toEqual({
      text: 'October: within target in both groups',
      anyOver: false,
    })
  })

  it('counts over groups out of the evaluated ones for two groups', () => {
    expect(build({ dining: 500, housing: 2000 }, [{ category: 'Rent', amount: -2100 }])?.text).toBe(
      'October: over target in 1 of 2 groups',
    )
  })

  it('says "all N groups" when three or more groups are within target', () => {
    expect(build({ dining: 500, housing: 2000, travel: 300 }, [])?.text).toBe('October: within target in all 3 groups')
  })

  it('counts every over group', () => {
    const line = build({ dining: 500, housing: 2000, travel: 300 }, [
      { category: 'Restaurants', amount: -600 },
      { category: 'Flights', amount: -900 },
      { category: 'Rent', amount: -1000 },
    ])
    expect(line).toEqual({ text: 'October: over target in 2 of 3 groups', anyOver: true })
  })

  it('adds "so far" when the anchor month is the current calendar month', () => {
    expect(build({ dining: 500 }, [], { anchorMonth: '2026-11' })?.text).toBe(
      'November so far: Dining is within target',
    )
  })

  it('nets refunds against spend, unlike the Home chart', () => {
    const transactions = [
      { category: 'Restaurants', amount: -620 },
      { category: 'Restaurants', amount: 200 },
    ]
    expect(build({ dining: 500 }, transactions)?.text).toBe('October: Dining is within target')
  })

  it('sums every category of a group', () => {
    const transactions = [
      { category: 'Restaurants', amount: -300 },
      { category: 'Coffee', amount: -250 },
    ]
    expect(build({ dining: 500 }, transactions)?.text).toBe('October: Dining is over target')
  })

  it('ignores a category that is positive all year, as the Budget table does', () => {
    // Restaurants -400 plus a +100 reward in the same group: only the expense category counts, so $400 vs $350.
    const transactions = [
      { category: 'Restaurants', amount: -400 },
      { category: 'Dining Rewards', amount: 100 },
    ]
    const withRewards = [{ ...groups[0], categories: ['Restaurants', 'Dining Rewards'] }, ...groups.slice(1)]
    expect(build({ dining: 350 }, transactions, { groups: withRewards })?.text).toBe('October: Dining is over target')
  })

  it('still counts a refund category that has a negative month elsewhere in the year', () => {
    const withRewards = [{ ...groups[0], categories: ['Restaurants', 'Dining Rewards'] }, ...groups.slice(1)]
    const line = build(
      { dining: 350 },
      [
        { category: 'Restaurants', amount: -400 },
        { category: 'Dining Rewards', amount: 100 },
      ],
      { groups: withRewards, otherMonths: { '2026-03': [{ category: 'Dining Rewards', amount: -5 }] } },
    )
    expect(line?.text).toBe('October: Dining is within target')
  })

  it('compares a zero target against any spend', () => {
    expect(build({ travel: 0 }, [{ category: 'Flights', amount: -25 }])?.text).toBe('October: Travel is over target')
  })

  it('ignores transactions in the removed group', () => {
    const transactions = [
      { category: 'Transfers', amount: -9000 },
      { category: 'Restaurants', amount: -100 },
    ]
    expect(build({ dining: 500, removed: 1 }, transactions)?.text).toBe('October: Dining is within target')
  })

  it('never compares income groups, even if a stale target exists for one', () => {
    expect(build({ 'income-others': 100 }, [{ category: 'Salary', amount: 5000 }])).toBeNull()
  })

  it('leaves groups without a target out of the count', () => {
    expect(build({ dining: 500 }, [{ category: 'Rent', amount: -9000 }])?.text).toBe('October: Dining is within target')
  })

  it('ignores targets for groups that no longer exist', () => {
    expect(build({ 'deleted-group': 500 }, [])).toBeNull()
  })

  it('returns null when no group has a target', () => {
    expect(build({}, [{ category: 'Restaurants', amount: -620 }])).toBeNull()
  })

  it('returns null when a cleared target is in effect for the anchor month', () => {
    const targets: BudgetTargetsFile = {
      version: 1,
      groups: {
        dining: {
          history: [
            { from: null, monthly: 500 },
            { from: '2026-09', monthly: null },
          ],
        },
      },
    }
    expect(
      buildSpendingTargetsLine({
        groups,
        targets,
        anchorMonth: '2026-10',
        transactionsByMonth: { '2026-10': [] },
        nowMonth: '2026-11',
      }),
    ).toBeNull()
  })

  it('uses the target that applied in the anchor month, not the current one', () => {
    const targets: BudgetTargetsFile = {
      version: 1,
      groups: {
        dining: {
          history: [
            { from: null, monthly: 500 },
            { from: '2026-11', monthly: 900 },
          ],
        },
      },
    }
    const line = buildSpendingTargetsLine({
      groups,
      targets,
      anchorMonth: '2026-10',
      transactionsByMonth: { '2026-10': [{ category: 'Restaurants', amount: -700 }] },
      nowMonth: '2026-11',
    })
    expect(line?.text).toBe('October: Dining is over target')
  })

  it('handles a store without any groups', () => {
    expect(build({ dining: 500 }, [], { groups: [] })).toBeNull()
  })
})
