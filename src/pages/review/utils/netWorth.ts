import type { Account, BalanceEntry } from '../../data/types'
import type { AccountRef, MonthPoint, NetWorthAnchor, NetWorthReview } from '../types'
import { roundCents } from './math'

export interface MonthTotal {
  total: number
  missing: AccountRef[]
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`

export const monthsOfYear = (year: number): string[] => Array.from({ length: 12 }, (_, i) => monthKey(year, i + 1))

/**
 * Total and missing accounts for every month that has at least one balance for a known account.
 * Balances for unknown account ids (orphans) are ignored. Inactive accounts are included in totals.
 * An account is expected in month M when firstMonth <= M <= lastMonth, where lastMonth is the latest month
 * of all balances for an active account and the account's own last entry for an inactive one.
 */
export function buildMonthTotals(accounts: Account[], balances: BalanceEntry[]): Map<string, MonthTotal> {
  const known = new Set(accounts.map(a => a.id))
  const byMonth = new Map<string, Map<number, number>>()
  for (const b of balances) {
    if (!known.has(b.accountId) || !MONTH_RE.test(b.month)) continue
    let entries = byMonth.get(b.month)
    if (!entries) byMonth.set(b.month, (entries = new Map()))
    entries.set(b.accountId, b.balance)
  }

  const months = [...byMonth.keys()].sort()
  const latest = months[months.length - 1]
  const span = new Map<number, { first: string; last: string }>()
  for (const month of months) {
    for (const id of byMonth.get(month)!.keys()) {
      const s = span.get(id)
      if (s) s.last = month
      else span.set(id, { first: month, last: month })
    }
  }

  const result = new Map<string, MonthTotal>()
  for (const month of months) {
    const entries = byMonth.get(month)!
    let total = 0
    for (const balance of entries.values()) total += balance

    const missing: AccountRef[] = []
    for (const a of accounts) {
      const s = span.get(a.id)
      if (!s || entries.has(a.id)) continue
      const lastExpected = a.status === 'active' ? latest : s.last
      if (s.first <= month && month <= lastExpected) missing.push({ id: a.id, name: a.name })
    }
    result.set(month, { total: roundCents(total), missing })
  }
  return result
}

const missingAnchor = (): NetWorthAnchor => ({ month: null, total: null, status: 'missing', missing: [] })

function anchorAt(month: string, totals: Map<string, MonthTotal>, whenComplete: 'exact' | 'nearest'): NetWorthAnchor {
  const { total, missing } = totals.get(month)!
  return missing.length > 0
    ? { month, total, status: 'incomplete', missing }
    : { month, total, status: whenComplete, missing: [] }
}

export function resolveAnchors(
  year: number,
  totals: Map<string, MonthTotal>,
): { start: NetWorthAnchor; end: NetWorthAnchor } {
  const monthsIn = (y: number) => [...totals.keys()].filter(m => m.startsWith(`${y}-`)).sort()
  const thisYear = monthsIn(year)
  const prevYear = monthsIn(year - 1)
  const startTarget = monthKey(year - 1, 12)
  const endTarget = monthKey(year, 12)

  let end = missingAnchor()
  if (totals.has(endTarget)) end = anchorAt(endTarget, totals, 'exact')
  else if (thisYear.length > 0) end = anchorAt(thisYear[thisYear.length - 1], totals, 'nearest')

  let start = missingAnchor()
  if (totals.has(startTarget)) start = anchorAt(startTarget, totals, 'exact')
  else if (prevYear.length > 0) start = anchorAt(prevYear[prevYear.length - 1], totals, 'nearest')
  else if (thisYear.length > 0) start = anchorAt(thisYear[0], totals, 'nearest')

  return { start, end }
}

export function buildSeries(year: number, totals: Map<string, MonthTotal>): MonthPoint[] {
  return monthsOfYear(year).map(month => {
    const t = totals.get(month)
    return t ? { month, total: t.total, complete: t.missing.length === 0 } : { month, total: null, complete: false }
  })
}

const isUsable = (a: NetWorthAnchor): boolean => a.status === 'exact' || a.status === 'nearest'

export function buildNetWorthReview(year: number, totals: Map<string, MonthTotal>): NetWorthReview {
  const { start, end } = resolveAnchors(year, totals)
  const comparable = isUsable(start) && isUsable(end) && start.month !== end.month
  const change = comparable ? roundCents(end.total! - start.total!) : null
  const changePct = change !== null && start.total !== 0 ? (change / Math.abs(start.total!)) * 100 : null
  return {
    start,
    end,
    change,
    changePct,
    startNegative: start.total !== null && start.total < 0,
    series: buildSeries(year, totals),
  }
}

export function emptyNetWorthReview(year: number): NetWorthReview {
  return buildNetWorthReview(year, new Map())
}
