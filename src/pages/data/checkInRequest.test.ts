import { describe, expect, it } from 'vitest'
import { getCheckInRequestMonth, hasCheckInRequest } from './checkInRequest'
import { makeAccount, makeBalanceEntry } from '../../test/factories'

const NOW = new Date(2026, 10, 8, 12)
const accounts = [makeAccount({ id: 1, name: 'A' }), makeAccount({ id: 2, name: 'B' })]
const complete = [
  makeBalanceEntry({ id: 1, accountId: 1, month: '2026-09' }),
  makeBalanceEntry({ id: 2, accountId: 2, month: '2026-09' }),
]
const partial = [...complete, makeBalanceEntry({ id: 3, accountId: 1, month: '2026-10' })]
const request = (month: unknown) => ({ checkIn: { month } })

describe('hasCheckInRequest', () => {
  it.each([
    [{ checkIn: {} }, true],
    [{ checkIn: null }, true],
    [{ other: 1 }, false],
    [null, false],
    ['x', false],
  ])('reads %j as %s', (state, expected) => {
    expect(hasCheckInRequest(state)).toBe(expected)
  })
})

describe('getCheckInRequestMonth', () => {
  it('accepts a new month before the current month', () => {
    expect(getCheckInRequestMonth(request('2026-10'), accounts, complete, NOW)).toBe('2026-10')
  })

  it('accepts the current month', () => {
    expect(getCheckInRequestMonth(request('2026-11'), accounts, complete, NOW)).toBe('2026-11')
  })

  it('accepts an existing month that is still partial', () => {
    expect(getCheckInRequestMonth(request('2026-10'), accounts, partial, NOW)).toBe('2026-10')
  })

  it('rejects an existing month that is already complete', () => {
    expect(getCheckInRequestMonth(request('2026-09'), accounts, complete, NOW)).toBeNull()
  })

  it('rejects a month in the future', () => {
    expect(getCheckInRequestMonth(request('2026-12'), accounts, complete, NOW)).toBeNull()
  })

  it.each([['2026-1'], ['2026-13'], ['October'], [''], [202610], [null], [undefined]])(
    'rejects the invalid month %j',
    month => {
      expect(getCheckInRequestMonth(request(month), accounts, complete, NOW)).toBeNull()
    },
  )

  it.each([[null], [undefined], ['2026-10'], [{}], [{ checkIn: null }], [{ checkIn: 'x' }], [{ checkIn: {} }]])(
    'rejects the malformed state %j',
    state => {
      expect(getCheckInRequestMonth(state, accounts, complete, NOW)).toBeNull()
    },
  )

  it('rejects when there are no active accounts', () => {
    const inactive = [makeAccount({ id: 1, status: 'inactive' })]
    expect(getCheckInRequestMonth(request('2026-10'), inactive, complete, NOW)).toBeNull()
  })

  it('rejects when there are no valid balances', () => {
    const malformed = [makeBalanceEntry({ month: '2026-1' })]
    expect(getCheckInRequestMonth(request('2026-10'), accounts, [], NOW)).toBeNull()
    expect(getCheckInRequestMonth(request('2026-10'), accounts, malformed, NOW)).toBeNull()
  })

  it('uses the latest non-future month as the reporting month for a new account', () => {
    const withNew = [...accounts, makeAccount({ id: 3, name: 'New' })]
    const balances = [...partial, makeBalanceEntry({ id: 9, accountId: 1, month: '2026-12' })]
    expect(getCheckInRequestMonth(request('2026-10'), withNew, balances, NOW)).toBe('2026-10')
    expect(getCheckInRequestMonth(request('2026-09'), withNew, balances, NOW)).toBeNull()
  })
})
