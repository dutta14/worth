import { describe, expect, it } from 'vitest'
import featureFlags from '../../feature-flags.json'
import { FLAGS } from './flagDefinitions'

describe('flag definitions', () => {
  it('gives every flag a unique id', () => {
    const flagIds = Object.values(FLAGS).map(flag => flag.id)
    expect(new Set(flagIds).size).toBe(flagIds.length)
  })

  it('registers every defined flag in feature-flags.json and nothing else', () => {
    const flagIds = Object.values(FLAGS).map(flag => flag.id)
    expect(Object.keys(featureFlags.flags).sort()).toEqual([...flagIds].sort())
  })
})
