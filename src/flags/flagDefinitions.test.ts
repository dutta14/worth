import { describe, expect, it } from 'vitest'
import featureFlags from '../../feature-flags.json'
import { FLAGS } from './flagDefinitions'

describe('flag definitions', () => {
  it('defines modern-design as a temporary boolean flag that defaults to on', () => {
    expect(FLAGS.MODERN_DESIGN).toMatchObject({
      id: 'modern-design',
      type: 'boolean',
      default: true,
      temporary: true,
    })
  })

  it('keeps the modern-design rollout at 100 percent', () => {
    expect(featureFlags.flags['modern-design']).toEqual({ percentage: 100 })
  })

  it('gives every flag a unique id', () => {
    const flagIds = Object.values(FLAGS).map(flag => flag.id)
    expect(new Set(flagIds).size).toBe(flagIds.length)
  })

  it('registers every defined flag in feature-flags.json and nothing else', () => {
    const flagIds = Object.values(FLAGS).map(flag => flag.id)
    expect(Object.keys(featureFlags.flags).sort()).toEqual([...flagIds].sort())
  })
})
