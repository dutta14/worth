import type { FinancialGoal } from '../../../types'
import type { GrowthSettings } from '../../../hooks/useGrowthSettings'
import { getFiTarget } from '../../goal/utils/goalCalculations'
import type { Account, BalanceEntry } from '../../data/types'
import type { GoalSnapshot, NetWorthAnchor } from '../types'
import { roundCents } from './math'

/** Sum of FI account balances in a month, active or not, so a past snapshot does not depend on today's status. */
function fiBalanceAt(month: string, accounts: Account[], balances: BalanceEntry[]): number {
  const fiIds = new Set(accounts.filter(a => a.goalType === 'fi').map(a => a.id))
  const byAccount = new Map<number, number>()
  for (const b of balances) if (b.month === month && fiIds.has(b.accountId)) byAccount.set(b.accountId, b.balance)
  let total = 0
  for (const balance of byAccount.values()) total += balance
  return roundCents(total)
}

/** A goal whose creation month cannot be parsed counts as existing. */
const existedBy = (goal: FinancialGoal, year: number): boolean => {
  const createdYear = parseInt((goal.goalCreatedIn ?? '').split('-')[0], 10)
  return Number.isNaN(createdYear) || createdYear <= year
}

const usable = (a: NetWorthAnchor): a is NetWorthAnchor & { month: string } =>
  a.month !== null && (a.status === 'exact' || a.status === 'nearest')

/** FI goal progress at the two anchors, measured against each goal's target as it is set today. */
export function snapshotGoals(
  year: number,
  goals: FinancialGoal[],
  profileBirthday: string,
  growth: GrowthSettings,
  accounts: Account[],
  balances: BalanceEntry[],
  start: NetWorthAnchor,
  end: NetWorthAnchor,
): GoalSnapshot[] {
  const startBalance = usable(start) ? fiBalanceAt(start.month, accounts, balances) : null
  const endBalance = usable(end) ? fiBalanceAt(end.month, accounts, balances) : null

  const snapshots: GoalSnapshot[] = []
  for (const goal of goals) {
    if (!existedBy(goal, year)) continue
    const target = getFiTarget(
      goal,
      profileBirthday,
      growth.preBoundaryGrowth,
      growth.postBoundaryGrowth,
      growth.ageBoundary,
      growth.inflation,
    )
    if (!(target > 0)) continue
    const pctOf = (balance: number | null) =>
      balance === null ? null : Math.min(100, Math.max(0, (balance / target) * 100))
    snapshots.push({
      goalId: goal.id,
      name: goal.goalName,
      target,
      startBalance,
      endBalance,
      startPct: pctOf(startBalance),
      endPct: pctOf(endBalance),
    })
  }
  return snapshots
}
