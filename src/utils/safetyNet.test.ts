import { describe, it, expect } from 'vitest'
import { EMPTY_SAFETY_SNAPSHOT, deriveIssues, errorKind, moreIssuesText, snapshotsEqual } from './safetyNet'
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
    const a: SafetySnapshot = { failed: [failed('a.json')], permissionLost: true }
    const b: SafetySnapshot = { failed: [failed('a.json')], permissionLost: true }
    expect(snapshotsEqual(a, b)).toBe(true)
  })

  it('detects a permission change', () => {
    expect(snapshotsEqual(EMPTY_SAFETY_SNAPSHOT, { failed: [], permissionLost: true })).toBe(false)
  })

  it('detects a different number of failures', () => {
    expect(snapshotsEqual(EMPTY_SAFETY_SNAPSHOT, { failed: [failed('a.json')], permissionLost: false })).toBe(false)
  })

  it('detects a different path or kind', () => {
    const base: SafetySnapshot = { failed: [failed('a.json')], permissionLost: false }
    expect(snapshotsEqual(base, { failed: [failed('b.json')], permissionLost: false })).toBe(false)
    expect(snapshotsEqual(base, { failed: [failed('a.json', 'disk-full')], permissionLost: false })).toBe(false)
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
      permissionLost: false,
    })
    expect(issues).toEqual([{ type: 'write-failed', paths: ['a.json', 'balances/2026.csv'], diskFull: true }])
  })

  it('does not flag disk-full when no failure is disk-full', () => {
    const [issue] = deriveIssues({ failed: [{ path: 'a.json', kind: 'other' }], permissionLost: false })
    expect(issue).toEqual({ type: 'write-failed', paths: ['a.json'], diskFull: false })
  })

  it('puts permission first and folds permission-caused failures into it', () => {
    const issues = deriveIssues({ failed: [{ path: 'a.json', kind: 'permission' }], permissionLost: true })
    expect(issues).toEqual([{ type: 'permission' }])
  })

  it('keeps unrelated failures as a second issue when permission is lost', () => {
    const issues = deriveIssues({
      failed: [
        { path: 'a.json', kind: 'permission' },
        { path: 'b.json', kind: 'disk-full' },
      ],
      permissionLost: true,
    })
    expect(issues).toEqual([{ type: 'permission' }, { type: 'write-failed', paths: ['b.json'], diskFull: true }])
  })

  it('keeps permission-kind failures visible when permission is not flagged lost', () => {
    const issues = deriveIssues({ failed: [{ path: 'a.json', kind: 'permission' }], permissionLost: false })
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
