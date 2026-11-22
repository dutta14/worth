import type { FinancialGoal } from '../../types'
import type { GrowthSettings } from '../../hooks/useGrowthSettings'
import type { CategoryGroup, Transaction } from '../budget/types'
import type { Account, BalanceEntry } from '../data/types'
import type { ManualYearLog } from '../tools/utils/savingsOverrides'

export type { ManualYearLog }

export type AnchorStatus = 'exact' | 'nearest' | 'incomplete' | 'missing'
export interface AccountRef {
  id: number
  name: string
}

export interface NetWorthAnchor {
  /** YYYY-MM actually used */
  month: string | null
  /** null when status is 'missing' */
  total: number | null
  status: AnchorStatus
  /** Only for 'incomplete' */
  missing: AccountRef[]
}
/** One entry of the 12-month series, Jan to Dec */
export interface MonthPoint {
  month: string
  total: number | null
  complete: boolean
}

export interface NetWorthReview {
  start: NetWorthAnchor
  end: NetWorthAnchor
  /** null unless both anchors are exact or nearest and their months differ */
  change: number | null
  /** null when start.total is 0 or change is null */
  changePct: number | null
  startNegative: boolean
  series: MonthPoint[]
}

export type CashflowSource = 'budget' | 'manual' | 'budget-partial' | 'none'
export interface CashflowReview {
  source: CashflowSource
  income: number | null
  expenses: number | null
  savings: number | null
  /** Percent, e.g. 35 for 35% */
  savingsRate: number | null
  /** YYYY-MM with a readable CSV */
  monthsCovered: string[]
  /** Expected but missing (or unreadable) */
  gapMonths: string[]
  unreadableMonths: string[]
  mismatch: {
    manualIncome: number | null
    manualSavings: number | null
    budgetIncome: number
    budgetSavings: number
  } | null
}

export interface GroupSpend {
  id: string
  name: string
  amount: number
  /** Percent of positive spend */
  share: number
}
export interface SpendingReview {
  /** Up to 5 */
  top: GroupSpend[]
  other: { count: number; amount: number; share: number } | null
  /** Sum of groups with net negative spend (a credit), as a positive number */
  refundOnlyTotal: number
  uncategorizedShare: number | null
}

export interface GoalSnapshot {
  goalId: number
  name: string
  target: number
  startBalance: number | null
  endBalance: number | null
  startPct: number | null
  endPct: number | null
}

export type ReviewNote =
  | { code: 'anchor-incomplete'; which: 'start' | 'end'; month: string; accounts: AccountRef[] }
  | { code: 'anchor-nearest'; which: 'start' | 'end'; month: string }
  | { code: 'in-progress'; throughMonth: string }
  | { code: 'single-month' }
  | { code: 'negative-start' }
  | { code: 'budget-partial'; gapMonths: string[]; covered: number; expected: number }
  | { code: 'unreadable'; months: string[] }
  | { code: 'source-manual' }
  | { code: 'mismatch' }
  | { code: 'income-zero' }
  | { code: 'refund-groups'; amount: number }
  | { code: 'uncategorized'; share: number }

export interface PriorYearSummary {
  netWorthChange: number | null
  income: number | null
  expenses: number | null
  savingsRate: number | null
}

export interface AnnualReview {
  year: number
  status: 'complete' | 'in-progress' | 'empty'
  netWorth: NetWorthReview
  cashflow: CashflowReview
  /** null when there are no readable transactions or the cashflow source is manual */
  spending: SpendingReview | null
  goals: GoalSnapshot[]
  /** Ordered; UI and CSV render the same list */
  notes: ReviewNote[]
  /** Same selector for year - 1, one level deep; null when that year is empty */
  prior: PriorYearSummary | null
}

export interface ReviewInputs {
  year: number
  /** Injected; only year and month are read */
  today: Date
  accounts: Account[]
  balances: BalanceEntry[]
  /** Keyed by YYYY-MM, built by the hook from the budget store via parseCSV */
  transactionsByMonth: Record<string, Transaction[]>
  unreadableMonths: string[]
  /** Full list from the budget store */
  categoryGroups: CategoryGroup[]
  manual: Record<number, ManualYearLog>
  goals: FinancialGoal[]
  profileBirthday: string
  growth: GrowthSettings
}
