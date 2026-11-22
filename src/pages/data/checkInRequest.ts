import { currentMonthKey, getMonthStatus, isMonthKey, type MonthKey } from './monthStatus'
import type { Account, BalanceEntry } from './types'

/** Router state sent by the Home check-in strip: `{ checkIn: { month } }`. */
export const hasCheckInRequest = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'checkIn' in state

const readRequestedMonth = (state: unknown): string | null => {
  if (typeof state !== 'object' || state === null || !('checkIn' in state)) return null
  const request = state.checkIn
  if (typeof request !== 'object' || request === null || !('month' in request)) return null
  return typeof request.month === 'string' ? request.month : null
}

/**
 * Router state is untrusted, so the month is accepted only when a check-in for it makes sense:
 * a valid key that is not in the future, and either a new month or an existing month that is still partial.
 */
export function getCheckInRequestMonth(
  state: unknown,
  accounts: Account[],
  balances: BalanceEntry[],
  now: Date,
): MonthKey | null {
  const month = readRequestedMonth(state)
  if (month === null || !isMonthKey(month)) return null
  const current = currentMonthKey(now)
  if (month > current) return null
  if (!accounts.some(account => account.status === 'active')) return null

  const validMonths = new Set(balances.map(entry => entry.month).filter(isMonthKey))
  if (validMonths.size === 0) return null
  if (!validMonths.has(month)) return month

  const reportingMonth = [...validMonths].reduce((latest, m) => (m <= current && m > latest ? m : latest), month)
  return getMonthStatus(accounts, balances, month, reportingMonth).isPartial ? month : null
}
