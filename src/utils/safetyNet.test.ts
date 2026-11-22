import { describe, it, expect } from 'vitest'
import {
  EMPTY_SAFETY_SNAPSHOT,
  FileStoreError,
  compareFingerprint,
  fingerprintBytes,
  hashBytes,
  backupDirFor,
  backupPathFor,
  corruptPathFor,
  deriveIssues,
  errorKind,
  formatBackupSize,
  isBackupEligible,
  isCorruptCopyOf,
  moreIssuesText,
  parseBackupName,
  pruneList,
  snapshotsEqual,
  stampFor,
  stampToDate,
} from './safetyNet'
import type { SafetySnapshot } from './safetyNet'

describe('errorKind', () => {
  it.each([
    [new DOMException('x', 'NotAllowedError'), 'permission'],
    [new DOMException('x', 'SecurityError'), 'permission'],
    [new DOMException('x', 'QuotaExceededError'), 'disk-full'],
    [new DOMException('x', 'InvalidStateError'), 'other'],
    [{ name: 'NotAllowedError' }, 'permission'],
    [new Error('plain'), 'other'],
    ['a string', 'other'],
    [null, 'other'],
    [undefined, 'other'],
  ] as const)('maps %o to %s', (error, kind) => {
    expect(errorKind(error)).toBe(kind)
  })
})

describe('snapshotsEqual', () => {
  const failed = (path: string, kind: 'other' | 'disk-full' = 'other') => ({ path, kind })

  it('treats identical snapshots as equal', () => {
    const a: SafetySnapshot = {
      failed: [failed('a.json')],
      corrupt: [],
      stale: [],
      permissionLost: true,
      backupsHealthy: true,
    }
    const b: SafetySnapshot = {
      failed: [failed('a.json')],
      corrupt: [],
      stale: [],
      permissionLost: true,
      backupsHealthy: true,
    }
    expect(snapshotsEqual(a, b)).toBe(true)
  })

  it('detects a backup health change', () => {
    expect(snapshotsEqual(EMPTY_SAFETY_SNAPSHOT, { ...EMPTY_SAFETY_SNAPSHOT, backupsHealthy: false })).toBe(false)
  })

  it('detects a permission change', () => {
    expect(
      snapshotsEqual(EMPTY_SAFETY_SNAPSHOT, {
        failed: [],
        corrupt: [],
        stale: [],
        permissionLost: true,
        backupsHealthy: true,
      }),
    ).toBe(false)
  })

  it('detects a different number of failures', () => {
    expect(
      snapshotsEqual(EMPTY_SAFETY_SNAPSHOT, {
        failed: [failed('a.json')],
        corrupt: [],
        stale: [],
        permissionLost: false,
        backupsHealthy: true,
      }),
    ).toBe(false)
  })

  it('detects a different path or kind', () => {
    const base: SafetySnapshot = {
      failed: [failed('a.json')],
      corrupt: [],
      stale: [],
      permissionLost: false,
      backupsHealthy: true,
    }
    expect(
      snapshotsEqual(base, {
        failed: [failed('b.json')],
        corrupt: [],
        stale: [],
        permissionLost: false,
        backupsHealthy: true,
      }),
    ).toBe(false)
    expect(
      snapshotsEqual(base, {
        failed: [failed('a.json', 'disk-full')],
        corrupt: [],
        stale: [],
        permissionLost: false,
        backupsHealthy: true,
      }),
    ).toBe(false)
  })
})

describe('deriveIssues', () => {
  it('returns nothing for an empty snapshot', () => {
    expect(deriveIssues(EMPTY_SAFETY_SNAPSHOT)).toEqual([])
  })

  it('reports write failures with their paths', () => {
    const issues = deriveIssues({
      failed: [
        { path: 'a.json', kind: 'other' },
        { path: 'balances/2026.csv', kind: 'disk-full' },
      ],
      corrupt: [],
      stale: [],
      permissionLost: false,
      backupsHealthy: true,
    })
    expect(issues).toEqual([{ type: 'write-failed', paths: ['a.json', 'balances/2026.csv'], diskFull: true }])
  })

  it('does not flag disk-full when no failure is disk-full', () => {
    const [issue] = deriveIssues({
      failed: [{ path: 'a.json', kind: 'other' }],
      corrupt: [],
      stale: [],
      permissionLost: false,
      backupsHealthy: true,
    })
    expect(issue).toEqual({ type: 'write-failed', paths: ['a.json'], diskFull: false })
  })

  it('puts permission first and folds permission-caused failures into it', () => {
    const issues = deriveIssues({
      failed: [{ path: 'a.json', kind: 'permission' }],
      corrupt: [],
      stale: [],
      permissionLost: true,
      backupsHealthy: true,
    })
    expect(issues).toEqual([{ type: 'permission' }])
  })

  it('keeps unrelated failures as a second issue when permission is lost', () => {
    const issues = deriveIssues({
      failed: [
        { path: 'a.json', kind: 'permission' },
        { path: 'b.json', kind: 'disk-full' },
      ],
      corrupt: [],
      stale: [],
      permissionLost: true,
      backupsHealthy: true,
    })
    expect(issues).toEqual([{ type: 'permission' }, { type: 'write-failed', paths: ['b.json'], diskFull: true }])
  })

  it('keeps permission-kind failures visible when permission is not flagged lost', () => {
    const issues = deriveIssues({
      failed: [{ path: 'a.json', kind: 'permission' }],
      corrupt: [],
      stale: [],
      permissionLost: false,
      backupsHealthy: true,
    })
    expect(issues).toEqual([{ type: 'write-failed', paths: ['a.json'], diskFull: false }])
  })
})

describe('moreIssuesText', () => {
  it('uses the singular for one issue', () => {
    expect(moreIssuesText(1)).toBe('1 more issue needs attention.')
  })

  it('uses the plural for several issues', () => {
    expect(moreIssuesText(3)).toBe('3 more issues need attention.')
  })
})

describe('stampFor', () => {
  it('formats a UTC time with no separators and millisecond precision', () => {
    expect(stampFor(Date.UTC(2026, 10, 8, 18, 34, 37, 123))).toBe('20261108T183437123Z')
  })

  it('zero-pads every field', () => {
    expect(stampFor(Date.UTC(2026, 0, 2, 3, 4, 5, 6))).toBe('20260102T030405006Z')
  })

  it('accepts a Date and sorts chronologically as text', () => {
    const earlier = stampFor(new Date('2026-01-01T00:00:00.000Z'))
    const later = stampFor(new Date('2026-01-01T00:00:00.001Z'))
    expect(earlier < later).toBe(true)
  })

  it('round-trips through stampToDate', () => {
    const time = Date.UTC(2026, 10, 8, 18, 34, 37, 123)
    expect(stampToDate(stampFor(time)).getTime()).toBe(time)
  })
})

describe('backupPathFor', () => {
  const stamp = '20261108T183437123Z'

  it.each([
    ['accounts.json', `_backups/accounts/${stamp}.json`],
    ['balances/2026.csv', `_backups/balances/2026/${stamp}.csv`],
    ['transactions/2025/2025-03.csv', `_backups/transactions/2025/2025-03/${stamp}.csv`],
    ['taxes/2025.json', `_backups/taxes/2025/${stamp}.json`],
    ['budget/categories.json', `_backups/budget/categories/${stamp}.json`],
  ])('maps %s', (path, expected) => {
    expect(backupPathFor(path, stamp)).toBe(expected)
  })

  it('adds the unsaved tag before the extension', () => {
    expect(backupPathFor('accounts.json', stamp, 'unsaved')).toBe(`_backups/accounts/${stamp}-unsaved.json`)
  })

  it('tolerates a path without an extension', () => {
    expect(backupPathFor('notes', stamp)).toBe(`_backups/notes/${stamp}`)
  })

  it('shares one folder per original path, ignoring the extension', () => {
    expect(backupDirFor('a/b.csv')).toBe('_backups/a/b')
  })
})

describe('parseBackupName', () => {
  it('reads the stamp, tag and extension', () => {
    expect(parseBackupName('20261108T183437123Z.json')).toEqual({
      stamp: '20261108T183437123Z',
      unsaved: false,
      ext: 'json',
    })
    expect(parseBackupName('20261108T183437123Z-unsaved.csv')).toEqual({
      stamp: '20261108T183437123Z',
      unsaved: true,
      ext: 'csv',
    })
  })

  it.each(['README.txt', '2026.csv', '20261108T183437123Z.pdf', '20261108T183437123Z-other.json'])(
    'rejects %s',
    name => {
      expect(parseBackupName(name)).toBeNull()
    },
  )
})

describe('isBackupEligible', () => {
  it.each([
    ['accounts.json', true],
    ['balances/2026.csv', true],
    ['budget/categories.json', true],
    ['taxes/2025.json', true],
    ['Upper/Case.CSV', true],
    ['taxes/2025/files/w2.pdf', false],
    ['taxes/2025/files/notes.json', false],
    ['budget/summary-cache.json', false],
    ['_backups/accounts/20261108T183437123Z.json', false],
    ['_backups/README.txt', false],
    ['notes.txt', false],
    ['accounts.json.corrupt-20261108T183437123Z', false],
    ['', false],
  ])('%s is %s', (path, eligible) => {
    expect(isBackupEligible(path)).toBe(eligible)
  })
})

describe('pruneList', () => {
  const entries = Array.from({ length: 13 }, (_, i) => ({ stamp: String(i).padStart(2, '0') }))

  it('returns nothing to delete at or under the limit', () => {
    expect(pruneList(entries.slice(0, 10))).toEqual([])
  })

  it('returns the oldest entries beyond the newest ten', () => {
    expect(pruneList(entries).map(entry => entry.stamp)).toEqual(['02', '01', '00'])
  })

  it('honors a custom limit and does not mutate its input', () => {
    const input = [{ stamp: 'b' }, { stamp: 'c' }, { stamp: 'a' }]
    expect(pruneList(input, 1)).toEqual([{ stamp: 'b' }, { stamp: 'a' }])
    expect(input.map(entry => entry.stamp)).toEqual(['b', 'c', 'a'])
  })

  it('keeps equal stamps in a stable order', () => {
    expect(pruneList([{ stamp: 'a' }, { stamp: 'a' }], 1)).toHaveLength(1)
  })
})

describe('formatBackupSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [4300, '4.2 KB'],
    [1024 * 1024, '1.0 MB'],
    [5.5 * 1024 * 1024, '5.5 MB'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatBackupSize(bytes)).toBe(text)
  })
})

describe('corrupt files', () => {
  it('names the copy as a sibling with the stamp appended', () => {
    expect(corruptPathFor('accounts.json', '20261108T183437123Z')).toBe('accounts.json.corrupt-20261108T183437123Z')
    expect(corruptPathFor('budget/categories.json', stampFor(0))).toBe(
      'budget/categories.json.corrupt-19700101T000000000Z',
    )
  })

  it('never produces a name that loaders or the backup rules would pick up', () => {
    const copy = corruptPathFor('balances/2026.csv', stampFor(0))
    expect(copy.endsWith('.csv')).toBe(false)
    expect(isBackupEligible(corruptPathFor('accounts.json', stampFor(0)))).toBe(false)
  })

  it('recognises only copies of the same file', () => {
    expect(isCorruptCopyOf('accounts.json.corrupt-20261108T183437123Z', 'accounts.json')).toBe(true)
    expect(isCorruptCopyOf('profile.json.corrupt-20261108T183437123Z', 'accounts.json')).toBe(false)
    expect(isCorruptCopyOf('accounts.json', 'accounts.json')).toBe(false)
  })

  it('carries a code on FileStoreError', () => {
    const error = new FileStoreError('corrupt-blocked', 'held')
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('corrupt-blocked')
    expect(error.name).toBe('FileStoreError')
    expect(error.message).toBe('held')
  })

  it('lists corrupt files after permission and write failures, one issue per file', () => {
    const issues = deriveIssues({
      failed: [{ path: 'a.json', kind: 'other' }],
      corrupt: [
        { path: 'accounts.json', copyPath: 'accounts.json.corrupt-x', hasBackup: true },
        { path: 'profile.json', copyPath: null, hasBackup: false },
      ],
      stale: [],
      permissionLost: true,
      backupsHealthy: true,
    })
    expect(issues.map(issue => issue.type)).toEqual(['permission', 'write-failed', 'corrupt', 'corrupt'])
    expect(issues[3]).toEqual({ type: 'corrupt', path: 'profile.json', copyPath: null, hasBackup: false })
  })

  it('treats snapshots that differ only in corrupt files as different', () => {
    const base: SafetySnapshot = {
      ...EMPTY_SAFETY_SNAPSHOT,
      corrupt: [{ path: 'a.json', copyPath: 'a.json.corrupt-x', hasBackup: true }],
    }
    const same: SafetySnapshot = { ...base, corrupt: [{ ...base.corrupt[0] }] }
    expect(snapshotsEqual(base, same)).toBe(true)
    expect(snapshotsEqual(base, EMPTY_SAFETY_SNAPSHOT)).toBe(false)
    expect(snapshotsEqual(base, { ...base, corrupt: [{ ...base.corrupt[0], path: 'b.json' }] })).toBe(false)
    expect(snapshotsEqual(base, { ...base, corrupt: [{ ...base.corrupt[0], copyPath: null }] })).toBe(false)
    expect(snapshotsEqual(base, { ...base, corrupt: [{ ...base.corrupt[0], hasBackup: false }] })).toBe(false)
  })
})

describe('fingerprints', () => {
  const enc = (text: string) => new TextEncoder().encode(text)

  it('hashes the same bytes to the same value and different bytes to different values', () => {
    expect(hashBytes(enc('{"a":1}'))).toBe(hashBytes(enc('{"a":1}')))
    expect(hashBytes(enc('{"a":1}'))).not.toBe(hashBytes(enc('{"a":2}')))
    expect(hashBytes(enc(''))).toMatch(/^[0-9a-f]+$/)
  })

  it('tells same-size content apart', () => {
    expect(hashBytes(enc('abc'))).not.toBe(hashBytes(enc('acb')))
  })

  it('records the modified time, the byte length and the hash', () => {
    expect(fingerprintBytes(enc('héllo'), 42)).toEqual({ lastModified: 42, size: 6, hash: hashBytes(enc('héllo')) })
  })

  describe('compareFingerprint', () => {
    const base = fingerprintBytes(enc('hello'), 1000)

    it('is same when size and modified time match', () => {
      expect(compareFingerprint(base, { lastModified: 1000, size: 5 })).toBe('same')
    })

    it('is size-changed whenever the size differs, even if the modified time matches', () => {
      expect(compareFingerprint(base, { lastModified: 1000, size: 6 })).toBe('size-changed')
      expect(compareFingerprint(base, { lastModified: 2000, size: 6 })).toBe('size-changed')
    })

    it('is mtime-only when just the modified time moved', () => {
      expect(compareFingerprint(base, { lastModified: 2000, size: 5 })).toBe('mtime-only')
    })
  })
})

describe('external change issues', () => {
  it('groups every changed file into one issue, after unreadable files', () => {
    const issues = deriveIssues({
      ...EMPTY_SAFETY_SNAPSHOT,
      corrupt: [{ path: 'accounts.json', copyPath: null, hasBackup: false }],
      stale: [
        { path: 'a.json', deleted: false },
        { path: 'b.csv', deleted: true },
      ],
    })
    expect(issues.map(issue => issue.type)).toEqual(['corrupt', 'external-change'])
    expect(issues[1]).toEqual({ type: 'external-change', paths: ['a.json', 'b.csv'], deleted: false })
  })

  it('marks the issue deleted only for a single deleted file', () => {
    const one = deriveIssues({ ...EMPTY_SAFETY_SNAPSHOT, stale: [{ path: 'a.json', deleted: true }] })
    expect(one[0]).toMatchObject({ deleted: true })
  })

  it('compares changed files in snapshotsEqual', () => {
    const base = { ...EMPTY_SAFETY_SNAPSHOT, stale: [{ path: 'a.json', deleted: false }] }
    expect(snapshotsEqual(base, { ...base, stale: [{ path: 'a.json', deleted: false }] })).toBe(true)
    expect(snapshotsEqual(base, EMPTY_SAFETY_SNAPSHOT)).toBe(false)
    expect(snapshotsEqual(base, { ...base, stale: [{ path: 'b.json', deleted: false }] })).toBe(false)
    expect(snapshotsEqual(base, { ...base, stale: [{ path: 'a.json', deleted: true }] })).toBe(false)
  })

  it('carries the new error codes', () => {
    expect(new FileStoreError('stale-blocked', 'x').code).toBe('stale-blocked')
    expect(new FileStoreError('unseen-file', 'x').code).toBe('unseen-file')
  })
})
