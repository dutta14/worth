import type { FileStore } from '../../../utils/fileStoreTypes'
import {
  applyFormatUpdates,
  emptyFormatsFile,
  parseFormatsFile,
  type FormatsFile,
  type FormatUpdate,
} from './savedFormats'
import {
  emptyRulesFile,
  parseRulesFile,
  retargetRules,
  RULES_SCHEMA_VERSION,
  type CategoryRule,
  type RulesFile,
} from './rules'

/**
 * Called once before the first write of an import so a backup can be taken. The default does nothing; the
 * data safety net can supply one. A snapshot that throws never blocks the import.
 */
export type PreImportSnapshot = (reason: 'import') => Promise<void>

export const noopPreImportSnapshot: PreImportSnapshot = async () => {}

export const FORMATS_PATH = 'budget/import-formats.json'

export type FormatsLoad = { state: 'ready'; file: FormatsFile } | { state: 'unreadable'; reason: 'corrupt' | 'newer' }

export type FormatsSaveResult = { ok: true } | { ok: false; reason: 'unreadable' | 'write' }

/**
 * `readJSON` returns its fallback for a corrupt file, so a missing file and an unreadable one are told apart
 * with `exists()`. A corrupt or newer-version file is never overwritten: callers get `state: 'unreadable'`.
 */
export async function loadFormats(fileStore: FileStore): Promise<FormatsLoad> {
  try {
    if (!(await fileStore.exists(FORMATS_PATH))) return { state: 'ready', file: emptyFormatsFile() }
    const parsed = parseFormatsFile(await fileStore.readJSON<unknown>(FORMATS_PATH, null))
    return parsed.kind === 'ok' ? { state: 'ready', file: parsed.file } : { state: 'unreadable', reason: parsed.kind }
  } catch {
    return { state: 'unreadable', reason: 'corrupt' }
  }
}

/** Re-reads the file first, so a stale caller cannot overwrite changes or a file it could not read. */
export async function saveFormatUpdates(
  fileStore: FileStore,
  updates: FormatUpdate[],
  today: string,
): Promise<FormatsSaveResult> {
  const current = await loadFormats(fileStore)
  if (current.state === 'unreadable') return { ok: false, reason: 'unreadable' }
  try {
    await fileStore.writeJSON(FORMATS_PATH, applyFormatUpdates(current.file, updates, today))
    return { ok: true }
  } catch {
    return { ok: false, reason: 'write' }
  }
}

export const RULES_PATH = 'budget/category-rules.json'

export type RulesLoad = { state: 'ready'; file: RulesFile } | { state: 'unreadable'; reason: 'corrupt' | 'newer' }

export type RulesSaveResult = { ok: true } | { ok: false; reason: 'unreadable' | 'write' }

/** Same rules as `loadFormats`: a missing file is an empty list; a corrupt or newer one is never overwritten. */
export async function loadRules(fileStore: FileStore): Promise<RulesLoad> {
  try {
    if (!(await fileStore.exists(RULES_PATH))) return { state: 'ready', file: emptyRulesFile() }
    const parsed = parseRulesFile(await fileStore.readJSON<unknown>(RULES_PATH, null))
    return parsed.kind === 'ok' ? { state: 'ready', file: parsed.file } : { state: 'unreadable', reason: parsed.kind }
  } catch {
    return { state: 'unreadable', reason: 'corrupt' }
  }
}

/** Writes the whole ordered list after checking that the file on disk is still one this version can read. */
export async function saveRules(fileStore: FileStore, rules: CategoryRule[]): Promise<RulesSaveResult> {
  const current = await loadRules(fileStore)
  if (current.state === 'unreadable') return { ok: false, reason: 'unreadable' }
  try {
    await fileStore.writeJSON(RULES_PATH, { schemaVersion: RULES_SCHEMA_VERSION, rules })
    return { ok: true }
  } catch {
    return { ok: false, reason: 'write' }
  }
}

/** Follows a category merge: rules aimed at a merged-away category now point at the target. Writes only when something changed. */
export async function retargetStoredRules(
  fileStore: FileStore,
  from: readonly string[],
  to: string,
): Promise<RulesSaveResult> {
  const current = await loadRules(fileStore)
  if (current.state === 'unreadable') return { ok: false, reason: 'unreadable' }
  const { rules, changed } = retargetRules(current.file.rules, from, to)
  if (changed === 0) return { ok: true }
  return saveRules(fileStore, rules)
}
