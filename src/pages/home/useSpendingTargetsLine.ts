import { useEffect, useMemo, useState } from 'react'
import type { FileStore } from '../../utils/fileStoreTypes'
import type { BudgetStore } from '../budget/types'
import { parseCSV } from '../budget/utils/csvParser'
import type { BudgetTargetsFile } from '../budget/utils/budgetTargets'
import { loadBudgetTargets } from '../budget/utils/budgetTargetsStorage'
import { buildSpendingTargetsLine, currentMonthKey } from './spendingTargetsLine'
import type { SpendingTargetsLine } from './spendingTargetsLine'

/**
 * Loads budget/targets.json once (Home has no subscription either) and derives the line for the newest
 * month with data. With `enabled` false nothing is read. An unreadable file or any failure yields no line.
 */
export function useSpendingTargetsLine(
  fileStore: FileStore,
  enabled: boolean,
  store: BudgetStore | null,
): SpendingTargetsLine | null {
  const [targets, setTargets] = useState<BudgetTargetsFile | null>(null)

  useEffect(() => {
    if (!enabled) {
      setTargets(null)
      return
    }
    let active = true
    loadBudgetTargets(fileStore)
      .then(result => {
        if (active) setTargets(result.state === 'ready' ? result.targets : null)
      })
      .catch(() => {
        if (active) setTargets(null)
      })
    return () => {
      active = false
    }
  }, [enabled, fileStore])

  return useMemo(() => {
    if (!enabled || !targets || !store) return null
    const [anchorMonth] = Object.keys(store.csvs ?? {}).sort((a, b) => b.localeCompare(a))
    if (!anchorMonth) return null
    return buildSpendingTargetsLine({
      groups: store.categoryGroups ?? [],
      targets,
      anchorMonth,
      transactions: parseCSV(store.csvs[anchorMonth].csv),
      nowMonth: currentMonthKey(),
    })
  }, [enabled, targets, store])
}
