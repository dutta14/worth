import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFileStore } from '../../../contexts/FileStoreContext'
import type { CategoryGroup } from '../types'
import { buildMonthKey } from '../utils/csvParser'
import {
  emptyTargetsFile,
  formatTargetAmount,
  monthlyTargetFor,
  pruneTargets,
  setGroupTarget,
} from '../utils/budgetTargets'
import type { BudgetTargetsFile } from '../utils/budgetTargets'
import { TARGETS_PATH, loadBudgetTargets, saveBudgetTargets } from '../utils/budgetTargetsStorage'

export type BudgetTargetsStatus = 'off' | 'loading' | 'ready' | 'unreadable'

export interface UseBudgetTargetsOptions {
  enabled: boolean
  groups: CategoryGroup[]
  groupsLoaded: boolean
}

export interface UseBudgetTargetsResult {
  status: BudgetTargetsStatus
  targets: BudgetTargetsFile
  setTarget: (groupId: string, label: string, value: number | null) => Promise<{ ok: boolean }>
  /** Live-region text for the latest change or failure. */
  message: string
}

export const SAVE_ERROR_MESSAGE = "Couldn't save the target. Check that your data folder is still available."

const OFF_TARGETS = emptyTargetsFile()

// Same local-time convention as SpendingPeek.
export const currentMonthKey = (now: Date = new Date()): string => buildMonthKey(now.getFullYear(), now.getMonth())

// Targets exist for expense groups only; income groups and "Remove from Budget" are never kept.
const isTargetable = (group: CategoryGroup): boolean => group.type !== 'income' && group.id !== 'removed'

interface LoadedState {
  status: Exclude<BudgetTargetsStatus, 'off'>
  targets: BudgetTargetsFile
}

export function useBudgetTargets({ enabled, groups, groupsLoaded }: UseBudgetTargetsOptions): UseBudgetTargetsResult {
  const { fileStore } = useFileStore()
  const [state, setState] = useState<LoadedState>({ status: 'loading', targets: OFF_TARGETS })
  const [message, setMessage] = useState('')
  const stateRef = useRef(state)
  const savingRef = useRef(0)

  const validIds = useMemo(() => new Set(groups.filter(isTargetable).map(g => g.id)), [groups])
  const validIdsRef = useRef(validIds)
  const groupsLoadedRef = useRef(groupsLoaded)
  const enabledRef = useRef(enabled)
  useEffect(() => {
    validIdsRef.current = validIds
    groupsLoadedRef.current = groupsLoaded
    enabledRef.current = enabled
  }, [validIds, groupsLoaded, enabled])

  const commit = useCallback((next: LoadedState) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // A local save announces itself on this path; its own optimistic state is the truth meanwhile.
    const refresh = () => {
      if (savingRef.current > 0) return
      void loadBudgetTargets(fileStore).then(result => {
        if (cancelled || savingRef.current > 0) return
        commit(
          result.state === 'ready'
            ? { status: 'ready', targets: result.targets }
            : { status: 'unreadable', targets: emptyTargetsFile() },
        )
      })
    }
    refresh()
    const unsubscribe = fileStore.subscribe(TARGETS_PATH, refresh)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [enabled, fileStore, commit])

  const setTarget = useCallback(
    async (groupId: string, label: string, value: number | null): Promise<{ ok: boolean }> => {
      const previous = stateRef.current
      if (!enabledRef.current || previous.status !== 'ready') return { ok: false }
      if (groupsLoadedRef.current && !validIdsRef.current.has(groupId)) return { ok: false }

      // Orphans are only dropped here, once groups are known, so reading never writes.
      const base = groupsLoadedRef.current ? pruneTargets(previous.targets, validIdsRef.current) : previous.targets
      const nowMonth = currentMonthKey()

      if (monthlyTargetFor(base.groups[groupId], nowMonth) === value) {
        if (value !== null) setMessage(`${label} target is already ${formatTargetAmount(value)} a month.`)
        return { ok: true }
      }

      const next: LoadedState = { status: 'ready', targets: setGroupTarget(base, groupId, label, value, nowMonth) }
      commit(next)
      savingRef.current += 1
      try {
        const saved = await saveBudgetTargets(fileStore, next.targets)
        if (!saved.ok) {
          commit({ status: 'unreadable', targets: emptyTargetsFile() })
          setMessage(SAVE_ERROR_MESSAGE)
          return { ok: false }
        }
        setMessage(
          value === null ? `${label} target cleared.` : `${label} target set to ${formatTargetAmount(value)} a month.`,
        )
        return { ok: true }
      } catch {
        if (stateRef.current === next) commit(previous)
        setMessage(SAVE_ERROR_MESSAGE)
        return { ok: false }
      } finally {
        savingRef.current -= 1
      }
    },
    [fileStore, commit],
  )

  const targets = useMemo(
    () => (enabled && groupsLoaded ? pruneTargets(state.targets, validIds) : state.targets),
    [enabled, groupsLoaded, state.targets, validIds],
  )

  if (!enabled) return { status: 'off', targets: OFF_TARGETS, setTarget, message: '' }
  return { status: state.status, targets, setTarget, message }
}
