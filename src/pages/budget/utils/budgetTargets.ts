/**
 * Pure calculation core for category budget targets (docs/specs/category-budget-targets.md).
 * No React, no I/O. "Now" is always injected as a month key so results are deterministic.
 */

export type MonthKey = string // 'YYYY-MM'

export interface TargetEntry {
  from: MonthKey | null
  monthly: number | null
}

export interface GroupTargetRecord {
  label?: string
  history: TargetEntry[]
}

export interface BudgetTargetsFile {
  version: 1
  groups: Record<string, GroupTargetRecord>
}

export type TargetStatus = 'over' | 'under' | 'on-target'

export interface TargetResult {
  status: TargetStatus
  inProgress: boolean
  /** Absolute difference in whole dollars, the number shown to the user. */
  deltaDollars: number
  targetDollars: number
  spendDollars: number
  monthsCounted: number
  monthsInPeriod: number
}

export type ParsedTarget =
  | { ok: true; value: number | null } // null = clear
  | { ok: false; reason: 'invalid' | 'negative' | 'too-large' }

export const TARGETS_FILE_VERSION = 1
export const MAX_TARGET = 9_999_999.99

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/
const AMOUNT_INPUT = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/

const dollarFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export const formatTargetAmount = (dollars: number): string => dollarFormat.format(dollars)

const toCents = (dollars: number): number => Math.round(dollars * 100) || 0

// Whole dollars from integer cents, half away from zero. Never returns -0.
const centsToDollars = (cents: number): number => {
  const abs = Math.floor((Math.abs(cents) + 50) / 100)
  return cents < 0 && abs > 0 ? -abs : abs
}

export function emptyTargetsFile(): BudgetTargetsFile {
  return { version: TARGETS_FILE_VERSION, groups: {} }
}

export function parseTargetInput(raw: string): ParsedTarget {
  const text = raw.trim()
  if (text === '') return { ok: true, value: null }

  if (text.startsWith('-')) {
    return AMOUNT_INPUT.test(text.slice(1)) ? { ok: false, reason: 'negative' } : { ok: false, reason: 'invalid' }
  }

  const match = AMOUNT_INPUT.exec(text)
  if (!match) return { ok: false, reason: 'invalid' }

  const value = Number(match[1].replace(/,/g, '') + (match[2] ?? ''))
  if (value > MAX_TARGET) return { ok: false, reason: 'too-large' }
  return { ok: true, value }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Entries are unique per `from`, so two keys are never equal.
const compareFrom = (a: TargetEntry, b: TargetEntry): number => {
  if (a.from === null) return -1
  if (b.from === null) return 1
  return a.from < b.from ? -1 : 1
}

const normalizeEntry = (raw: unknown): TargetEntry | null => {
  if (!isRecord(raw)) return null
  const { from, monthly } = raw
  if (from !== null && !(typeof from === 'string' && MONTH_KEY.test(from))) return null
  if (monthly === null) return { from, monthly: null }
  if (typeof monthly !== 'number' || !Number.isFinite(monthly) || monthly < 0 || monthly > MAX_TARGET) return null
  return { from, monthly: toCents(monthly) / 100 }
}

const normalizeRecord = (raw: unknown): GroupTargetRecord | null => {
  if (!isRecord(raw) || !Array.isArray(raw.history)) return null
  const byFrom = new Map<MonthKey | null, TargetEntry>()
  for (const item of raw.history) {
    const entry = normalizeEntry(item)
    if (entry) byFrom.set(entry.from, entry) // duplicate `from`: last wins
  }
  if (byFrom.size === 0) return null
  const history = [...byFrom.values()].sort(compareFrom)
  return typeof raw.label === 'string' ? { label: raw.label, history } : { history }
}

/**
 * Validates a parsed targets file. Returns null when the file must be treated as unreadable
 * (not an object, no `groups` object, or a version this build does not know). Individual bad
 * entries and groups are dropped rather than failing the whole file.
 */
export function normalizeTargetsFile(raw: unknown): BudgetTargetsFile | null {
  if (!isRecord(raw)) return null
  if (raw.version !== undefined && raw.version !== TARGETS_FILE_VERSION) return null
  if (!isRecord(raw.groups)) return null

  const groups: [string, GroupTargetRecord][] = []
  for (const [id, rawRecord] of Object.entries(raw.groups)) {
    const record = normalizeRecord(rawRecord)
    if (record) groups.push([id, record])
  }
  return { version: TARGETS_FILE_VERSION, groups: Object.fromEntries(groups) }
}

export function monthlyTargetFor(rec: GroupTargetRecord | undefined, month: MonthKey): number | null {
  if (!rec) return null
  let monthly: number | null = null
  for (const entry of rec.history) {
    if (entry.from !== null && entry.from > month) break
    monthly = entry.monthly
  }
  return monthly
}

const dropRepeatedValues = (history: TargetEntry[]): TargetEntry[] =>
  history.filter((entry, i) => i === 0 || entry.monthly !== history[i - 1].monthly)

/**
 * Returns a new file with `value` (null = clear) in effect from `nowMonth` on. Entries before
 * `nowMonth` are kept as they are; the input is never mutated.
 */
export function setGroupTarget(
  file: BudgetTargetsFile,
  groupId: string,
  label: string,
  value: number | null,
  nowMonth: MonthKey,
): BudgetTargetsFile {
  const existing = Object.hasOwn(file.groups, groupId) ? file.groups[groupId] : undefined
  const { [groupId]: _previous, ...others } = file.groups
  const withRecord = (record: GroupTargetRecord): BudgetTargetsFile => ({
    ...file,
    groups: { ...others, [groupId]: record },
  })

  if (!existing || existing.history.length === 0) {
    if (value === null) return { ...file, groups: others }
    return withRecord({ label, history: [{ from: null, monthly: value }] })
  }

  const onlyAlways = existing.history.length === 1 && existing.history[0].from === null
  if (value === null && onlyAlways) return { ...file, groups: others }

  const earlier = existing.history.filter(entry => entry.from === null || entry.from < nowMonth)
  const history = dropRepeatedValues([...earlier, { from: nowMonth, monthly: value }])
  if (history.every(entry => entry.monthly === null)) return { ...file, groups: others }
  return withRecord({ label, history })
}

export function pruneTargets(file: BudgetTargetsFile, validGroupIds: ReadonlySet<string>): BudgetTargetsFile {
  const kept = Object.entries(file.groups).filter(([id]) => validGroupIds.has(id))
  if (kept.length === Object.keys(file.groups).length) return file
  return { ...file, groups: Object.fromEntries(kept) }
}

/**
 * Compares a group's net spend with its target over `monthKeys` (12 for a year, 3 for a quarter,
 * 1 for a month). Only months that have data and an effective target count, on both sides.
 * Returns null when no month counts.
 */
export function evaluatePeriod(args: {
  record: GroupTargetRecord | undefined
  monthKeys: readonly MonthKey[]
  monthsWithData: ReadonlySet<MonthKey>
  signedNetFor: (month: MonthKey) => number
  nowMonth: MonthKey
}): TargetResult | null {
  const { record, monthKeys, monthsWithData, signedNetFor, nowMonth } = args

  let targetCents = 0
  let spendCents = 0
  let monthsCounted = 0
  let inProgress = false

  for (const month of monthKeys) {
    if (!monthsWithData.has(month)) continue
    const monthly = monthlyTargetFor(record, month)
    if (monthly === null) continue
    targetCents += toCents(monthly)
    spendCents += -toCents(signedNetFor(month)) || 0
    monthsCounted += 1
    if (month === nowMonth) inProgress = true
  }

  if (monthsCounted === 0) return null

  const targetDollars = centsToDollars(targetCents)
  const spendDollars = centsToDollars(spendCents)
  const delta = spendDollars - targetDollars
  const status: TargetStatus = delta > 0 ? 'over' : delta < 0 ? 'under' : 'on-target'

  return {
    status,
    inProgress,
    deltaDollars: Math.abs(delta),
    targetDollars,
    spendDollars,
    monthsCounted,
    monthsInPeriod: monthKeys.length,
  }
}

export function formatTargetStatus(r: TargetResult): { text: string; icon: 'up' | 'down' | 'check' } {
  const amount = formatTargetAmount(r.deltaDollars)
  switch (r.status) {
    case 'over':
      return { text: `${amount} over`, icon: 'up' }
    case 'under':
      return { text: `${amount} ${r.inProgress ? 'left' : 'under'}`, icon: 'down' }
    case 'on-target':
      return { text: 'On target', icon: 'check' }
  }
}

export function summarizeGroups(results: ReadonlyArray<TargetResult | null>): { evaluated: number; over: number } {
  let evaluated = 0
  let over = 0
  for (const result of results) {
    if (!result) continue
    evaluated += 1
    if (result.status === 'over') over += 1
  }
  return { evaluated, over }
}

/**
 * A category counts as spending when any month of the year is negative; categories that are positive all
 * year (reimbursements, cashback, misfiled income) are ignored. Shared by the Budget table and the Home
 * line so both compare the same spend with a target.
 */
export const isExpenseCategory = (monthlySums: Readonly<Record<MonthKey, number>> | undefined): boolean =>
  Object.values(monthlySums ?? {}).some(value => value < 0)

/** Signed per-category totals (expenses negative), summed in integer cents. */
export function sumByCategory(
  txs: ReadonlyArray<{ category: string; amount: number }>,
  excluded: ReadonlySet<string>,
): Record<string, number> {
  const cents = new Map<string, number>()
  for (const tx of txs) {
    if (excluded.has(tx.category) || !Number.isFinite(tx.amount)) continue
    cents.set(tx.category, (cents.get(tx.category) ?? 0) + toCents(tx.amount))
  }
  return Object.fromEntries([...cents].map(([category, total]) => [category, total / 100]))
}
