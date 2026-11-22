import { describe, it, expect } from 'vitest'
import { makeGoal } from '../../../test/factories'
import { balancesFor, GROWTH, makeAccounts } from '../../../test/reviewFixtures'
import { getFiTarget } from '../../goal/utils/goalCalculations'
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

const snap = (overrides: Partial<Parameters<typeof snapshotGoals>[1][number]> = {}, year = 2025) =>
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
    )
    expect(s.startPct).toBe(0)
    expect(s.endPct).toBe(100)
  })

  it('skips goals created after the review year', () => {
    expect(snap({ goalCreatedIn: '2026-01' })).toEqual([])
    expect(snap({ goalCreatedIn: '2025-12' })).toHaveLength(1)
  })

  it('counts a goal with an unparseable creation month as existing', () => {
    expect(snap({ goalCreatedIn: 'whenever', expenseValue: 0 })).toHaveLength(1)
    expect(snap({ goalCreatedIn: undefined as unknown as string, expenseValue: 0 })).toHaveLength(1)
  })

  it('skips goals without a positive target', () => {
    expect(snap({ goalEndYear: '' })).toEqual([])
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
    )
    expect(s).toMatchObject({ startBalance: null, endBalance: null, startPct: null, endPct: null })
  })
})
