import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STALE_AFTER_DAYS,
  addMonths,
  currentMonthKey,
  daysSinceMonthEnd,
  getCheckInState,
  getMonthStatus,
  isMonthKey,
  toDayKey,
} from './monthStatus'
import type { Account, BalanceEntry } from './types'

const makeAccount = (id: number, status: Account['status'] = 'active'): Account => ({
  id,
  name: `Account ${id}`,
  type: 'liquid',
  owner: 'primary',
  status,
  goalType: 'gw',
  nature: 'asset',
  allocation: 'cash',
})

let nextEntryId = 1
const entry = (accountId: number, month: string, balance = 100): BalanceEntry => ({
  id: nextEntryId++,
  accountId,
  month,
  balance,
})

const ids = (accounts: Account[]) => accounts.map(a => a.id)
const activeAccounts = (count: number) => Array.from({ length: count }, (_, i) => makeAccount(i + 1))
const fullMonth = (accountIds: number[], month: string) => accountIds.map(id => entry(id, month))
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

// 2026-11-08 local noon: C = 2026-11, P = 2026-10
const setToday = (y: number, m: number, d: number) => vi.setSystemTime(new Date(y, m - 1, d, 12, 0, 0))

beforeEach(() => {
  vi.useFakeTimers()
  setToday(2026, 11, 8)
  nextEntryId = 1
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isMonthKey', () => {
  it.each(['2026-01', '2026-12', '0001-09', '1999-10'])('accepts %s', key => {
    expect(isMonthKey(key)).toBe(true)
  })

  it.each([
    '2026-1',
    '2026-13',
    '2026-00',
    '26-01',
    '2026-011',
    '2026/01',
    ' 2026-01',
    '2026-01 ',
    '',
    'abcd-ef',
    '2026-01-15',
  ])('rejects %j', key => {
    expect(isMonthKey(key)).toBe(false)
  })
})

describe('currentMonthKey and toDayKey', () => {
  it('formats the local month and day with zero padding', () => {
    setToday(2026, 3, 5)
    expect(currentMonthKey(new Date())).toBe('2026-03')
    expect(toDayKey(new Date())).toBe('2026-03-05')
  })

  it('formats December 31 without rolling into the next year', () => {
    setToday(2026, 12, 31)
    expect(currentMonthKey(new Date())).toBe('2026-12')
    expect(toDayKey(new Date())).toBe('2026-12-31')
  })
})

describe('addMonths', () => {
  it.each([
    ['2026-10', 1, '2026-11'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', 0, '2026-03'],
    ['2026-11', -11, '2025-12'],
    ['2026-11', 14, '2028-01'],
    ['2026-01', -13, '2024-12'],
    ['2026-06', -6, '2025-12'],
  ])('addMonths(%s, %i) is %s', (month, delta, expected) => {
    expect(addMonths(month, delta)).toBe(expected)
  })

  it('returns an invalid key unchanged', () => {
    expect(addMonths('2026-13', 1)).toBe('2026-13')
  })
})

describe('daysSinceMonthEnd', () => {
  it('is 0 on the last day of the month', () => {
    setToday(2026, 10, 31)
    expect(daysSinceMonthEnd('2026-10', new Date())).toBe(0)
  })

  it('is 1 on the day after the month ends', () => {
    setToday(2026, 11, 1)
    expect(daysSinceMonthEnd('2026-10', new Date())).toBe(1)
  })

  it('is null before the last day of the month, including the current month', () => {
    setToday(2026, 10, 30)
    expect(daysSinceMonthEnd('2026-10', new Date())).toBeNull()
    expect(daysSinceMonthEnd('2026-12', new Date())).toBeNull()
  })

  it('is null for an invalid key', () => {
    expect(daysSinceMonthEnd('2026-13', new Date())).toBeNull()
  })

  it('counts across a leap February', () => {
    setToday(2024, 3, 1)
    expect(daysSinceMonthEnd('2024-02', new Date())).toBe(1)
    setToday(2023, 3, 1)
    expect(daysSinceMonthEnd('2023-02', new Date())).toBe(1)
    setToday(2024, 3, 10)
    expect(daysSinceMonthEnd('2024-01', new Date())).toBe(39)
  })

  it('ignores the time of day', () => {
    vi.setSystemTime(new Date(2026, 10, 8, 0, 0, 1))
    expect(daysSinceMonthEnd('2026-10', new Date())).toBe(8)
    vi.setSystemTime(new Date(2026, 10, 8, 23, 59, 59))
    expect(daysSinceMonthEnd('2026-10', new Date())).toBe(8)
  })

  describe('in a timezone with daylight saving time', () => {
    const originalTz = process.env.TZ

    beforeEach(() => {
      process.env.TZ = 'America/Los_Angeles'
    })

    afterEach(() => {
      process.env.TZ = originalTz
    })

    it('is unchanged by the spring-forward day (2026-03-08)', () => {
      // 2026-02-28 to 2026-03-09 spans a 23-hour day
      setToday(2026, 3, 9)
      expect(daysSinceMonthEnd('2026-02', new Date())).toBe(9)
      setToday(2026, 3, 8)
      expect(daysSinceMonthEnd('2026-02', new Date())).toBe(8)
    })

    it('is unchanged by the fall-back day (2026-11-01)', () => {
      // 2026-10-31 to 2026-11-02 spans a 25-hour day
      setToday(2026, 11, 2)
      expect(daysSinceMonthEnd('2026-10', new Date())).toBe(2)
      setToday(2026, 11, 1)
      expect(daysSinceMonthEnd('2026-10', new Date())).toBe(1)
    })

    it('counts whole days across the whole summer', () => {
      setToday(2026, 11, 8)
      expect(daysSinceMonthEnd('2026-02', new Date())).toBe(253)
    })
  })
})

describe('getMonthStatus', () => {
  it('treats a balance of 0 as present', () => {
    const accounts = activeAccounts(1)
    const status = getMonthStatus(accounts, [entry(1, '2026-10', 0)], '2026-10', '2026-10')
    expect(status.isPartial).toBe(false)
    expect(ids(status.present)).toEqual([1])
  })

  it('ignores orphan entries and duplicate rows when counting', () => {
    const accounts = activeAccounts(2)
    const balances = [entry(1, '2026-10'), entry(1, '2026-10'), entry(99, '2026-10')]
    const status = getMonthStatus(accounts, balances, '2026-10', '2026-10')
    expect(ids(status.expected)).toEqual([1, 2])
    expect(ids(status.present)).toEqual([1])
    expect(ids(status.missing)).toEqual([2])
  })

  it('never expects inactive accounts, even when they have an entry for the month', () => {
    const accounts = [makeAccount(1), makeAccount(2, 'inactive')]
    const balances = [entry(1, '2026-10'), entry(2, '2026-10'), entry(2, '2026-09')]
    const status = getMonthStatus(accounts, balances, '2026-10', '2026-10')
    expect(ids(status.expected)).toEqual([1])
    expect(status.isPartial).toBe(false)
  })

  it('does not expect an account whose only balances are in a later month', () => {
    const accounts = activeAccounts(2)
    const balances = [entry(1, '2026-10'), entry(2, '2026-12')]
    const status = getMonthStatus(accounts, balances, '2026-10', '2026-10')
    expect(ids(status.expected)).toEqual([1])
  })

  it('ignores balances with an invalid month key', () => {
    const accounts = activeAccounts(1)
    const balances = [entry(1, '2026-1'), entry(1, '2026-13')]
    expect(ids(getMonthStatus(accounts, balances, '2026-09', '2026-10').expected)).toEqual([])
    expect(ids(getMonthStatus(accounts, balances, '2026-10', '2026-10').missing)).toEqual([1])
  })

  it('returns an empty status for an invalid month', () => {
    const status = getMonthStatus(activeAccounts(2), [entry(1, '2026-10')], '2026-13', '2026-10')
    expect(status.expected).toEqual([])
    expect(status.isPartial).toBe(false)
  })

  it('reports the month it was computed for', () => {
    expect(getMonthStatus([], [], '2026-10', '2026-10').month).toBe('2026-10')
  })
})

describe('getCheckInState: section 3.3 worked examples (today 2026-11-08)', () => {
  it('1. 9 active, Oct has 7: partial, 2 missing, d = 8, not stale', () => {
    const accounts = activeAccounts(9)
    const state = getCheckInState(accounts, fullMonth(range(7), '2026-10'), new Date())
    expect(state.kind).toBe('partial')
    expect(state.reportingMonth).toBe('2026-10')
    expect(state.targetMonth).toBe('2026-10')
    expect(state.status?.expected).toHaveLength(9)
    expect(state.status?.present).toHaveLength(7)
    expect(ids(state.status?.missing ?? [])).toEqual([8, 9])
    expect(state.daysSinceMonthEnd).toBe(8)
    expect(state.isStale).toBe(false)
    expect(state.futureMonths).toEqual([])
  })

  it('2. 9 active, Oct has 9: up-to-date', () => {
    const state = getCheckInState(activeAccounts(9), fullMonth(range(9), '2026-10'), new Date())
    expect(state.kind).toBe('up-to-date')
    expect(state.targetMonth).toBeNull()
    expect(state.status?.isPartial).toBe(false)
  })

  it('3. 9 active, Sep has 9, no Oct: due, target Oct, stale at d = 39', () => {
    const state = getCheckInState(activeAccounts(9), fullMonth(range(9), '2026-09'), new Date())
    expect(state.kind).toBe('due')
    expect(state.reportingMonth).toBe('2026-09')
    expect(state.targetMonth).toBe('2026-10')
    expect(state.daysSinceMonthEnd).toBe(39)
    expect(state.isStale).toBe(true)
  })

  it('4. account #10 first balance 2026-06: not expected in March, expected in October', () => {
    const accounts = activeAccounts(10)
    const balances = [...fullMonth(range(9), '2026-03'), ...fullMonth(range(9), '2026-10'), entry(10, '2026-06')]
    const march = getMonthStatus(accounts, balances, '2026-03', '2026-10')
    expect(march.expected).toHaveLength(9)
    expect(march.present).toHaveLength(9)
    expect(march.isPartial).toBe(false)
    const october = getMonthStatus(accounts, balances, '2026-10', '2026-10')
    expect(october.expected).toHaveLength(10)
    expect(ids(october.missing)).toEqual([10])
  })

  it('4b. the earliest-balance rule holds with 8 accounts that predate #9', () => {
    const accounts = activeAccounts(9)
    const balances = [...fullMonth(range(8), '2026-03'), ...fullMonth(range(9), '2026-10')]
    const march = getMonthStatus(accounts, balances, '2026-03', '2026-10')
    expect(march.expected).toHaveLength(8)
    expect(march.present).toHaveLength(8)
    expect(getMonthStatus(accounts, balances, '2026-10', '2026-10').expected).toHaveLength(9)
  })

  it('5. 8 active plus 1 inactive with entries through March: up-to-date, inactive not missing', () => {
    const accounts = [...activeAccounts(8), makeAccount(9, 'inactive')]
    const balances = [...fullMonth(range(8), '2026-10'), entry(9, '2026-03')]
    const state = getCheckInState(accounts, balances, new Date())
    expect(state.kind).toBe('up-to-date')
    expect(state.status?.expected).toHaveLength(8)
    expect(state.status?.missing).toEqual([])
  })

  it('6. new active account with no entries, others in Oct: partial, 1 missing', () => {
    const accounts = activeAccounts(9)
    const state = getCheckInState(accounts, fullMonth(range(8), '2026-10'), new Date())
    expect(state.kind).toBe('partial')
    expect(ids(state.status?.missing ?? [])).toEqual([9])
  })

  it('7a. no accounts: hidden', () => {
    const state = getCheckInState([], fullMonth([1], '2026-10'), new Date())
    expect(state.kind).toBe('hidden')
    expect(state.reportingMonth).toBeNull()
    expect(state.status).toBeNull()
    expect(state.targetMonth).toBeNull()
    expect(state.isStale).toBe(false)
  })

  it('7b. accounts but no balances: hidden', () => {
    expect(getCheckInState(activeAccounts(3), [], new Date()).kind).toBe('hidden')
  })

  it('7c. only inactive accounts: hidden', () => {
    const accounts = [makeAccount(1, 'inactive')]
    expect(getCheckInState(accounts, fullMonth([1], '2026-10'), new Date()).kind).toBe('hidden')
  })

  it('8. Oct complete, Dec has 3 of 9: up-to-date, December listed as a future month', () => {
    const balances = [...fullMonth(range(9), '2026-10'), ...fullMonth(range(3), '2026-12')]
    const state = getCheckInState(activeAccounts(9), balances, new Date())
    expect(state.kind).toBe('up-to-date')
    expect(state.reportingMonth).toBe('2026-10')
    expect(state.futureMonths).toEqual(['2026-12'])
  })

  it('8b. future months are sorted and deduplicated', () => {
    const balances = [
      ...fullMonth(range(2), '2027-01'),
      ...fullMonth(range(2), '2026-12'),
      ...fullMonth(range(2), '2026-10'),
    ]
    const state = getCheckInState(activeAccounts(2), balances, new Date())
    expect(state.futureMonths).toEqual(['2026-12', '2027-01'])
  })

  it('9. only 2026-12 entries: future-only', () => {
    const state = getCheckInState(activeAccounts(9), fullMonth(range(9), '2026-12'), new Date())
    expect(state.kind).toBe('future-only')
    expect(state.reportingMonth).toBeNull()
    expect(state.status).toBeNull()
    expect(state.targetMonth).toBeNull()
    expect(state.daysSinceMonthEnd).toBeNull()
    expect(state.isStale).toBe(false)
    expect(state.futureMonths).toEqual(['2026-12'])
  })

  it('10. a balance typed as 0 for Oct is present, not missing', () => {
    const accounts = activeAccounts(2)
    const balances = [entry(1, '2026-10', 500), entry(2, '2026-10', 0)]
    const state = getCheckInState(accounts, balances, new Date())
    expect(state.kind).toBe('up-to-date')
    expect(state.status?.missing).toEqual([])
  })

  it('11. Oct has entries only for an inactive account: partial, 9 missing', () => {
    const accounts = [...activeAccounts(9), makeAccount(10, 'inactive')]
    const state = getCheckInState(accounts, [entry(10, '2026-10')], new Date())
    expect(state.kind).toBe('partial')
    expect(state.status?.expected).toHaveLength(9)
    expect(state.status?.present).toHaveLength(0)
    expect(state.status?.missing).toHaveLength(9)
  })

  it('12. active account with Jan, Feb, Apr entries: 1 missing in March', () => {
    const accounts = activeAccounts(1)
    const balances = [entry(1, '2026-01'), entry(1, '2026-02'), entry(1, '2026-04')]
    const march = getMonthStatus(accounts, balances, '2026-03', '2026-04')
    expect(ids(march.missing)).toEqual([1])
    expect(march.isPartial).toBe(true)
    expect(getMonthStatus(accounts, balances, '2026-02', '2026-04').isPartial).toBe(false)
  })

  it('13. keys 2026-1 and 2026-13 are ignored by the whole feature', () => {
    const accounts = activeAccounts(2)
    const balances = [
      ...fullMonth(range(2), '2026-10'),
      ...fullMonth(range(2), '2026-1'),
      ...fullMonth(range(2), '2026-13'),
    ]
    const state = getCheckInState(accounts, balances, new Date())
    expect(state.kind).toBe('up-to-date')
    expect(state.reportingMonth).toBe('2026-10')
    expect(state.futureMonths).toEqual([])
  })

  it('13b. only invalid keys: hidden', () => {
    const state = getCheckInState(activeAccounts(2), fullMonth(range(2), '2026-13'), new Date())
    expect(state.kind).toBe('hidden')
  })

  it('14. R = Oct: Dec 5 is d = 35 (not stale), Dec 6 is d = 36 (stale)', () => {
    const accounts = activeAccounts(2)
    const balances = fullMonth(range(2), '2026-10')

    setToday(2026, 12, 5)
    const dec5 = getCheckInState(accounts, balances, new Date())
    expect(dec5.daysSinceMonthEnd).toBe(35)
    expect(dec5.isStale).toBe(false)

    setToday(2026, 12, 6)
    const dec6 = getCheckInState(accounts, balances, new Date())
    expect(dec6.daysSinceMonthEnd).toBe(36)
    expect(dec6.isStale).toBe(true)
  })
})

describe('getCheckInState: reporting month and kind rules', () => {
  it('uses the stale threshold constant', () => {
    expect(STALE_AFTER_DAYS).toBe(35)
  })

  it('has no days figure while the reporting month is the current month', () => {
    const state = getCheckInState(activeAccounts(1), [entry(1, '2026-11')], new Date())
    expect(state.kind).toBe('up-to-date')
    expect(state.daysSinceMonthEnd).toBeNull()
    expect(state.isStale).toBe(false)
  })

  it('treats the current month as partial when an account has no balance for it', () => {
    const balances = [entry(1, '2026-10'), entry(2, '2026-10'), entry(1, '2026-11')]
    const state = getCheckInState(activeAccounts(2), balances, new Date())
    expect(state.kind).toBe('partial')
    expect(state.reportingMonth).toBe('2026-11')
    expect(ids(state.status?.missing ?? [])).toEqual([2])
  })

  it('is due, not up-to-date, when the complete month is two months back', () => {
    const state = getCheckInState(activeAccounts(1), [entry(1, '2026-09')], new Date())
    expect(state.kind).toBe('due')
  })

  it('is up-to-date when the complete month is exactly last month', () => {
    const state = getCheckInState(activeAccounts(1), [entry(1, '2026-10')], new Date())
    expect(state.kind).toBe('up-to-date')
  })

  it('targets the next month across a year boundary', () => {
    setToday(2027, 3, 15)
    const state = getCheckInState(activeAccounts(1), [entry(1, '2026-12')], new Date())
    expect(state.kind).toBe('due')
    expect(state.targetMonth).toBe('2027-01')
  })

  it('is due when the latest complete month is old and stale', () => {
    setToday(2027, 3, 15)
    const state = getCheckInState(activeAccounts(1), [entry(1, '2024-01')], new Date())
    expect(state.kind).toBe('due')
    expect(state.targetMonth).toBe('2024-02')
    expect(state.isStale).toBe(true)
  })

  it('stays partial when future entries exist but the reporting month is incomplete', () => {
    const balances = [entry(1, '2026-10'), entry(2, '2026-09'), entry(2, '2026-12')]
    const state = getCheckInState(activeAccounts(2), balances, new Date())
    expect(state.kind).toBe('partial')
    expect(state.futureMonths).toEqual(['2026-12'])
  })

  it('does not mutate its inputs', () => {
    const accounts = activeAccounts(3)
    const balances = [entry(1, '2026-10'), entry(2, '2026-09')]
    const accountsCopy = JSON.stringify(accounts)
    const balancesCopy = JSON.stringify(balances)
    getCheckInState(accounts, balances, new Date())
    expect(JSON.stringify(accounts)).toBe(accountsCopy)
    expect(JSON.stringify(balances)).toBe(balancesCopy)
  })
})
