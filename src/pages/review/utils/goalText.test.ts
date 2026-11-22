import { describe, expect, it } from 'vitest'
import { makeReview } from '../../../test/reviewFixtures'
import type { GoalSnapshot } from '../types'
import { describeGoal, describeGoalBalance } from './goalText'

const goal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  goalId: 1,
  name: 'Retire at 55',
  target: 2_000_000,
  startBalance: 300000,
  endBalance: 380000,
  startPct: 15,
  endPct: 19,
  ...overrides,
})

describe('describeGoal', () => {
  it('says where the goal ended and how far it moved from the start of the year', () => {
    expect(describeGoal(goal(), makeReview())).toBe(
      'Retire at 55: 19.0% at the end of 2025; up 4.0 points from the start of the year',
    )
  })

  it('says down when progress fell and no change when it did not move', () => {
    expect(describeGoal(goal({ endPct: 12 }), makeReview())).toContain('down 3.0 points from the start of the year')
    expect(describeGoal(goal({ endPct: 15 }), makeReview())).toContain('no change from the start of the year')
  })

  it('reads Not available when the end anchor has no progress', () => {
    expect(describeGoal(goal({ endPct: null, endBalance: null }), makeReview())).toBe('Retire at 55: Not available')
  })

  it('does not invent a change when only the start is unavailable', () => {
    expect(describeGoal(goal({ startPct: null }), makeReview())).toBe(
      'Retire at 55: 19.0% at the end of 2025; change from the start of the year is not available',
    )
  })

  it('names the real months when the anchors are not December', () => {
    const base = makeReview()
    const review = makeReview({
      netWorth: {
        ...base.netWorth,
        start: { month: '2025-03', total: 50000, status: 'nearest', missing: [] },
        end: { month: '2025-10', total: 60000, status: 'nearest', missing: [] },
      },
    })
    expect(describeGoal(goal(), review)).toBe('Retire at 55: 19.0% in Oct 2025; up 4.0 points from Mar 2025')
  })
})

describe('describeGoalBalance', () => {
  it('states the FI balance against the target', () => {
    expect(describeGoalBalance(goal())).toBe('FI balance $380,000 of $2,000,000 target')
  })

  it('returns null when the end balance is unavailable', () => {
    expect(describeGoalBalance(goal({ endBalance: null }))).toBeNull()
  })
})
