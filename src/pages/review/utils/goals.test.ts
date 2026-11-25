import { describe, it, expect, vi } from 'vitest'
import { makeGoal, makeGwGoal } from '../../../test/factories'
import { balancesFor, GROWTH, makeAccounts } from '../../../test/reviewFixtures'
import { getFiTarget } from '../../goal/utils/goalCalculations'
import { getGwTarget } from '../../goal/utils/goalMath'
import type { NetWorthAnchor } from '../types'
import { snapshotGoals } from './goals'

const anchor = (month: string | null, status: NetWorthAnchor['status'] = 'exact'): NetWorthAnchor => ({
  month,
  total: month ? 0 : null,
  status,
  missing: [],
})

const goal = makeGoal({ id: 7, goalName: 'FI', goalCreatedIn: '2024-01' })
const target = getFiTarget(
  goal,
  '1990-01',
  GROWTH.preBoundaryGrowth,
  GROWTH.postBoundaryGrowth,
  GROWTH.ageBoundary,
  GROWTH.inflation,
)

const snapAll = (overrides: Partial<Parameters<typeof snapshotGoals>[1][number]> = {}, year = 2025) =>
  snapshotGoals(
    year,
    [{ ...goal, ...overrides }],
    '1990-01',
    GROWTH,
    makeAccounts({ goalType: 'fi' }, { goalType: 'fi', status: 'inactive' }, { goalType: 'gw' }),
    [
      ...balancesFor(1, { '2024-12': target * 0.1, '2025-12': target * 0.25 }),
      ...balancesFor(2, { '2024-12': target * 0.05, '2025-12': target * 0.05 }),
      ...balancesFor(3, { '2024-12': target * 5, '2025-12': target * 5 }),
    ],
    anchor('2024-12'),
    anchor('2025-12'),
  )
const snap = (...args: Parameters<typeof snapAll>) => snapAll(...args).goals

describe('snapshotGoals', () => {
  it('computes the target from the real FI calculation', () => {
    expect(target).toBeGreaterThan(0)
    expect(snap()[0].target).toBe(target)
  })

  it('measures progress with FI accounts only, active or not', () => {
    const [s] = snap()
    expect(s).toMatchObject({ goalId: 7, name: 'FI' })
    expect(s.startBalance).toBeCloseTo(target * 0.15, 1)
    expect(s.endBalance).toBeCloseTo(target * 0.3, 1)
    expect(s.startPct).toBeCloseTo(15, 5)
    expect(s.endPct).toBeCloseTo(30, 5)
  })

  it('clamps progress to 0 through 100', () => {
    const accounts = makeAccounts({ goalType: 'fi' })
    const [s] = snapshotGoals(
      2025,
      [goal],
      '1990-01',
      GROWTH,
      accounts,
      balancesFor(1, { '2024-12': -1000, '2025-12': target * 3 }),
      anchor('2024-12'),
      anchor('2025-12'),
    ).goals
    expect(s.startPct).toBe(0)
    expect(s.endPct).toBe(100)
  })

  it('skips goals created after the review year', () => {
    expect(snap({ goalCreatedIn: '2026-01' })).toEqual([])
    expect(snap({ goalCreatedIn: '2025-12' })).toHaveLength(1)
  })

  it.each(['whenever', '', undefined as unknown as string])(
    'lists a goal with an unparseable creation month (%s) with a finite target',
    goalCreatedIn => {
      const [s] = snap({ goalCreatedIn, expenseValue: 60000 })
      expect(s).toMatchObject({ goalId: 7 })
      expect(Number.isFinite(s.target)).toBe(true)
      expect(s.target).toBeGreaterThan(0)
    },
  )

  it.each(['whenever', ''])(
    'computes the same snapshot for creation month %j whatever the system clock says',
    value => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2020-06-15T12:00:00Z'))
        const first = snap({ goalCreatedIn: value, expenseValue: 60000 })
        vi.setSystemTime(new Date('2031-06-15T12:00:00Z'))
        const second = snap({ goalCreatedIn: value, expenseValue: 60000 })
        expect(first).toHaveLength(1)
        expect(second).toEqual(first)
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('values an unparseable creation month as if the goal was created in the review year', () => {
    expect(snap({ goalCreatedIn: 'whenever' })[0].target).toBe(snap({ goalCreatedIn: '2025-01' })[0].target)
  })

  it('does not mutate the input goal', () => {
    const input = { ...goal, goalCreatedIn: 'whenever' }
    snapshotGoals(2025, [input], '1990-01', GROWTH, [], [], anchor(null, 'missing'), anchor(null, 'missing'))
    expect(input.goalCreatedIn).toBe('whenever')
  })

  it('skips goals without a positive target and counts them', () => {
    expect(snapAll({ goalEndYear: '' })).toEqual({ goals: [], skipped: 1 })
  })

  it('does not count a goal as skipped when it did not exist yet', () => {
    expect(snapAll({ goalEndYear: '', goalCreatedIn: '2030-01' })).toEqual({ goals: [], skipped: 0 })
  })

  it('counts nothing as skipped when every goal has a target', () => {
    expect(snapAll().skipped).toBe(0)
  })

  it('reports null balances and progress for missing or incomplete anchors', () => {
    const [s] = snapshotGoals(
      2025,
      [goal],
      '1990-01',
      GROWTH,
      makeAccounts({ goalType: 'fi' }),
      balancesFor(1, { '2025-12': 100 }),
      anchor(null, 'missing'),
      anchor('2025-12', 'incomplete'),
    ).goals
    expect(s).toMatchObject({ startBalance: null, endBalance: null, startPct: null, endPct: null })
  })

  describe('GW target and progress', () => {
    const gwGoal = makeGwGoal({ fiGoalId: 7, disburseAge: 55, disburseAmount: 50000, growthRate: 5 })
    const gwTarget = getGwTarget(goal, [gwGoal], '1990-01', GROWTH.inflation)
    const run = (gwGoals: ReturnType<typeof makeGwGoal>[]) =>
      snapshotGoals(
        2025,
        [goal],
        '1990-01',
        GROWTH,
        makeAccounts({ goalType: 'gw' }),
        balancesFor(1, { '2024-12': gwTarget / 4, '2025-12': gwTarget / 2 }),
        anchor('2024-12'),
        anchor('2025-12'),
        gwGoals,
      ).goals[0]

    it('measures GW balances against the goal’s GW target at the two anchors', () => {
      const s = run([gwGoal])

      expect(s.gwTarget).toBeCloseTo(gwTarget, 2)
      expect(s.startGwPct).toBeCloseTo(25, 1)
      expect(s.endGwPct).toBeCloseTo(50, 1)
    })

    it('has no GW target or progress for a goal without GW goals', () => {
      const s = run([])

      expect(s.gwTarget).toBeNull()
      expect(s.startGwPct).toBeNull()
      expect(s.endGwPct).toBeNull()
    })

    it('ignores GW goals that belong to another FI goal', () => {
      expect(run([{ ...gwGoal, fiGoalId: 99 }]).gwTarget).toBeNull()
    })

    it('has no GW progress when the anchors are unusable', () => {
      const s = snapshotGoals(
        2025,
        [goal],
        '1990-01',
        GROWTH,
        makeAccounts({ goalType: 'gw' }),
        [],
        anchor(null, 'missing'),
        anchor(null, 'missing'),
        [gwGoal],
      ).goals[0]

      expect(s.gwTarget).toBeGreaterThan(0)
      expect(s.startGwPct).toBeNull()
      expect(s.endGwPct).toBeNull()
    })

    it('caps GW progress at 100 percent', () => {
      const s = snapshotGoals(
        2025,
        [goal],
        '1990-01',
        GROWTH,
        makeAccounts({ goalType: 'gw' }),
        balancesFor(1, { '2024-12': gwTarget * 3, '2025-12': gwTarget * 3 }),
        anchor('2024-12'),
        anchor('2025-12'),
        [gwGoal],
      ).goals[0]

      expect(s.endGwPct).toBe(100)
    })
  })

  describe('endGwBalance', () => {
    const gwSnap = (
      accounts: ReturnType<typeof makeAccounts>,
      balances: ReturnType<typeof balancesFor>,
      end: NetWorthAnchor = anchor('2025-12'),
    ) => snapshotGoals(2025, [goal], '1990-01', GROWTH, accounts, balances, anchor('2024-12'), end).goals[0]

    it('sums GW accounts at the end month only, leaving FI accounts out', () => {
      expect(snap()[0].endGwBalance).toBeCloseTo(target * 5, 1)
    })

    it('counts inactive GW accounts so a past year does not depend on today’s status', () => {
      const s = gwSnap(makeAccounts({ goalType: 'gw' }, { goalType: 'gw', status: 'inactive' }, { goalType: 'fi' }), [
        ...balancesFor(1, { '2024-12': 999, '2025-12': 1000 }),
        ...balancesFor(2, { '2025-12': 250.5 }),
        ...balancesFor(3, { '2025-12': 7 }),
      ])
      expect(s.endGwBalance).toBe(1250.5)
    })

    it('is null when the end anchor is missing', () => {
      const s = gwSnap(makeAccounts({ goalType: 'gw' }), balancesFor(1, { '2025-12': 1000 }), anchor(null, 'missing'))
      expect(s.endGwBalance).toBeNull()
    })

    it('is null when the end anchor is incomplete', () => {
      const s = gwSnap(
        makeAccounts({ goalType: 'gw' }),
        balancesFor(1, { '2025-12': 1000 }),
        anchor('2025-12', 'incomplete'),
      )
      expect(s.endGwBalance).toBeNull()
    })

    it('is 0 when there are no GW accounts', () => {
      const s = gwSnap(makeAccounts({ goalType: 'fi' }), balancesFor(1, { '2025-12': 1000 }))
      expect(s.endGwBalance).toBe(0)
    })

    it('is 0 when GW accounts have no balance in the end month', () => {
      const s = gwSnap(makeAccounts({ goalType: 'gw' }), balancesFor(1, { '2024-12': 1000 }))
      expect(s.endGwBalance).toBe(0)
    })
  })
})
