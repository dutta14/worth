import { describe, expect, it } from 'vitest'
import { describePriorYear } from './priorYear'

describe('describePriorYear', () => {
  it('words an increase in dollars in lower case after the colon', () => {
    expect(describePriorYear(2024, 65000, 60000, 'usd')).toBe('vs. 2024: up $5,000')
  })

  it('words a decrease in points', () => {
    expect(describePriorYear(2024, 32.9, 35, 'points')).toBe('vs. 2024: down 2.1 points')
  })

  it('says no change when the rounded difference is zero', () => {
    expect(describePriorYear(2024, 100.04, 100, 'points')).toBe('vs. 2024: no change')
  })

  it.each([
    [null, 5],
    [5, null],
    [5, undefined],
  ])('returns null when either side is unavailable (%s, %s)', (current, prior) => {
    expect(describePriorYear(2024, current, prior, 'usd')).toBeNull()
  })
})
