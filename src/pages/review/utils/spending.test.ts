import { describe, it, expect } from 'vitest'
import { GROUPS, yearOfTransactions } from '../../../test/reviewFixtures'
import { makeCategoryGroup } from '../../../test/factories'
import { rankGroups } from './spending'

const MONTHS = ['2025-01']
const rank = (amounts: Record<string, number>, groups = GROUPS) =>
  rankGroups(MONTHS, yearOfTransactions(2025, amounts), groups)

const groupsOf = (...specs: [id: string, name: string, categories: string[]][]) => [
  ...specs.map(([id, name, categories]) => makeCategoryGroup({ id, name, categories })),
  { id: 'removed', name: 'Remove from Budget', categories: [] },
  { id: 'income-others', name: 'Others', categories: [], type: 'income' as const },
]

describe('rankGroups', () => {
  it('ranks groups by spend descending with shares of the positive total', () => {
    const { top, other } = rank({ Rent: -75, Groceries: -25 })
    expect(top).toEqual([
      { id: 'housing', name: 'Housing', amount: 75, share: 75 },
      { id: 'food', name: 'Food', amount: 25, share: 25 },
    ])
    expect(other).toBeNull()
  })

  it('lists five groups and aggregates the rest, with shares that sum to 100', () => {
    const { top, other } = rank({
      Rent: -70,
      Groceries: -60,
      Fuel: -50,
      Flights: -40,
      Doctor: -30,
      Clothes: -20,
      Movies: -10,
    })
    expect(top).toHaveLength(5)
    expect(other).toMatchObject({ count: 2, amount: 30 })
    expect(top.reduce((s, g) => s + g.share, other!.share)).toBeCloseTo(100, 10)
  })

  it('breaks ties by group name ascending', () => {
    const groups = groupsOf(['b', 'Banana', ['B']], ['a', 'Apple', ['A']], ['c', 'Cherry', ['C']])
    const { top } = rank({ B: -10, A: -10, C: -20 }, groups)
    expect(top.map(g => g.name)).toEqual(['Cherry', 'Apple', 'Banana'])
  })

  it('breaks ties between groups with the same name by id', () => {
    const groups = groupsOf(['z', 'Same', ['Z']], ['y', 'Same', ['Y']])
    expect(rank({ Z: -10, Y: -10 }, groups).top.map(g => g.id)).toEqual(['y', 'z'])
  })

  it('counts a category that is in two groups in the first group only', () => {
    const groups = groupsOf(['first', 'First', ['Shared']], ['second', 'Second', ['Shared']])
    const { top } = rank({ Shared: -100 }, groups)
    expect(top).toEqual([{ id: 'first', name: 'First', amount: 100, share: 100 }])
  })

  it('files categories in no group under a synthetic Uncategorized group', () => {
    const { top } = rank({ Mystery: -40, Rent: -60 })
    expect(top.map(g => [g.id, g.name, g.amount])).toEqual([
      ['housing', 'Housing', 60],
      ['uncategorized', 'Uncategorized', 40],
    ])
  })

  it('never lists income or removed categories', () => {
    const { top } = rank({ Paycheck: 5000, Transfer: -9999, Rent: -10 })
    expect(top.map(g => g.name)).toEqual(['Housing'])
  })

  it('reduces a group by its refunds and omits credit-only groups', () => {
    const { top, refundOnlyTotal } = rank({ Flights: -7500, Presents: 300, Rent: -100 })
    expect(top.map(g => [g.name, g.amount])).toEqual([
      ['Travel', 7500],
      ['Housing', 100],
    ])
    expect(refundOnlyTotal).toBe(300)
    expect(top[0].share).toBeCloseTo((7500 / 7600) * 100, 10)
  })

  it('does not count groups that net exactly zero as credits', () => {
    const tx = yearOfTransactions(2025, { Rent: -100 })
    tx['2025-01'].push(
      { date: '2025-01-20', category: 'Presents', amount: 5 },
      { date: '2025-01-21', category: 'Presents', amount: -5 },
    )
    const { top, refundOnlyTotal } = rankGroups(MONTHS, tx, GROUPS)
    expect(refundOnlyTotal).toBe(0)
    expect(top).toHaveLength(1)
  })

  it('returns an empty ranking when nothing was spent', () => {
    expect(rank({ Paycheck: 100 })).toEqual({ top: [], other: null, refundOnlyTotal: 0, uncategorizedShare: null })
  })

  it('only reads the given months', () => {
    const tx = {
      ...yearOfTransactions(2025, { Rent: -10 }),
      '2025-02': yearOfTransactions(2025, { Rent: -90 })['2025-01'],
    }
    expect(rankGroups(['2025-01'], tx, GROUPS).top[0].amount).toBe(10)
  })

  it('skips months that are not in the transaction map', () => {
    expect(rankGroups(['2025-09'], {}, GROUPS).top).toEqual([])
  })

  describe('uncategorized share', () => {
    const withOthers = groupsOf(['others', 'Others', ['Uncategorized']], ['housing', 'Housing', ['Rent']])

    it('is reported at exactly 20 percent', () => {
      expect(rank({ Rent: -80, Uncategorized: -20 }, withOthers).uncategorizedShare).toBeCloseTo(20, 10)
    })

    it('is null below 20 percent', () => {
      expect(rank({ Rent: -81, Uncategorized: -19 }, withOthers).uncategorizedShare).toBeNull()
    })

    it('measures the category by name even when it sits inside another group', () => {
      expect(rank({ Rent: -50, Uncategorized: -50 }, withOthers).uncategorizedShare).toBeCloseTo(50, 10)
    })

    it('counts an Uncategorized category that is in no group via the synthetic group', () => {
      expect(
        rank({ Rent: -50, Uncategorized: -50 }, groupsOf(['housing', 'Housing', ['Rent']])).uncategorizedShare,
      ).toBeCloseTo(50, 10)
    })

    it('ignores Uncategorized income', () => {
      const groups = [
        ...withOthers,
        { id: 'inc', name: 'Pay', categories: ['Uncategorized income'], type: 'income' as const },
      ]
      expect(rank({ Rent: -10, 'Uncategorized income': 1000 }, groups).uncategorizedShare).toBeNull()
    })

    it('is null when Uncategorized nets to a refund', () => {
      expect(rank({ Rent: -100, Uncategorized: 20 }, withOthers).uncategorizedShare).toBeNull()
    })
  })
})
