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
 * month with data. An unreadable file or any failure yields no line.
 */
export function useSpendingTargetsLine(fileStore: FileStore, store: BudgetStore | null): SpendingTargetsLine | null {
  const [targets, setTargets] = useState<BudgetTargetsFile | null>(null)

  useEffect(() => {
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
  }, [fileStore])

  return useMemo(() => {
    if (!targets || !store) return null
    const [anchorMonth] = Object.keys(store.csvs ?? {}).sort((a, b) => b.localeCompare(a))
    if (!anchorMonth) return null
    const year = anchorMonth.slice(0, 4)
    const transactionsByMonth = Object.fromEntries(
      Object.entries(store.csvs)
        .filter(([month]) => month.startsWith(`${year}-`))
        .map(([month, { csv }]) => [month, parseCSV(csv)]),
    )
    return buildSpendingTargetsLine({
      groups: store.categoryGroups ?? [],
      targets,
      anchorMonth,
      transactionsByMonth,
      nowMonth: currentMonthKey(),
    })
  }, [targets, store])
}
