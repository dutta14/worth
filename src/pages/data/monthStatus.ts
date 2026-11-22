import type { Account, BalanceEntry } from './types'

export type MonthKey = string // 'YYYY-MM', validated by isMonthKey

export const STALE_AFTER_DAYS = 35

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

export const isMonthKey = (v: string): boolean => MONTH_KEY_PATTERN.test(v)

const pad2 = (n: number): string => String(n).padStart(2, '0')

const formatMonthKey = (year: number, monthIndex: number): MonthKey =>
  `${String(year).padStart(4, '0')}-${pad2(monthIndex + 1)}`

export const currentMonthKey = (now: Date): MonthKey => formatMonthKey(now.getFullYear(), now.getMonth())

/** Local calendar day as 'YYYY-MM-DD'. */
export const toDayKey = (now: Date): string => `${currentMonthKey(now)}-${pad2(now.getDate())}`

/** Long month name, with the year added when it is not the current year. */
export const monthLabel = (month: MonthKey, today: Date): string => {
  const [year, m] = month.split('-').map(Number)
  const name = new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })
  return month.slice(0, 4) === currentMonthKey(today).slice(0, 4) ? name : `${name} ${year}`
}

/** Shifts a month key by `delta` months. An invalid key is returned unchanged. */
export const addMonths = (month: MonthKey, delta: number): MonthKey => {
  if (!isMonthKey(month)) return month
  const [year, m] = month.split('-').map(Number)
  const total = year * 12 + (m - 1) + delta
  return formatMonthKey(Math.floor(total / 12), ((total % 12) + 12) % 12)
}

/**
 * Whole local calendar days from the last day of `month` to today.
 * Null for an invalid key or while today is still before the last day of `month`.
 */
export const daysSinceMonthEnd = (month: MonthKey, now: Date): number | null => {
  if (!isMonthKey(month)) return null
  const [year, m] = month.split('-').map(Number)
  const lastDay = new Date(year, m, 0)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // A DST change makes a local day 23 or 25 hours long, so round instead of truncating.
  const days = Math.round((today.getTime() - lastDay.getTime()) / MS_PER_DAY)
  return days < 0 ? null : days
}

export interface MonthStatus {
  month: MonthKey
  expected: Account[]
  present: Account[]
  missing: Account[]
  isPartial: boolean
}

/**
 * Which active accounts are expected to have a balance for `month`, and which of them do.
 * An account is expected once it has a balance in `month` or earlier. An account with no valid
 * balance at all is expected only in `reportingMonth`, so a new account is asked for its first balance.
 */
export function getMonthStatus(
  accounts: Account[],
  balances: BalanceEntry[],
  month: MonthKey,
  reportingMonth: MonthKey,
): MonthStatus {
  const firstMonthByAccount = new Map<number, MonthKey>()
  const presentIds = new Set<number>()
  for (const entry of balances) {
    if (!isMonthKey(entry.month)) continue
    const first = firstMonthByAccount.get(entry.accountId)
    if (first === undefined || entry.month < first) firstMonthByAccount.set(entry.accountId, entry.month)
    if (entry.month === month) presentIds.add(entry.accountId)
  }

  const expected = isMonthKey(month)
    ? accounts.filter(account => {
        if (account.status !== 'active') return false
        const first = firstMonthByAccount.get(account.id)
        return first === undefined ? month === reportingMonth : first <= month
      })
    : []
  const present = expected.filter(account => presentIds.has(account.id))
  const missing = expected.filter(account => !presentIds.has(account.id))
  return { month, expected, present, missing, isPartial: missing.length > 0 }
}

export type CheckInKind = 'hidden' | 'future-only' | 'partial' | 'due' | 'up-to-date'

export interface CheckInState {
  kind: CheckInKind
  reportingMonth: MonthKey | null
  status: MonthStatus | null
  targetMonth: MonthKey | null
  daysSinceMonthEnd: number | null
  isStale: boolean
  futureMonths: MonthKey[]
}

const hiddenState = (): CheckInState => ({
  kind: 'hidden',
  reportingMonth: null,
  status: null,
  targetMonth: null,
  daysSinceMonthEnd: null,
  isStale: false,
  futureMonths: [],
})

export function getCheckInState(accounts: Account[], balances: BalanceEntry[], now: Date): CheckInState {
  if (!accounts.some(account => account.status === 'active')) return hiddenState()
  const validMonths = [...new Set(balances.map(entry => entry.month).filter(isMonthKey))].sort()
  if (validMonths.length === 0) return hiddenState()

  const current = currentMonthKey(now)
  const futureMonths = validMonths.filter(month => month > current)
  const reportingMonth = validMonths.filter(month => month <= current).pop()
  if (reportingMonth === undefined) return { ...hiddenState(), kind: 'future-only', futureMonths }

  const status = getMonthStatus(accounts, balances, reportingMonth, reportingMonth)
  const days = daysSinceMonthEnd(reportingMonth, now)
  const base = {
    reportingMonth,
    status,
    daysSinceMonthEnd: days,
    isStale: days !== null && days > STALE_AFTER_DAYS,
    futureMonths,
  }

  if (status.isPartial) return { ...base, kind: 'partial', targetMonth: reportingMonth }
  if (reportingMonth < addMonths(current, -1))
    return { ...base, kind: 'due', targetMonth: addMonths(reportingMonth, 1) }
  return { ...base, kind: 'up-to-date', targetMonth: null }
}
