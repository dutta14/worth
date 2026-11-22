import type { FileStore } from '../../../utils/fileStoreTypes'

export const OVERRIDES_PATH = 'savings-tracker-overrides.json'

/** The manual yearly log kept by the Growth tab. */
export interface ManualYearLog {
  grossIncome?: number
  taxes?: number
  netIncome?: number
  savings?: number
}

const FIELDS: (keyof ManualYearLog)[] = ['grossIncome', 'taxes', 'netIncome', 'savings']

/** Reads the manual yearly log, keeping only finite numbers under numeric year keys. Read errors propagate. */
export async function loadSavingsOverrides(fileStore: FileStore): Promise<Record<number, ManualYearLog>> {
  const raw = await fileStore.readJSON<unknown>(OVERRIDES_PATH, {})
  const result: Record<number, ManualYearLog> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result

  for (const [key, value] of Object.entries(raw)) {
    const year = Number(key)
    if (!Number.isInteger(year) || typeof value !== 'object' || value === null) continue
    const log: ManualYearLog = {}
    for (const field of FIELDS) {
      const n = (value as Record<string, unknown>)[field]
      if (typeof n === 'number' && Number.isFinite(n)) log[field] = n
    }
    if (Object.keys(log).length > 0) result[year] = log
  }
  return result
}
