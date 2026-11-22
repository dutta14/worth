import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../../../contexts/DataContext'
import { useFileStore } from '../../../contexts/FileStoreContext'
import { useGoals } from '../../../contexts/GoalsContext'
import { useGrowthSettings } from '../../../hooks/useGrowthSettings'
import type { CategoryGroup, MonthCSV } from '../../budget/types'
import { loadBudgetStore } from '../../budget/utils/budgetStorage'
import { loadSavingsOverrides } from '../../tools/utils/savingsOverrides'
import type { AnnualReview, ManualYearLog } from '../types'
import { getAvailableYears } from '../utils/availableYears'
import { monthKeysOnly, parseReviewMonths } from '../utils/reviewSource'
import { selectAnnualReview } from '../utils/selectAnnualReview'

export type ReviewStatus = 'loading' | 'ready' | 'error'

export interface UseAnnualReviewResult {
  status: ReviewStatus
  /** Null until ready, and when no year is requested. */
  review: AnnualReview | null
  years: number[]
  defaultYear: number
  retry: () => void
}

interface ReviewSource {
  csvs: Record<string, MonthCSV>
  categoryGroups: CategoryGroup[]
  manual: Record<number, ManualYearLog>
}

const FALLBACK_BIRTHDAY = '1990-01'
const RELOAD_EVENTS = ['budget-changed', 'tools-changed', 'data-changed'] as const

/**
 * Wires the pure review selectors to app data. Reads are read-only: balances and goals come from context,
 * transactions and the manual log are loaded here and reloaded when they change. Pass null to get only the
 * year list (used before the route names a year).
 */
export function useAnnualReview(year: number | null): UseAnnualReviewResult {
  const { accounts, balances, isLoaded } = useData()
  const { goals, profile } = useGoals()
  const { settings: growth } = useGrowthSettings()
  const { fileStore } = useFileStore()
  const [today] = useState(() => new Date())
  const [source, setSource] = useState<ReviewSource | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const latestLoad = useRef(0)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      const id = ++latestLoad.current
      Promise.all([loadBudgetStore(fileStore), loadSavingsOverrides(fileStore)])
        .then(([store, manual]) => {
          if (cancelled || id !== latestLoad.current) return
          setSource({ csvs: store.csvs, categoryGroups: store.categoryGroups ?? [], manual })
          setFailed(false)
        })
        .catch((error: unknown) => {
          if (cancelled || id !== latestLoad.current) return
          console.error(error)
          setFailed(true)
        })
    }

    load()
    const unsubscribe = fileStore.subscribe('budget/categories.json', load)
    for (const name of RELOAD_EVENTS) window.addEventListener(name, load)
    return () => {
      cancelled = true
      unsubscribe()
      for (const name of RELOAD_EVENTS) window.removeEventListener(name, load)
    }
  }, [fileStore, attempt])

  const retry = useCallback(() => {
    setFailed(false)
    setAttempt(n => n + 1)
  }, [])

  const status: ReviewStatus = failed ? 'error' : source && isLoaded ? 'ready' : 'loading'

  const { years, defaultYear } = useMemo(
    () =>
      getAvailableYears({
        balances,
        transactionsByMonth: source ? monthKeysOnly(source.csvs) : {},
        manual: source?.manual ?? {},
        today,
      }),
    [balances, source, today],
  )

  const review = useMemo(() => {
    if (status !== 'ready' || !source || year === null) return null
    const { transactionsByMonth, unreadableMonths } = parseReviewMonths(source.csvs, [year - 1, year])
    return selectAnnualReview({
      year,
      today,
      accounts,
      balances,
      transactionsByMonth,
      unreadableMonths,
      categoryGroups: source.categoryGroups,
      manual: source.manual,
      goals,
      profileBirthday: profile.birthday || FALLBACK_BIRTHDAY,
      growth,
    })
  }, [status, source, year, today, accounts, balances, goals, profile.birthday, growth])

  return { status, review, years, defaultYear, retry }
}
