import type { ReviewInputs } from '../types'

const hasManualData = (log: object | undefined): boolean =>
  log !== undefined && Object.values(log).some(v => typeof v === 'number' && Number.isFinite(v))

const yearOf = (key: string): number => parseInt(key.slice(0, 4), 10)

/**
 * Years that have any balance, transaction month or manual log, plus the current year, newest first.
 * The default is the latest year whose December has balances, else the latest year with data, else the current year.
 */
export function getAvailableYears(i: Pick<ReviewInputs, 'balances' | 'transactionsByMonth' | 'manual' | 'today'>): {
  years: number[]
  defaultYear: number
} {
  const currentYear = i.today.getFullYear()
  const dataYears = new Set<number>()
  const decemberYears = new Set<number>()

  for (const b of i.balances) {
    const y = yearOf(b.month)
    if (Number.isNaN(y)) continue
    dataYears.add(y)
    if (b.month.endsWith('-12')) decemberYears.add(y)
  }
  for (const key of Object.keys(i.transactionsByMonth)) {
    const y = yearOf(key)
    if (!Number.isNaN(y)) dataYears.add(y)
  }
  for (const [key, log] of Object.entries(i.manual)) {
    const y = Number(key)
    if (Number.isInteger(y) && hasManualData(log)) dataYears.add(y)
  }

  const latest = (years: Set<number>) => Math.max(...years)
  let defaultYear = currentYear
  if (decemberYears.size > 0) defaultYear = latest(decemberYears)
  else if (dataYears.size > 0) defaultYear = latest(dataYears)

  return { years: [...new Set([...dataYears, currentYear])].sort((a, b) => b - a), defaultYear }
}
