import { describe, it, expect } from 'vitest'
import { applyDedupe, dedupeKey, normalizeDescription } from './dedupe'

const row = (description: string, amountCents = -425, date = '2026-10-02') => ({ date, amountCents, description })

describe('normalizeDescription', () => {
  it('lowercases, drops diacritics and collapses whitespace', () => {
    expect(normalizeDescription('  CAFÉ   Nero ')).toBe('cafe nero')
  })
})

describe('dedupeKey', () => {
  it('ignores description case and spacing but not amount or date', () => {
    expect(dedupeKey(row('Coffee  Shop'))).toBe(dedupeKey(row('coffee shop')))
    expect(dedupeKey(row('Coffee'))).not.toBe(dedupeKey(row('Coffee', -426)))
    expect(dedupeKey(row('Coffee'))).not.toBe(dedupeKey(row('Coffee', -425, '2026-10-03')))
  })
})

describe('applyDedupe', () => {
  it('accepts everything when nothing is known', () => {
    const { accepted, duplicates } = applyDedupe([row('A'), row('B')], new Map())
    expect(accepted).toHaveLength(2)
    expect(duplicates).toEqual([])
  })

  it('keeps two identical same-day purchases on the first import', () => {
    const { accepted } = applyDedupe([row('Coffee'), row('Coffee')], new Map())
    expect(accepted).toHaveLength(2)
  })

  it('accepts nothing when the same two purchases are already stored', () => {
    const known = new Map([[dedupeKey(row('Coffee')), 2]])
    const { accepted, duplicates } = applyDedupe([row('Coffee'), row('Coffee')], known)
    expect(accepted).toEqual([])
    expect(duplicates).toHaveLength(2)
  })

  it('accepts only the surplus when the file has more repeats than are stored', () => {
    const known = new Map([[dedupeKey(row('Coffee')), 1]])
    const { accepted, duplicates } = applyDedupe([row('Coffee'), row('Coffee'), row('Coffee')], known)
    expect(accepted).toHaveLength(2)
    expect(duplicates).toHaveLength(1)
  })

  it('records accepted rows so a later file dedupes against them', () => {
    const known = new Map<string, number>()
    applyDedupe([row('Coffee')], known)
    const second = applyDedupe([row('Coffee')], known)
    expect(second.accepted).toEqual([])
    expect(second.duplicates).toHaveLength(1)
  })
})
