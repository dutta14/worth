import type { FinancialGoal, GwGoal } from '../../../types'
import type { GrowthSettings } from '../../../hooks/useGrowthSettings'
import { getFiTarget } from '../../goal/utils/goalCalculations'
import { getGwTarget } from '../../goal/utils/goalMath'
import type { Account, BalanceEntry } from '../../data/types'
import type { GoalSnapshot, NetWorthAnchor } from '../types'
import { roundCents } from './math'

/** Sum of a goal type's balances in a month, active or not, so a past snapshot does not depend on today's status. */
function goalBalanceAt(month: string, accounts: Account[], balances: BalanceEntry[], goalType: 'fi' | 'gw'): number {
  const ids = new Set(accounts.filter(a => a.goalType === goalType).map(a => a.id))
  const byAccount = new Map<number, number>()
  for (const b of balances) if (b.month === month && ids.has(b.accountId)) byAccount.set(b.accountId, b.balance)
  let total = 0
  for (const balance of byAccount.values()) total += balance
  return roundCents(total)
}

const createdYearOf = (goal: FinancialGoal): number => parseInt((goal.goalCreatedIn ?? '').split('-')[0], 10)

/** A goal whose creation month cannot be parsed counts as existing. */
const existedBy = (goal: FinancialGoal, year: number): boolean => {
  const createdYear = createdYearOf(goal)
  return Number.isNaN(createdYear) || createdYear <= year
}

/**
 * getFiTarget returns 0 for a garbage creation month and reads the real clock for an empty one.
 * An unparseable or empty creation month is therefore replaced with the review year, so the goal stays
 * listed and the result depends only on the injected year. The input goal is never mutated.
 */
const withDeterministicCreation = (goal: FinancialGoal, year: number): FinancialGoal =>
  createdYearOf(goal) > 0 ? goal : { ...goal, goalCreatedIn: String(year) }

const usable = (a: NetWorthAnchor): a is NetWorthAnchor & { month: string } =>
  a.month !== null && (a.status === 'exact' || a.status === 'nearest')

/**
 * FI goal progress at the two anchors, measured against each goal's target as it is set today.
 * `skipped` counts goals that existed by year end but have no positive target, so the page can say so.
 */
export function snapshotGoals(
  year: number,
  goals: FinancialGoal[],
  profileBirthday: string,
  growth: GrowthSettings,
  accounts: Account[],
  balances: BalanceEntry[],
  start: NetWorthAnchor,
  end: NetWorthAnchor,
  gwGoals: GwGoal[] = [],
): { goals: GoalSnapshot[]; skipped: number } {
  const startBalance = usable(start) ? goalBalanceAt(start.month, accounts, balances, 'fi') : null
  const endBalance = usable(end) ? goalBalanceAt(end.month, accounts, balances, 'fi') : null
  const startGwBalance = usable(start) ? goalBalanceAt(start.month, accounts, balances, 'gw') : null
  const endGwBalance = usable(end) ? goalBalanceAt(end.month, accounts, balances, 'gw') : null

  const snapshots: GoalSnapshot[] = []
  let skipped = 0
  for (const goal of goals) {
    if (!existedBy(goal, year)) continue
    const target = getFiTarget(
      withDeterministicCreation(goal, year),
      profileBirthday,
      growth.preBoundaryGrowth,
      growth.postBoundaryGrowth,
      growth.ageBoundary,
      growth.inflation,
    )
    if (!(target > 0)) {
      skipped += 1
      continue
    }
    const gwTotal = getGwTarget(withDeterministicCreation(goal, year), gwGoals, profileBirthday, growth.inflation)
    const gwTarget = Number.isFinite(gwTotal) && gwTotal > 0 ? gwTotal : null
    const pctOf = (balance: number | null, of: number | null = target) =>
      balance === null || of === null ? null : Math.min(100, Math.max(0, (balance / of) * 100))
    snapshots.push({
      goalId: goal.id,
      name: goal.goalName,
      target,
      startBalance,
      endBalance,
      endGwBalance,
      gwTarget,
      startPct: pctOf(startBalance),
      endPct: pctOf(endBalance),
      startGwPct: pctOf(startGwBalance, gwTarget),
      endGwPct: pctOf(endGwBalance, gwTarget),
    })
  }
  return { goals: snapshots, skipped }
}
