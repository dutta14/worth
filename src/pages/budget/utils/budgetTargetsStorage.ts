import type { FileStore } from '../../../utils/fileStoreTypes'
import { emptyTargetsFile, normalizeTargetsFile } from './budgetTargets'
import type { BudgetTargetsFile } from './budgetTargets'

export const TARGETS_PATH = 'budget/targets.json'

export type TargetsLoadResult = { state: 'ready'; targets: BudgetTargetsFile } | { state: 'unreadable' }

export type TargetsSaveResult = { ok: true } | { ok: false; reason: 'unreadable' }

/**
 * `readJSON` returns its fallback for a corrupt file, so a missing file and an unreadable one
 * are told apart with `exists()`. An unreadable file (corrupt, wrong shape or a newer version)
 * must never be overwritten, so callers get `state: 'unreadable'` and treat the data as read-only.
 */
export async function loadBudgetTargets(fileStore: FileStore): Promise<TargetsLoadResult> {
  try {
    if (!(await fileStore.exists(TARGETS_PATH))) return { state: 'ready', targets: emptyTargetsFile() }
    const targets = normalizeTargetsFile(await fileStore.readJSON<unknown>(TARGETS_PATH, null))
    return targets ? { state: 'ready', targets } : { state: 'unreadable' }
  } catch {
    return { state: 'unreadable' }
  }
}

/** Re-checks the file on disk first, so a stale caller cannot overwrite a file it could not read. */
export async function saveBudgetTargets(fileStore: FileStore, targets: BudgetTargetsFile): Promise<TargetsSaveResult> {
  const current = await loadBudgetTargets(fileStore)
  if (current.state === 'unreadable') return { ok: false, reason: 'unreadable' }
  await fileStore.writeJSON(TARGETS_PATH, targets)
  return { ok: true }
}
