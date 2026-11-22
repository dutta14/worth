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
}

/** Shared by every store that has nothing to report, so consumers get a stable reference. */
export const EMPTY_SAFETY_SNAPSHOT: SafetySnapshot = { failed: [], permissionLost: false }

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
