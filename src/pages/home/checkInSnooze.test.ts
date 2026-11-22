import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SNOOZE_DAYS, isSnoozed, loadSnooze, saveSnooze, snoozeFor } from './checkInSnooze'

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('snoozeFor', () => {
  it('snoozes for 7 days by default, ending on the 7th day after today (local)', () => {
    expect(SNOOZE_DAYS).toBe(7)
    expect(snoozeFor('2026-10', new Date(2026, 10, 8, 12))).toEqual({ month: '2026-10', until: '2026-11-15' })
  })

  it('rolls over month and year ends', () => {
    expect(snoozeFor('2026-12', new Date(2026, 11, 28, 23, 59))).toEqual({ month: '2026-12', until: '2027-01-04' })
  })

  it('accepts a custom number of days', () => {
    expect(snoozeFor('2026-10', new Date(2026, 10, 8), 1).until).toBe('2026-11-09')
  })
})

describe('isSnoozed', () => {
  const snooze = { month: '2026-10', until: '2026-11-15' }

  it('is snoozed while today is before until, for the same reporting month', () => {
    expect(isSnoozed(snooze, '2026-10', '2026-11-08')).toBe(true)
    expect(isSnoozed(snooze, '2026-10', '2026-11-14')).toBe(true)
  })

  it('is not snoozed on the until day or later', () => {
    expect(isSnoozed(snooze, '2026-10', '2026-11-15')).toBe(false)
    expect(isSnoozed(snooze, '2026-10', '2027-01-01')).toBe(false)
  })

  it('is not snoozed for a different reporting month', () => {
    expect(isSnoozed(snooze, '2026-11', '2026-11-08')).toBe(false)
  })

  it('is not snoozed without a snooze or a reporting month', () => {
    expect(isSnoozed(null, '2026-10', '2026-11-08')).toBe(false)
    expect(isSnoozed(snooze, null, '2026-11-08')).toBe(false)
  })
})

describe('loadSnooze and saveSnooze', () => {
  it('returns null when nothing is stored', () => {
    expect(loadSnooze()).toBeNull()
  })

  it('round-trips a snooze through localStorage as JSON', () => {
    saveSnooze({ month: '2026-10', until: '2026-11-15' })
    expect(localStorage.getItem('checkin-snooze')).toBe('{"month":"2026-10","until":"2026-11-15"}')
    expect(loadSnooze()).toEqual({ month: '2026-10', until: '2026-11-15' })
  })

  it('returns null for invalid JSON', () => {
    localStorage.setItem('checkin-snooze', '{not json')
    expect(loadSnooze()).toBeNull()
  })

  it.each([
    ['a string', '"2026-11-15"'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a missing until', '{"month":"2026-10"}'],
    ['a missing month', '{"until":"2026-11-15"}'],
    ['non-string fields', '{"month":202610,"until":20261115}'],
    ['an invalid month', '{"month":"2026-13","until":"2026-11-15"}'],
    ['an invalid until', '{"month":"2026-10","until":"next week"}'],
    ['an out-of-range until day', '{"month":"2026-10","until":"2026-11-32"}'],
  ])('returns null for %s', (_label, raw) => {
    localStorage.setItem('checkin-snooze', raw)
    expect(loadSnooze()).toBeNull()
  })

  it('treats an expired snooze as not snoozed', () => {
    saveSnooze({ month: '2026-10', until: '2026-11-15' })
    expect(isSnoozed(loadSnooze(), '2026-10', '2026-11-20')).toBe(false)
  })

  it('treats a snooze for another month as not snoozed', () => {
    saveSnooze({ month: '2026-10', until: '2026-11-15' })
    expect(isSnoozed(loadSnooze(), '2026-11', '2026-11-08')).toBe(false)
  })

  it('snoozes for the reporting month from the system date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 8, 12))
    saveSnooze(snoozeFor('2026-10', new Date()))
    expect(isSnoozed(loadSnooze(), '2026-10', '2026-11-14')).toBe(true)
    expect(isSnoozed(loadSnooze(), '2026-10', '2026-11-15')).toBe(false)
  })
})
