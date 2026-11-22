import type { MonthCSV, Transaction } from '../../budget/types'
import { parseCSV } from '../../budget/utils/csvParser'

export interface ParsedMonths {
  transactionsByMonth: Record<string, Transaction[]>
  unreadableMonths: string[]
}

/** Parses the CSV months of the given years only; a file that cannot be parsed is listed, not thrown. */
export function parseReviewMonths(csvs: Record<string, MonthCSV>, years: number[]): ParsedMonths {
  const transactionsByMonth: Record<string, Transaction[]> = {}
  const unreadableMonths: string[] = []
  for (const key of Object.keys(csvs).sort()) {
    if (!years.includes(parseInt(key.slice(0, 4), 10))) continue
    try {
      transactionsByMonth[key] = parseCSV(csvs[key].csv)
    } catch {
      unreadableMonths.push(key)
    }
  }
  return { transactionsByMonth, unreadableMonths }
}

/** Month keys with no rows, enough for the year list without parsing every file. */
export function monthKeysOnly(csvs: Record<string, MonthCSV>): Record<string, Transaction[]> {
  return Object.fromEntries(Object.keys(csvs).map(key => [key, []]))
}
