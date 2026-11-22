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
import type { BudgetTargetsFile, GroupTargetRecord } from '../utils/budgetTargets'
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
  /** Changes on every announcement, so an identical consecutive message is still re-announced. */
  messageId: number
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

interface Announcement {
  text: string
  id: number
}

const sameRecord = (a: GroupTargetRecord | undefined, b: GroupTargetRecord | undefined): boolean =>
  JSON.stringify(a?.history) === JSON.stringify(b?.history)

/** Labels of the groups whose target differs between two files. */
function changedLabels(from: BudgetTargetsFile, to: BudgetTargetsFile): string[] {
  const ids = new Set([...Object.keys(from.groups), ...Object.keys(to.groups)])
  return [...ids]
    .filter(id => !sameRecord(from.groups[id], to.groups[id]))
    .map(id => from.groups[id]?.label ?? to.groups[id]?.label ?? id)
}

export function useBudgetTargets({ enabled, groups, groupsLoaded }: UseBudgetTargetsOptions): UseBudgetTargetsResult {
  const { fileStore } = useFileStore()
  const [state, setState] = useState<LoadedState>({ status: 'loading', targets: OFF_TARGETS })
  const [announcement, setAnnouncement] = useState<Announcement>({ text: '', id: 0 })
  const stateRef = useRef(state)
  // Last state known to be on disk. Optimistic edits can stack, so a failed write rolls back to this, not to the call-time state.
  const confirmedRef = useRef(state)
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

  const commitConfirmed = useCallback(
    (next: LoadedState) => {
      confirmedRef.current = next
      commit(next)
    },
    [commit],
  )

  const announce = useCallback((text: string) => setAnnouncement(prev => ({ text, id: prev.id + 1 })), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // A local save announces itself on this path; its own optimistic state is the truth meanwhile.
    const refresh = () => {
      if (savingRef.current > 0) return
      void loadBudgetTargets(fileStore).then(result => {
        if (cancelled || savingRef.current > 0) return
        commitConfirmed(
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
  }, [enabled, fileStore, commitConfirmed])

  const setTarget = useCallback(
    async (groupId: string, label: string, value: number | null): Promise<{ ok: boolean }> => {
      const previous = stateRef.current
      if (!enabledRef.current || previous.status !== 'ready') return { ok: false }
      if (groupsLoadedRef.current && !validIdsRef.current.has(groupId)) return { ok: false }

      // Orphans are only dropped here, once groups are known, so reading never writes.
      const base = groupsLoadedRef.current ? pruneTargets(previous.targets, validIdsRef.current) : previous.targets
      const nowMonth = currentMonthKey()

      if (monthlyTargetFor(base.groups[groupId], nowMonth) === value) {
        if (value !== null) announce(`${label} target is already ${formatTargetAmount(value)} a month.`)
        return { ok: true }
      }

      const next: LoadedState = { status: 'ready', targets: setGroupTarget(base, groupId, label, value, nowMonth) }
      commit(next)
      savingRef.current += 1
      try {
        const saved = await saveBudgetTargets(fileStore, next.targets)
        if (!saved.ok) {
          commitConfirmed({ status: 'unreadable', targets: emptyTargetsFile() })
          announce(SAVE_ERROR_MESSAGE)
          return { ok: false }
        }
        confirmedRef.current = next
        announce(
          value === null ? `${label} target cleared.` : `${label} target set to ${formatTargetAmount(value)} a month.`,
        )
        return { ok: true }
      } catch {
        if (stateRef.current === next) {
          // The newest optimistic state also holds every earlier unsaved edit, so all of them revert together.
          const reverted = changedLabels(confirmedRef.current.targets, next.targets)
          commit(confirmedRef.current)
          announce(reverted.length > 1 ? `${SAVE_ERROR_MESSAGE} Reverted: ${reverted.join(', ')}.` : SAVE_ERROR_MESSAGE)
        } else if (savingRef.current <= 1 && stateRef.current !== confirmedRef.current) {
          announce(SAVE_ERROR_MESSAGE)
        }
        return { ok: false }
      } finally {
        savingRef.current -= 1
      }
    },
    [fileStore, commit, commitConfirmed, announce],
  )

  const targets = useMemo(
    () => (enabled && groupsLoaded ? pruneTargets(state.targets, validIds) : state.targets),
    [enabled, groupsLoaded, state.targets, validIds],
  )

  if (!enabled) return { status: 'off', targets: OFF_TARGETS, setTarget, message: '', messageId: 0 }
  return { status: state.status, targets, setTarget, message: announcement.text, messageId: announcement.id }
}
