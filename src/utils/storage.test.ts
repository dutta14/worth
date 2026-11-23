import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getStorageItem, setStorageItem, removeStorageItem, initStorageSchema } from './storage'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

// ── initStorageSchema ───────────────────────────────────────────

describe('initStorageSchema', () => {
  it('writes schema version 1 when no version exists', () => {
    initStorageSchema()
    expect(localStorage.getItem('storage-schema-version')).toBe('1')
  })

  it('does not overwrite when version is current', () => {
    localStorage.setItem('storage-schema-version', '1')
    initStorageSchema()
    expect(localStorage.getItem('storage-schema-version')).toBe('1')
  })

  it('upgrades from version 0', () => {
    localStorage.setItem('storage-schema-version', '0')
    initStorageSchema()
    expect(localStorage.getItem('storage-schema-version')).toBe('1')
  })
})

// ── getStorageItem — string keys ────────────────────────────────

describe('getStorageItem (string keys)', () => {
  it('returns fallback when key is missing', () => {
    expect(getStorageItem('darkMode', '0')).toBe('0')
  })

  it('returns stored value when valid', () => {
    localStorage.setItem('darkMode', '1')
    expect(getStorageItem('darkMode', '0')).toBe('1')
  })

  it('returns fallback when value is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('darkMode', 'invalid')
    expect(getStorageItem('darkMode', '0')).toBe('0')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid data for key "darkMode"'))
  })

  it('reads accentTheme as any non-empty string', () => {
    localStorage.setItem('accentTheme', 'teal')
    expect(getStorageItem('accentTheme', 'blue')).toBe('teal')
  })

  it('returns fallback for empty accentTheme', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('accentTheme', '')
    expect(getStorageItem('accentTheme', 'blue')).toBe('blue')
    expect(warn).toHaveBeenCalled()
  })

  it('validates goal-view-mode', () => {
    localStorage.setItem('goal-view-mode', 'list')
    expect(getStorageItem('goal-view-mode', 'grid')).toBe('list')

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('goal-view-mode', 'table')
    expect(getStorageItem('goal-view-mode', 'grid')).toBe('grid')
  })

  it('validates allowCsvImport', () => {
    localStorage.setItem('allowCsvImport', '1')
    expect(getStorageItem('allowCsvImport', '0')).toBe('1')
  })

  it('validates onboarding-dismissed', () => {
    localStorage.setItem('onboarding-dismissed', '1')
    expect(getStorageItem('onboarding-dismissed', '0')).toBe('1')
  })

  it('validates lab-pdf-to-csv', () => {
    localStorage.setItem('lab-pdf-to-csv', '1')
    expect(getStorageItem('lab-pdf-to-csv', '0')).toBe('1')
  })
})

// ── getStorageItem — JSON keys ──────────────────────────────────

describe('getStorageItem (JSON keys)', () => {
  it('returns fallback when key is missing', () => {
    expect(getStorageItem('home-card-order', [0, 1, 2, 3])).toEqual([0, 1, 2, 3])
  })

  it('returns parsed value when valid', () => {
    localStorage.setItem('home-card-order', JSON.stringify([3, 2, 1, 0, 4]))
    expect(getStorageItem('home-card-order', [0, 1, 2, 3, 4])).toEqual([3, 2, 1, 0, 4])
  })

  it('returns fallback for corrupt JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('home-card-order', '{not json')
    expect(getStorageItem('home-card-order', [0, 1, 2, 3])).toEqual([0, 1, 2, 3])
    expect(warn).toHaveBeenCalled()
  })

  it('returns fallback for wrong type (string instead of array)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('home-card-order', '"hello"')
    expect(getStorageItem('home-card-order', [0, 1, 2, 3])).toEqual([0, 1, 2, 3])
    expect(warn).toHaveBeenCalled()
  })

  it('returns fallback for home-card-order with wrong length', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('home-card-order', '[0, 1]')
    expect(getStorageItem('home-card-order', [0, 1, 2, 3])).toEqual([0, 1, 2, 3])
    expect(warn).toHaveBeenCalled()
  })

  it('returns the checkin-snooze fallback when the key is missing', () => {
    expect(getStorageItem('checkin-snooze', null)).toBeNull()
  })

  it('returns a valid checkin-snooze value', () => {
    localStorage.setItem('checkin-snooze', JSON.stringify({ month: '2026-10', until: '2026-11-15' }))
    expect(getStorageItem('checkin-snooze', null)).toEqual({ month: '2026-10', until: '2026-11-15' })
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a missing field', '{"month":"2026-10"}'],
    ['an invalid month', '{"month":"2026-13","until":"2026-11-15"}'],
    ['an invalid until', '{"month":"2026-10","until":"2026-11-5"}'],
  ])('returns the checkin-snooze fallback for %s', (_label, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('checkin-snooze', raw)
    expect(getStorageItem('checkin-snooze', null)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('validates flag-overrides as record', () => {
    const overrides = { 'test-flag': true }
    localStorage.setItem('flag-overrides', JSON.stringify(overrides))
    expect(getStorageItem('flag-overrides', {})).toEqual(overrides)
  })

  it('returns fallback for non-object flag-overrides', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('flag-overrides', '"not-an-object"')
    expect(getStorageItem('flag-overrides', {})).toEqual({})
  })

  it('validates flag-rollout-cache', () => {
    const cache = { config: { flags: {} }, fetchedAt: Date.now() }
    localStorage.setItem('flag-rollout-cache', JSON.stringify(cache))
    expect(getStorageItem('flag-rollout-cache', null)).toEqual(cache)
  })
})

// ── setStorageItem ──────────────────────────────────────────────

describe('setStorageItem', () => {
  it('writes string keys directly', () => {
    setStorageItem('darkMode', '1')
    expect(localStorage.getItem('darkMode')).toBe('1')
  })

  it('serializes JSON keys', () => {
    setStorageItem('home-card-order', [3, 2, 1, 0])
    expect(localStorage.getItem('home-card-order')).toBe('[3,2,1,0]')
  })

  it('serializes checkin-snooze as JSON', () => {
    setStorageItem('checkin-snooze', { month: '2026-10', until: '2026-11-15' })
    expect(localStorage.getItem('checkin-snooze')).toBe('{"month":"2026-10","until":"2026-11-15"}')
  })

  it('removes checkin-snooze', () => {
    setStorageItem('checkin-snooze', { month: '2026-10', until: '2026-11-15' })
    removeStorageItem('checkin-snooze')
    expect(localStorage.getItem('checkin-snooze')).toBeNull()
  })
})

// ── removeStorageItem ───────────────────────────────────────────

describe('removeStorageItem', () => {
  it('removes the key from localStorage', () => {
    localStorage.setItem('darkMode', '1')
    removeStorageItem('darkMode')
    expect(localStorage.getItem('darkMode')).toBeNull()
  })
})

// ── getStorageItem — remaining key validators ───────────────────

describe('getStorageItem (remaining key validators)', () => {
  it('validates flag-client-id as non-empty string', () => {
    localStorage.setItem('flag-client-id', 'abc-123')
    expect(getStorageItem('flag-client-id', 'default')).toBe('abc-123')
  })

  it('returns fallback for empty flag-client-id', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('flag-client-id', '')
    expect(getStorageItem('flag-client-id', 'default')).toBe('default')
  })

  it('validates fiTheme as non-empty string', () => {
    localStorage.setItem('fiTheme', 'green')
    expect(getStorageItem('fiTheme', 'blue')).toBe('green')
  })

  it('returns fallback for empty fiTheme', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('fiTheme', '')
    expect(getStorageItem('fiTheme', 'blue')).toBe('blue')
  })

  it('returns fallback for flag-rollout-cache missing fetchedAt', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('flag-rollout-cache', JSON.stringify({ config: {} }))
    expect(getStorageItem('flag-rollout-cache', null)).toBeNull()
  })

  it('returns fallback for flag-rollout-cache with non-number fetchedAt', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('flag-rollout-cache', JSON.stringify({ config: {}, fetchedAt: 'not-a-number' }))
    expect(getStorageItem('flag-rollout-cache', null)).toBeNull()
  })

  it('returns fallback for home-card-order with out-of-range values', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('home-card-order', JSON.stringify([0, 1, 2, 4]))
    expect(getStorageItem('home-card-order', [0, 1, 2, 3])).toEqual([0, 1, 2, 3])
  })

  it('returns fallback for home-card-order with negative values', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('home-card-order', JSON.stringify([-1, 0, 1, 2]))
    expect(getStorageItem('home-card-order', [0, 1, 2, 3])).toEqual([0, 1, 2, 3])
  })

  it('returns fallback for flag-overrides when value is an array', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('flag-overrides', JSON.stringify([1, 2, 3]))
    expect(getStorageItem('flag-overrides', {})).toEqual({})
  })
})

// ── initStorageSchema — edge cases ──────────────────────────────

describe('initStorageSchema (edge cases)', () => {
  it('treats non-numeric stored version as 0 and runs migration', () => {
    localStorage.setItem('storage-schema-version', 'abc')
    initStorageSchema()
    // NaN is coerced to 0, so migration runs and version is set to current
    expect(localStorage.getItem('storage-schema-version')).toBe('1')
  })
})

// ── setStorageItem — additional JSON keys ───────────────────────

describe('setStorageItem (additional JSON keys)', () => {
  it('serializes flag-overrides', () => {
    const overrides = { 'test-flag': true, 'other-flag': false }
    setStorageItem('flag-overrides', overrides)
    expect(JSON.parse(localStorage.getItem('flag-overrides')!)).toEqual(overrides)
  })

  it('serializes flag-rollout-cache', () => {
    const cache = { config: { flags: {} }, fetchedAt: 1234567890 }
    setStorageItem('flag-rollout-cache', cache)
    expect(JSON.parse(localStorage.getItem('flag-rollout-cache')!)).toEqual(cache)
  })
})

// ── removeStorageItem — edge cases ──────────────────────────────

describe('removeStorageItem (edge cases)', () => {
  it('is a no-op when key does not exist', () => {
    expect(() => removeStorageItem('darkMode')).not.toThrow()
    expect(localStorage.getItem('darkMode')).toBeNull()
  })
})

// ── Integration: corrupt data recovery ──────────────────────────

describe('corrupt data recovery', () => {
  it('recovers from corrupted home-card-order with fallback', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('home-card-order', '{"not": "an array"}')
    const result = getStorageItem('home-card-order', [0, 1, 2, 3])
    expect(result).toEqual([0, 1, 2, 3])
  })

  it('recovers from completely invalid JSON', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('flag-rollout-cache', '<<<corrupt>>>')
    expect(getStorageItem('flag-rollout-cache', null)).toBeNull()
  })
})

describe('sidebar-open-groups', () => {
  it('round-trips an array of group ids', () => {
    setStorageItem('sidebar-open-groups', ['goal', 'budget'])
    expect(getStorageItem('sidebar-open-groups', [])).toEqual(['goal', 'budget'])
  })

  it('returns the fallback for a non-array value or non-string entries', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('sidebar-open-groups', '"goal"')
    expect(getStorageItem('sidebar-open-groups', [])).toEqual([])
    localStorage.setItem('sidebar-open-groups', '[1, 2]')
    expect(getStorageItem('sidebar-open-groups', [])).toEqual([])
  })
})
