import { describe, expect, it } from 'vitest'
import featureFlags from '../../feature-flags.json'
import { FLAGS } from './flagDefinitions'

describe('annual-review flag', () => {
  it('is a temporary boolean flag that defaults to off', () => {
    expect(FLAGS.ANNUAL_REVIEW).toEqual({
      id: 'annual-review',
      type: 'boolean',
      default: false,
      description: 'Shows the Annual Review tab under Wealth',
      temporary: true,
    })
  })

  it('is registered in feature-flags.json at 0 percent', () => {
    expect(featureFlags.flags['annual-review']).toEqual({ percentage: 0 })
  })
})

describe('monthly-check-in flag', () => {
  it('is a temporary boolean flag that defaults to off', () => {
    expect(FLAGS.MONTHLY_CHECK_IN).toEqual({
      id: 'monthly-check-in',
      type: 'boolean',
      default: false,
      description: 'Home check-in strip, partial-month indicators, and Details check-in mode',
      temporary: true,
    })
  })

  it('is registered in feature-flags.json at 0 percent', () => {
    expect(featureFlags.flags['monthly-check-in']).toEqual({ percentage: 0 })
  })

  it('leaves the modern-design rollout untouched', () => {
    expect(featureFlags.flags['modern-design']).toEqual({ percentage: 100 })
  })

  it('gives every flag a unique id', () => {
    const flagIds = Object.values(FLAGS).map(flag => flag.id)
    expect(new Set(flagIds).size).toBe(flagIds.length)
  })
})
