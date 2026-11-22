import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBackupManager, createHandleIO } from './backupManager'
import type { RawEntry, RawIO } from './backupManager'
import { stampFor } from './safetyNet'

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const dec = (bytes: Uint8Array | undefined): string => (bytes ? new TextDecoder().decode(bytes) : '<missing>')

const HOUR = 60 * 60 * 1000
const START = Date.UTC(2026, 10, 8, 12, 0, 0, 0)

/** A Map-backed RawIO. Directories are implied by the keys beneath them. */
const makeIO = () => {
  const files = new Map<string, Uint8Array>()
  const io: RawIO & { fail: { write?: (path: string) => void; remove?: (path: string) => void } } = {
    fail: {},
    async read(path) {
      return files.get(path) ?? null
    },
    async write(path, data) {
      io.fail.write?.(path)
      files.set(path, typeof data === 'string' ? enc(data) : data)
    },
    async list(dir) {
      const prefix = `${dir}/`
      const seen = new Map<string, RawEntry>()
      for (const [path, bytes] of files) {
        if (!path.startsWith(prefix)) continue
        const [head, ...rest] = path.slice(prefix.length).split('/')
        if (rest.length > 0) seen.set(head, { name: head, kind: 'directory' })
        else seen.set(head, { name: head, kind: 'file', size: bytes.length })
      }
      return [...seen.values()]
    },
    async remove(path) {
      io.fail.remove?.(path)
      files.delete(path)
    },
  }
  return { io, files }
}

const backupsOf = (files: Map<string, Uint8Array>, dir: string) =>
  [...files.keys()].filter(path => path.startsWith(`_backups/${dir}/`)).sort()

describe('createBackupManager', () => {
  let time = START
  const clock = () => time

  beforeEach(() => {
    time = START
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('snapshot', () => {
    it('copies the previous bytes to _backups/<path without extension>/<stamp>.<ext>', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)

      const entry = await manager.snapshot('accounts.json', enc('[1]'))

      const expected = `_backups/accounts/${stampFor(START)}.json`
      expect(entry).toEqual({
        path: 'accounts.json',
        backupPath: expected,
        stamp: stampFor(START),
        unsaved: false,
        size: 3,
      })
      expect(dec(files.get(expected))).toBe('[1]')
    })

    it('writes README.txt once, with the documented text', async () => {
      const { io, files } = makeIO()
      const write = vi.spyOn(io, 'write')
      const manager = createBackupManager(io, clock)

      await manager.snapshot('accounts.json', enc('[1]'))
      await manager.snapshot('profile.json', enc('{}'))

      expect(write.mock.calls.filter(([path]) => path === '_backups/README.txt')).toHaveLength(1)
      expect(dec(files.get('_backups/README.txt'))).toContain('The newest 10 copies of each file are kept.')
      expect(dec(files.get('_backups/README.txt'))).toContain('Settings > Data Folder > Backups')
    })

    it('leaves an existing README.txt alone', async () => {
      const { io, files } = makeIO()
      files.set('_backups/README.txt', enc('my notes'))
      const manager = createBackupManager(io, clock)

      await manager.snapshot('accounts.json', enc('[1]'))

      expect(dec(files.get('_backups/README.txt'))).toBe('my notes')
    })

    it('makes one copy per session: a second overwrite within 6 hours creates none', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[1]'))

      time += 6 * HOUR - 1
      expect(manager.isDue('accounts.json')).toBe(false)
      await expect(manager.snapshot('accounts.json', enc('[2]'))).resolves.toBeNull()

      expect(backupsOf(files, 'accounts')).toHaveLength(1)
    })

    it('takes a fresh copy once the last one is 6 hours old', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[1]'))

      time += 6 * HOUR
      expect(manager.isDue('accounts.json')).toBe(true)
      await manager.snapshot('accounts.json', enc('[2]'))

      expect(backupsOf(files, 'accounts')).toHaveLength(2)
    })

    it('does not duplicate bytes identical to the newest copy, and counts that as this session’s copy', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[1]'))

      time += 7 * HOUR
      await expect(manager.snapshot('accounts.json', enc('[1]'))).resolves.toBeNull()

      expect(backupsOf(files, 'accounts')).toHaveLength(1)
      expect(manager.isDue('accounts.json')).toBe(false)
    })

    it('copies bytes of the same length but different content', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[1]'))

      await manager.snapshot('accounts.json', enc('[2]'), { force: true })

      expect(backupsOf(files, 'accounts')).toHaveLength(2)
    })

    it('keeps only the newest 10 copies: the 11th deletes the oldest', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      for (let i = 0; i < 11; i++) {
        time = START + i * 7 * HOUR
        await manager.snapshot('accounts.json', enc(`[${i}]`))
      }

      const kept = backupsOf(files, 'accounts')
      expect(kept).toHaveLength(10)
      expect(kept).not.toContain(`_backups/accounts/${stampFor(START)}.json`)
      expect(kept).toContain(`_backups/accounts/${stampFor(START + 10 * 7 * HOUR)}.json`)
    })

    it('prunes each file independently', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      for (let i = 0; i < 12; i++) {
        time = START + i * 7 * HOUR
        await manager.snapshot('accounts.json', enc(`[${i}]`))
        if (i < 3) await manager.snapshot('profile.json', enc(`{"${i}":1}`))
      }

      expect(backupsOf(files, 'accounts')).toHaveLength(10)
      expect(backupsOf(files, 'profile')).toHaveLength(3)
    })

    it('does not mix a .json and a .csv that share a folder when pruning', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('a.csv', enc('x'))
      for (let i = 0; i < 12; i++) {
        time = START + (i + 1) * 7 * HOUR
        await manager.snapshot('a.json', enc(`[${i}]`))
      }

      expect(backupsOf(files, 'a').filter(path => path.endsWith('.csv'))).toHaveLength(1)
      expect(backupsOf(files, 'a').filter(path => path.endsWith('.json'))).toHaveLength(10)
    })

    it.each([
      ['a PDF', 'taxes/2025/files/w2.pdf'],
      ['a tax file', 'taxes/2025/files/w2.json'],
      ['the derived summary cache', 'budget/summary-cache.json'],
      ['a backup itself', '_backups/accounts/20261108T183437123Z.json'],
      ['a text file', 'notes.txt'],
    ])('never snapshots %s', async (_label, path) => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)

      await expect(manager.snapshot(path, enc('x'), { force: true })).resolves.toBeNull()

      expect(files.size).toBe(0)
      expect(manager.isDue(path)).toBe(false)
    })

    it('skips empty files', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await expect(manager.snapshot('accounts.json', new Uint8Array())).resolves.toBeNull()
      expect(files.size).toBe(0)
    })

    it('tags an unsaved edit and takes it regardless of the session rule', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[1]'))

      time += 1
      const entry = await manager.snapshot('accounts.json', enc('[2]'), { tag: 'unsaved' })

      expect(entry?.unsaved).toBe(true)
      expect(entry?.backupPath).toBe(`_backups/accounts/${stampFor(START + 1)}-unsaved.json`)
      expect(dec(files.get(entry?.backupPath ?? ''))).toBe('[2]')
    })

    it('forces a copy before the 6 hours are up', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[1]'))
      await manager.snapshot('accounts.json', enc('[2]'), { force: true })
      expect(backupsOf(files, 'accounts')).toHaveLength(2)
    })

    it('gives two copies taken in the same millisecond different names', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[1]'), { force: true })
      await manager.snapshot('accounts.json', enc('[2]'), { force: true })
      await manager.snapshot('accounts.json', enc('[3]'), { force: true })
      expect(backupsOf(files, 'accounts')).toHaveLength(3)
    })

    it('still succeeds when pruning fails, and logs it', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      for (let i = 0; i < 10; i++) {
        time = START + i * 7 * HOUR
        await manager.snapshot('accounts.json', enc(`[${i}]`))
      }
      io.fail.remove = () => {
        throw new Error('locked')
      }
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      time += 7 * HOUR
      await expect(manager.snapshot('accounts.json', enc('[new]'))).resolves.not.toBeNull()

      expect(errorSpy).toHaveBeenCalledWith('Backup prune failed:', expect.any(Error))
      expect(backupsOf(files, 'accounts')).toHaveLength(11)
    })

    it('throws when the copy cannot be written, and tries again on the next write', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('profile.json', enc('{}'))
      io.fail.write = path => {
        if (path.endsWith('.json')) throw new DOMException('full', 'QuotaExceededError')
      }

      await expect(manager.snapshot('accounts.json', enc('[1]'))).rejects.toThrow()
      expect(manager.isDue('accounts.json')).toBe(true)

      io.fail.write = undefined
      await manager.snapshot('accounts.json', enc('[1]'))
      expect(backupsOf(files, 'accounts')).toHaveLength(1)
    })

    it('disables backups for the session when _backups cannot be set up', async () => {
      const { io, files } = makeIO()
      io.fail.write = () => {
        throw new DOMException('is a file', 'TypeMismatchError')
      }
      const manager = createBackupManager(io, clock)

      await expect(manager.snapshot('accounts.json', enc('[1]'))).rejects.toThrow('is a file')

      io.fail.write = undefined
      expect(manager.isDue('accounts.json')).toBe(false)
      await expect(manager.snapshot('accounts.json', enc('[1]'))).resolves.toBeNull()
      await expect(manager.snapshot('accounts.json', enc('[1]'), { force: true })).rejects.toThrow(
        'Backups are unavailable',
      )
      await expect(manager.snapshot('accounts.json', enc('[1]'), { tag: 'unsaved' })).rejects.toThrow(
        'Backups are unavailable',
      )
      expect(files.size).toBe(0)
    })

    it('sets up the folder once even for simultaneous first snapshots', async () => {
      const { io } = makeIO()
      const write = vi.spyOn(io, 'write')
      const manager = createBackupManager(io, clock)

      await Promise.all([manager.snapshot('a.json', enc('1')), manager.snapshot('b.json', enc('2'))])

      expect(write.mock.calls.filter(([path]) => path === '_backups/README.txt')).toHaveLength(1)
    })
  })

  describe('list', () => {
    it('is empty when there is no _backups folder', async () => {
      const { io } = makeIO()
      await expect(createBackupManager(io, clock).list()).resolves.toEqual([])
    })

    it('returns every copy newest first with the original path, tag and size', async () => {
      const { io, files } = makeIO()
      files.set('_backups/README.txt', enc('hi'))
      files.set('_backups/accounts/20261108T183437123Z.json', enc('[1]'))
      files.set('_backups/accounts/20261108T201502044Z-unsaved.json', enc('[22]'))
      files.set('_backups/balances/2026/20261101T090000000Z.csv', enc('a,b'))
      files.set('_backups/transactions/2025/2025-03/20261109T000000000Z.csv', enc('x'))
      files.set('_backups/accounts/notes.txt', enc('ignore me'))
      files.set('_backups/20261108T183437123Z.json', enc('orphan at the root'))

      const entries = await createBackupManager(io, clock).list()

      expect(entries.map(entry => [entry.path, entry.stamp, entry.unsaved, entry.size])).toEqual([
        ['transactions/2025/2025-03.csv', '20261109T000000000Z', false, 1],
        ['accounts.json', '20261108T201502044Z', true, 4],
        ['accounts.json', '20261108T183437123Z', false, 3],
        ['balances/2026.csv', '20261101T090000000Z', false, 3],
      ])
      expect(entries[2].backupPath).toBe('_backups/accounts/20261108T183437123Z.json')
    })

    it('orders copies with the same stamp by path', async () => {
      const { io, files } = makeIO()
      files.set('_backups/b/20261108T183437123Z.json', enc('1'))
      files.set('_backups/a/20261108T183437123Z.json', enc('1'))
      const entries = await createBackupManager(io, clock).list()
      expect(entries.map(entry => entry.path)).toEqual(['a.json', 'b.json'])
    })

    it('rejects when the folder cannot be read', async () => {
      const { io } = makeIO()
      io.list = async () => {
        throw new Error('unreadable')
      }
      await expect(createBackupManager(io, clock).list()).rejects.toThrow('unreadable')
    })
  })

  describe('restore', () => {
    it('copies the current file aside first, then writes the backup over it', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[old]'))
      files.set('accounts.json', enc('[current]'))
      const [entry] = await manager.list()

      time += 1
      await manager.restore(entry)

      expect(dec(files.get('accounts.json'))).toBe('[old]')
      const copies = backupsOf(files, 'accounts')
      expect(copies).toHaveLength(2)
      expect(copies.map(path => dec(files.get(path))).sort()).toEqual(['[current]', '[old]'])
    })

    it('does not duplicate the current file when it already matches the newest copy', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[a]'))
      files.set('accounts.json', enc('[a]'))
      const [entry] = await manager.list()

      await manager.restore(entry)

      expect(backupsOf(files, 'accounts')).toHaveLength(1)
      expect(dec(files.get('accounts.json'))).toBe('[a]')
    })

    it('writes the backup when the file no longer exists', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[old]'))
      const [entry] = await manager.list()

      await manager.restore(entry)

      expect(dec(files.get('accounts.json'))).toBe('[old]')
      expect(backupsOf(files, 'accounts')).toHaveLength(1)
    })

    it('leaves the current file untouched when the backup is gone', async () => {
      const { io, files } = makeIO()
      files.set('accounts.json', enc('[current]'))
      const manager = createBackupManager(io, clock)

      await expect(
        manager.restore({
          path: 'accounts.json',
          backupPath: '_backups/accounts/20261108T183437123Z.json',
          stamp: '20261108T183437123Z',
          unsaved: false,
          size: 1,
        }),
      ).rejects.toThrow('no longer exists')

      expect(dec(files.get('accounts.json'))).toBe('[current]')
    })

    it('leaves the current file untouched when copying it aside fails', async () => {
      const { io, files } = makeIO()
      const manager = createBackupManager(io, clock)
      await manager.snapshot('accounts.json', enc('[old]'))
      files.set('accounts.json', enc('[current]'))
      const [entry] = await manager.list()
      io.fail.write = path => {
        if (path.startsWith('_backups/')) throw new DOMException('full', 'QuotaExceededError')
      }

      await expect(manager.restore(entry)).rejects.toThrow()

      expect(dec(files.get('accounts.json'))).toBe('[current]')
    })

    it.each([
      ['a path that is not backup-eligible', 'taxes/2025/files/w2.pdf', '_backups/x/20261108T183437123Z.json'],
      ['a backup that is not under _backups', 'accounts.json', 'elsewhere/20261108T183437123Z.json'],
    ])('refuses %s', async (_label, path, backupPath) => {
      const { io } = makeIO()
      await expect(
        createBackupManager(io, clock).restore({
          path,
          backupPath,
          stamp: '20261108T183437123Z',
          unsaved: false,
          size: 1,
        }),
      ).rejects.toThrow('Cannot restore')
    })
  })
})

/* ── createHandleIO ──────────────────────────────────────────── */

describe('createHandleIO', () => {
  const named = (name: string) => new DOMException('nope', name)

  const fileHandle = (content: string) => ({
    kind: 'file' as const,
    getFile: async () => new File([content], 'x'),
  })

  it('reads missing folders and files as null', async () => {
    const root = {
      getDirectoryHandle: vi.fn().mockRejectedValue(named('NotFoundError')),
    } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(root).read('a/b.json')).resolves.toBeNull()

    const dir = { getFileHandle: vi.fn().mockRejectedValue(named('NotFoundError')) }
    const withDir = { getDirectoryHandle: vi.fn().mockResolvedValue(dir) } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(withDir).read('a/b.json')).resolves.toBeNull()
  })

  it('rethrows other read errors', async () => {
    const root = {
      getFileHandle: vi.fn().mockRejectedValue(named('NotAllowedError')),
    } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(root).read('b.json')).rejects.toThrow('nope')

    const typeMismatch = {
      getDirectoryHandle: vi.fn().mockRejectedValue(named('TypeMismatchError')),
    } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(typeMismatch).read('a/b.json')).rejects.toThrow('nope')
  })

  it('reads file bytes', async () => {
    const root = {
      getFileHandle: vi.fn().mockResolvedValue(fileHandle('héllo')),
    } as unknown as FileSystemDirectoryHandle
    const bytes = await createHandleIO(root).read('a.json')
    expect(dec(bytes ?? undefined)).toBe('héllo')
  })

  it('writes strings and bytes, creating folders', async () => {
    const written: unknown[] = []
    const writable = { write: vi.fn(async (data: unknown) => void written.push(data)), close: vi.fn(async () => {}) }
    const leaf = { getFileHandle: vi.fn().mockResolvedValue({ createWritable: async () => writable }) }
    const root = { getDirectoryHandle: vi.fn().mockResolvedValue(leaf) } as unknown as FileSystemDirectoryHandle
    const io = createHandleIO(root)

    await io.write('_backups/README.txt', 'text')
    await io.write('_backups/x.json', enc('bytes'))

    expect(root.getDirectoryHandle).toHaveBeenCalledWith('_backups', { create: true })
    expect(leaf.getFileHandle).toHaveBeenCalledWith('x.json', { create: true })
    expect(written[0]).toBe('text')
    expect(written[1]).toBeInstanceOf(Blob)
    expect(writable.close).toHaveBeenCalledTimes(2)
  })

  it('fails a write whose folder cannot be resolved', async () => {
    const root = {
      getDirectoryHandle: vi.fn().mockRejectedValue(named('NotFoundError')),
    } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(root).write('a/b.json', 'x')).rejects.toThrow('Cannot create the folder')
  })

  it('lists files with sizes and folders, and treats a missing folder as empty', async () => {
    const dir = {
      async *values() {
        yield { kind: 'directory', name: 'sub' }
        yield { ...fileHandle('four'), name: 'f.json' }
      },
    }
    const root = { getDirectoryHandle: vi.fn().mockResolvedValue(dir) } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(root).list('_backups')).resolves.toEqual([
      { name: 'sub', kind: 'directory' },
      { name: 'f.json', kind: 'file', size: 4 },
    ])

    const missing = {
      getDirectoryHandle: vi.fn().mockRejectedValue(named('NotFoundError')),
    } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(missing).list('_backups')).resolves.toEqual([])
  })

  it('ignores a folder removed while it is being listed, but rethrows other errors', async () => {
    const vanishing = {
      // eslint-disable-next-line require-yield
      async *values() {
        throw named('NotFoundError')
      },
    }
    const root = { getDirectoryHandle: vi.fn().mockResolvedValue(vanishing) } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(root).list('_backups')).resolves.toEqual([])

    const broken = {
      // eslint-disable-next-line require-yield
      async *values() {
        throw named('NotAllowedError')
      },
    }
    const rootBroken = { getDirectoryHandle: vi.fn().mockResolvedValue(broken) } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(rootBroken).list('_backups')).rejects.toThrow('nope')
  })

  it('removes entries, tolerating missing ones', async () => {
    const dir = { removeEntry: vi.fn().mockResolvedValue(undefined), getDirectoryHandle: vi.fn() }
    dir.getDirectoryHandle.mockResolvedValue(dir)
    const root = { getDirectoryHandle: vi.fn().mockResolvedValue(dir) } as unknown as FileSystemDirectoryHandle
    await createHandleIO(root).remove('_backups/a/x.json')
    expect(dir.removeEntry).toHaveBeenCalledWith('x.json')

    dir.removeEntry.mockRejectedValueOnce(named('NotFoundError'))
    await expect(createHandleIO(root).remove('_backups/a/x.json')).resolves.toBeUndefined()

    dir.removeEntry.mockRejectedValueOnce(named('NotAllowedError'))
    await expect(createHandleIO(root).remove('_backups/a/x.json')).rejects.toThrow('nope')

    const gone = {
      getDirectoryHandle: vi.fn().mockRejectedValue(named('NotFoundError')),
    } as unknown as FileSystemDirectoryHandle
    await expect(createHandleIO(gone).remove('_backups/a/x.json')).resolves.toBeUndefined()
  })
})
