/**
 * Pure types and helpers for the data safety net (docs/specs/data-safety-net.md).
 * No I/O lives here so everything is trivially unit-testable.
 */

export type WriteFailureKind = 'permission' | 'disk-full' | 'other'

export interface FailedWrite {
  path: string
  kind: WriteFailureKind
}

export interface SafetySnapshot {
  failed: FailedWrite[]
  permissionLost: boolean
  /** False after a backup copy could not be saved; cleared by the next successful copy. */
  backupsHealthy: boolean
}

/** Shared by every store that has nothing to report, so consumers get a stable reference. */
export const EMPTY_SAFETY_SNAPSHOT: SafetySnapshot = { failed: [], permissionLost: false, backupsHealthy: true }

const errorName = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined

/** Classifies a File System Access write error into something the user can act on. */
export const errorKind = (error: unknown): WriteFailureKind => {
  const name = errorName(error)
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission'
  if (name === 'QuotaExceededError') return 'disk-full'
  return 'other'
}

export const snapshotsEqual = (a: SafetySnapshot, b: SafetySnapshot): boolean =>
  a.permissionLost === b.permissionLost &&
  a.backupsHealthy === b.backupsHealthy &&
  a.failed.length === b.failed.length &&
  a.failed.every((entry, i) => entry.path === b.failed[i].path && entry.kind === b.failed[i].kind)

export type SafetyIssue = { type: 'permission' } | { type: 'write-failed'; paths: string[]; diskFull: boolean }

/**
 * Turns a snapshot into the issues the banner can show, highest priority first
 * (permission, then write failure). When permission is lost, failures caused by
 * it are folded into the permission issue so the user sees one clear next step.
 */
export const deriveIssues = (snapshot: SafetySnapshot): SafetyIssue[] => {
  const issues: SafetyIssue[] = []
  if (snapshot.permissionLost) issues.push({ type: 'permission' })
  const failed = snapshot.permissionLost
    ? snapshot.failed.filter(entry => entry.kind !== 'permission')
    : snapshot.failed
  if (failed.length > 0) {
    issues.push({
      type: 'write-failed',
      paths: failed.map(entry => entry.path),
      diskFull: failed.some(entry => entry.kind === 'disk-full'),
    })
  }
  return issues
}

export const moreIssuesText = (count: number): string =>
  count === 1 ? '1 more issue needs attention.' : `${count} more issues need attention.`

/* ── Backups ──────────────────────────────────────────────── */

export const BACKUPS_DIR = '_backups'
export const BACKUPS_PER_FILE = 10
/** A long session takes a fresh snapshot of a file once its last one is this old. */
export const SNAPSHOT_REFRESH_MS = 6 * 60 * 60 * 1000

export type BackupTag = 'unsaved'

export interface BackupEntry {
  /** The file the copy belongs to, e.g. `balances/2026.csv`. */
  path: string
  backupPath: string
  stamp: string
  unsaved: boolean
  size: number
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/** UTC `yyyymmddThhmmssmmmZ`: no colons (valid on Windows) and sorts lexicographically. */
export const stampFor = (time: number | Date): string => {
  const d = new Date(time)
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}` +
    `T${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}${pad(d.getUTCMilliseconds(), 3)}Z`
  )
}

/** Inverse of `stampFor`. */
export const stampToDate = (stamp: string): Date =>
  new Date(
    Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
      Number(stamp.slice(9, 11)),
      Number(stamp.slice(11, 13)),
      Number(stamp.slice(13, 15)),
      Number(stamp.slice(15, 18)),
    ),
  )

const BACKUP_NAME = /^(\d{8}T\d{9}Z)(-unsaved)?\.(json|csv)$/

export interface ParsedBackupName {
  stamp: string
  unsaved: boolean
  ext: string
}

export const parseBackupName = (name: string): ParsedBackupName | null => {
  const match = BACKUP_NAME.exec(name)
  return match ? { stamp: match[1], unsaved: match[2] !== undefined, ext: match[3] } : null
}

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

/** The folder that holds every copy of `path`: the path without its extension, under `_backups/`. */
export const backupDirFor = (path: string): string => {
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop() ?? ''
  const ext = extensionOf(name)
  return [BACKUPS_DIR, ...segments, ext ? name.slice(0, -ext.length) : name].join('/')
}

/** `balances/2026.csv` becomes `_backups/balances/2026/<stamp>[-unsaved].csv`. */
export const backupPathFor = (path: string, stamp: string, tag?: BackupTag): string => {
  const name = path.split('/').filter(Boolean).pop() ?? ''
  return `${backupDirFor(path)}/${stamp}${tag ? `-${tag}` : ''}${extensionOf(name)}`
}

/** Text files only; derived caches, tax documents and the backups themselves are never copied. */
export const isBackupEligible = (path: string): boolean => {
  const segments = path.split('/').filter(Boolean)
  const lower = segments.join('/').toLowerCase()
  if (!lower.endsWith('.json') && !lower.endsWith('.csv')) return false
  if (segments[0] === BACKUPS_DIR) return false
  if (lower === 'budget/summary-cache.json') return false
  return !(segments[0] === 'taxes' && segments[2] === 'files')
}

/** Returns the entries to delete so only the newest `keep` remain. Ordering follows the stamp. */
export const pruneList = <T extends { stamp: string }>(entries: T[], keep: number = BACKUPS_PER_FILE): T[] =>
  [...entries].sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0)).slice(keep)

export const formatBackupSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
