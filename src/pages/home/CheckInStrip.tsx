import { FC, useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNow } from '../../hooks/useNow'
import ErrorBoundary from '../../components/ErrorBoundary'
import CheckInCard from './CheckInCard'
import { getCheckInState, toDayKey, type MonthKey } from '../data/monthStatus'
import { isSnoozed, loadSnooze, saveSnooze, snoozeFor, SNOOZE_DAYS } from './checkInSnooze'
import type { Account, BalanceEntry } from '../data/types'

interface CheckInStripProps {
  accounts: Account[]
  balances: BalanceEntry[]
  dataLoaded: boolean
  onSnoozed: (message: string) => void
}

const dayKeyToDate = (dayKey: string): Date => {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Owns the clock, state and snooze for the check-in strip, so focus and visibility re-renders never reach
 * the rest of Home.
 */
const CheckInStrip: FC<CheckInStripProps> = ({ accounts, balances, dataLoaded, onSnoozed }) => {
  const navigate = useNavigate()
  const now = useNow()
  const todayKey = toDayKey(now)
  const today = useMemo(() => dayKeyToDate(todayKey), [todayKey])
  const checkIn = useMemo(() => getCheckInState(accounts, balances, today), [accounts, balances, today])
  const [snooze, setSnooze] = useState(loadSnooze)

  const handleStart = useCallback(
    (month: MonthKey) => navigate('/net-worth/dashboard/details', { state: { checkIn: { month } } }),
    [navigate],
  )

  const handleSnooze = useCallback(() => {
    if (!checkIn.reportingMonth) return
    const next = snoozeFor(checkIn.reportingMonth, today)
    try {
      saveSnooze(next)
    } catch (error) {
      // Storage can be full or disabled; the snooze then lasts for this session only.
      console.warn('[check-in] Could not persist snooze', error)
    }
    setSnooze(next)
    onSnoozed(`Check-in snoozed for ${SNOOZE_DAYS} days.`)
  }, [checkIn, today, onSnoozed])

  const snoozed =
    (checkIn.kind === 'partial' || checkIn.kind === 'due') && isSnoozed(snooze, checkIn.reportingMonth, todayKey)
  if (!dataLoaded || checkIn.kind === 'hidden' || snoozed) return null

  return (
    <ErrorBoundary variant="card">
      <CheckInCard
        state={checkIn}
        today={today}
        onStart={handleStart}
        onNavigate={path => navigate(path)}
        onSnooze={handleSnooze}
      />
    </ErrorBoundary>
  )
}

export default CheckInStrip
