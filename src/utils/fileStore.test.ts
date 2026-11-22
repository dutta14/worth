import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryFileStore } from './memoryFileStore'
import { FileSystemFileStore } from './fileStore'
import { EMPTY_SAFETY_SNAPSHOT, FileStoreError } from './safetyNet'
import type { BackupEntry } from './safetyNet'

/* ── Fake File System Access API handles ─────────────────────── */

const notFound = () => new DOMException('not found', 'NotFoundError')

class FakeFileHandle {
  kind = 'file' as const
  constructor(
    public name: string,
    private dir: FakeDirectoryHandle,
  ) {}

  async getFile(): Promise<File> {
    const data = this.dir.contents.get(this.name)
    if (data === undefined) throw notFound()
    return new File([data], this.name)
  }

  async createWritable() {
    const dir = this.dir
    const name = this.name
    dir.faults.createWritable?.(name)
    let buffer: string | Blob = ''
    return {
      async write(data: string | Blob) {
        buffer = data
      },
      async close() {
        dir.faults.close?.(name)
        dir.contents.set(name, buffer)
      },
    }
  }
}

class FakeDirectoryHandle {
  kind = 'directory' as const
  contents = new Map<string, string | Blob>()
  dirs = new Map<string, FakeDirectoryHandle>()
  /** Hooks that throw to simulate disk and permission faults. */
  faults: { createWritable?: (name: string) => void; close?: (name: string) => void } = {}
  queryPermission = vi.fn<() => Promise<PermissionState>>(async () => 'granted')
  requestPermission = vi.fn<() => Promise<PermissionState>>(async () => 'granted')
  constructor(public name = 'root') {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!options?.create) throw notFound()
      dir = new FakeDirectoryHandle(name)
      this.dirs.set(name, dir)
    }
    return dir
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    if (!this.contents.has(name)) {
      if (!options?.create) throw notFound()
      this.contents.set(name, '')
    }
    return new FakeFileHandle(name, this)
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.contents.delete(name) && !this.dirs.delete(name)) throw notFound()
  }

  async *values() {
    for (const name of this.contents.keys()) yield new FakeFileHandle(name, this)
    for (const dir of this.dirs.values()) yield dir
  }
}

const EMPTY = EMPTY_SAFETY_SNAPSHOT

const asHandle = (dir: FakeDirectoryHandle) => dir as unknown as FileSystemDirectoryHandle

/* ── MemoryFileStore ─────────────────────────────────────────── */

describe('MemoryFileStore', () => {
  it('returns the fallback when a path has never been written', async () => {
    const store = new MemoryFileStore()
    await expect(store.readJSON('missing.json', { a: 1 })).resolves.toEqual({ a: 1 })
  })

  it('round-trips JSON through writeJSON/readJSON', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON('profile.json', { name: 'Alex', birthday: '1990-01' })
    await expect(store.readJSON('profile.json', {})).resolves.toEqual({ name: 'Alex', birthday: '1990-01' })
  })

  it('returns the fallback when stored JSON is corrupt', async () => {
    const store = new MemoryFileStore()
    await store.writeCSV('broken.json', [['not', 'json']])
    await expect(store.readJSON('broken.json', ['fallback'])).resolves.toEqual(['fallback'])
  })

  it('fires subscribers when writeJSON persists the path', async () => {
    const store = new MemoryFileStore()
    const cb = vi.fn()
    store.subscribe('accounts.json', cb)
    await store.writeJSON('accounts.json', [1, 2])
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('stops firing after unsubscribe', async () => {
    const store = new MemoryFileStore()
    const cb = vi.fn()
    const unsubscribe = store.subscribe('accounts.json', cb)
    unsubscribe()
    await store.writeJSON('accounts.json', [])
    expect(cb).not.toHaveBeenCalled()
  })

  it('round-trips CSV rows', async () => {
    const store = new MemoryFileStore()
    const rows = [
      ['month', 'accountId', 'balance'],
      ['2024-01', '1', '1,500'],
    ]
    await store.writeCSV('balances/2024.csv', rows)
    await expect(store.readCSV('balances/2024.csv')).resolves.toEqual(rows)
  })

  it('returns an empty matrix when reading a missing CSV', async () => {
    const store = new MemoryFileStore()
    await expect(store.readCSV('balances/1999.csv')).resolves.toEqual([])
  })

  it('round-trips binary data', async () => {
    const store = new MemoryFileStore()
    const buffer = new Uint8Array([1, 2, 3]).buffer
    await store.writeBinary('taxes/2024/files/w2.pdf', buffer)
    const read = await store.readBinary('taxes/2024/files/w2.pdf')
    expect(read && new Uint8Array(read)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('returns null when reading missing binary data', async () => {
    const store = new MemoryFileStore()
    await expect(store.readBinary('nope.bin')).resolves.toBeNull()
  })

  it('lists only direct children of a directory', async () => {
    const store = new MemoryFileStore()
    await store.writeCSV('balances/2023.csv', [['a']])
    await store.writeCSV('balances/2024.csv', [['a']])
    await store.writeCSV('balances/nested/2025.csv', [['a']])
    await store.writeJSON('accounts.json', [])
    await expect(store.listFiles('balances')).resolves.toEqual(['2023.csv', '2024.csv'])
  })

  it('lists root-level files when given an empty directory', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON('accounts.json', [])
    await store.writeCSV('balances/2024.csv', [['a']])
    await expect(store.listFiles('')).resolves.toEqual(['accounts.json'])
  })

  it('removes a path on delete and reports it missing afterwards', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON('goals.json', { a: 1 })
    await expect(store.exists('goals.json')).resolves.toBe(true)
    await store.delete('goals.json')
    await expect(store.exists('goals.json')).resolves.toBe(false)
    await expect(store.readJSON('goals.json', null)).resolves.toBeNull()
  })

  it('fires subscribers on delete', async () => {
    const store = new MemoryFileStore()
    const cb = vi.fn()
    await store.writeJSON('goals.json', {})
    store.subscribe('goals.json', cb)
    await store.delete('goals.json')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('exposes no directory handle', () => {
    expect(new MemoryFileStore().getHandle()).toBeNull()
  })
})

/* ── FileSystemFileStore ─────────────────────────────────────── */

describe('FileSystemFileStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = async () => {
    const root = new FakeDirectoryHandle()
    const store = new FileSystemFileStore()
    await store.init(asHandle(root))
    return { root, store }
  }

  it('returns the fallback before any folder is connected', async () => {
    const store = new FileSystemFileStore()
    await expect(store.readJSON('accounts.json', [])).resolves.toEqual([])
    expect(store.getHandle()).toBeNull()
  })

  it('exposes the directory handle after init', async () => {
    const { root, store } = await setup()
    expect(store.getHandle()).toBe(asHandle(root))
  })

  it('debounces writes and persists to the underlying directory', async () => {
    const { root, store } = await setup()
    const promise = store.writeJSON('accounts.json', [{ id: 1 }])
    expect(root.contents.has('accounts.json')).toBe(false)
    await vi.advanceTimersByTimeAsync(300)
    await promise
    expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([{ id: 1 }])
  })

  it('serves reads from cache before the debounced write lands', async () => {
    const { store } = await setup()
    void store.writeJSON('accounts.json', [{ id: 7 }])
    await expect(store.readJSON('accounts.json', [])).resolves.toEqual([{ id: 7 }])
  })

  it('auto-creates nested directories on write', async () => {
    const { root, store } = await setup()
    const promise = store.writeCSV('transactions/2024/2024-01.csv', [['Date', 'Amount']])
    await vi.advanceTimersByTimeAsync(300)
    await promise
    const year = root.dirs.get('transactions')?.dirs.get('2024')
    expect(year?.contents.get('2024-01.csv')).toBe('Date,Amount')
  })

  it('reads CSV back from disk after the cache is bypassed', async () => {
    const { root, store } = await setup()
    root.contents.set('balances/2024.csv', 'ignored')
    const dir = await root.getDirectoryHandle('balances', { create: true })
    dir.contents.set('2024.csv', 'month,accountId,balance\n2024-01,1,100')
    await expect(store.readCSV('balances/2024.csv')).resolves.toEqual([
      ['month', 'accountId', 'balance'],
      ['2024-01', '1', '100'],
    ])
  })

  it('notifies subscribers once the write flushes', async () => {
    const { store } = await setup()
    const cb = vi.fn()
    store.subscribe('accounts.json', cb)
    const promise = store.writeJSON('accounts.json', [])
    expect(cb).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    await promise
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid writes to the same path into one flush', async () => {
    const { root, store } = await setup()
    const first = store.writeJSON('accounts.json', [1])
    await vi.advanceTimersByTimeAsync(100)
    const second = store.writeJSON('accounts.json', [1, 2])
    await vi.advanceTimersByTimeAsync(300)
    await Promise.all([first, second])
    expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([1, 2])
  })

  it('reports existence for files on disk and missing paths', async () => {
    const { root, store } = await setup()
    root.contents.set('profile.json', '{}')
    await expect(store.exists('profile.json')).resolves.toBe(true)
    await expect(store.exists('nothing.json')).resolves.toBe(false)
    await expect(store.exists('missing/dir/file.json')).resolves.toBe(false)
  })

  it('lists files and subdirectories in a directory', async () => {
    const { root, store } = await setup()
    const dir = await root.getDirectoryHandle('balances', { create: true })
    dir.contents.set('2024.csv', '')
    dir.contents.set('2023.csv', '')
    await dir.getDirectoryHandle('nested', { create: true })
    await expect(store.listFiles('balances')).resolves.toEqual(['2023.csv', '2024.csv', 'nested'])
  })

  it('returns an empty list for a directory that does not exist', async () => {
    const { store } = await setup()
    await expect(store.listFiles('balances')).resolves.toEqual([])
  })

  it('round-trips binary content', async () => {
    const { store } = await setup()
    const promise = store.writeBinary('taxes/2024/files/w2.pdf', new Uint8Array([9, 8, 7]).buffer)
    await vi.advanceTimersByTimeAsync(300)
    await promise
    const read = await store.readBinary('taxes/2024/files/w2.pdf')
    expect(read && new Uint8Array(read)).toEqual(new Uint8Array([9, 8, 7]))
  })

  it('returns null for missing binary content', async () => {
    const { store } = await setup()
    await expect(store.readBinary('taxes/2024/files/none.pdf')).resolves.toBeNull()
  })

  it('deletes files, drops the cache entry and stays quiet for missing files', async () => {
    const { root, store } = await setup()
    const promise = store.writeJSON('goals.json', { a: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await promise
    await store.delete('goals.json')
    expect(root.contents.has('goals.json')).toBe(false)
    await expect(store.readJSON('goals.json', null)).resolves.toBeNull()
    await expect(store.delete('goals.json')).resolves.toBeUndefined()
  })

  it('cancels a queued write when the path is deleted first', async () => {
    const { root, store } = await setup()
    const promise = store.writeJSON('goals.json', { a: 1 })
    await store.delete('goals.json')
    await vi.advanceTimersByTimeAsync(300)
    await promise
    expect(root.contents.has('goals.json')).toBe(false)
  })

  it('flushes pending writes on demand', async () => {
    const { root, store } = await setup()
    const promise = store.writeJSON('accounts.json', ['flushed'])
    await store.flush()
    await promise
    expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual(['flushed'])
  })

  it('falls back when stored JSON cannot be parsed', async () => {
    const { root, store } = await setup()
    root.contents.set('accounts.json', '{not json')
    await expect(store.readJSON('accounts.json', ['fallback'])).resolves.toEqual(['fallback'])
  })
})

/* ── FileSystemFileStore: data safety net ────────────────────── */

describe('FileSystemFileStore safety net', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = async (enabled = true) => {
    const root = new FakeDirectoryHandle()
    const store = new FileSystemFileStore()
    await store.init(asHandle(root))
    store.configureSafety({ enabled })
    return { root, store }
  }

  const diskError = (name: string) => () => {
    throw new DOMException('boom', name)
  }

  const retry = async (store: FileSystemFileStore) => {
    const outcome = store.retryFailed()
    await vi.advanceTimersByTimeAsync(1)
    return outcome
  }

  const settle = async (promise: Promise<unknown>) => {
    const outcome = promise.then(
      () => 'resolved',
      () => 'rejected',
    )
    await vi.advanceTimersByTimeAsync(1000)
    return outcome
  }

  describe('when not enabled', () => {
    it('keeps the legacy 300ms debounce', async () => {
      const { root, store } = await setup(false)
      void store.writeJSON('accounts.json', [1])
      await vi.advanceTimersByTimeAsync(200)
      expect(root.contents.has('accounts.json')).toBe(false)
      await vi.advanceTimersByTimeAsync(100)
      expect(root.contents.has('accounts.json')).toBe(true)
    })

    it('does not track failures and still rejects the caller', async () => {
      const { root, store } = await setup(false)
      root.faults.close = diskError('NotAllowedError')
      await expect(settle(store.writeJSON('accounts.json', [1]))).resolves.toBe('rejected')
      expect(store.getSafetySnapshot().failed).toEqual([])
      expect(store.getSafetySnapshot().permissionLost).toBe(false)
    })

    it('ignores retries and permission checks', async () => {
      const { root, store } = await setup(false)
      await store.checkPermission()
      await retry(store)
      expect(root.queryPermission).not.toHaveBeenCalled()
    })
  })

  it('uses the shorter debounce once enabled', async () => {
    const { root, store } = await setup()
    void store.writeJSON('accounts.json', [1])
    await vi.advanceTimersByTimeAsync(119)
    expect(root.contents.has('accounts.json')).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(root.contents.has('accounts.json')).toBe(true)
  })

  it('starts the write for every pending path on flush without advancing timers', async () => {
    const { root, store } = await setup()
    const writes = [store.writeJSON('a.json', [1]), store.writeCSV('b.csv', [['x']])]
    expect(store.hasUnsavedWork()).toBe(true)
    await store.flush()
    await Promise.all(writes)
    expect(root.contents.has('a.json')).toBe(true)
    expect(root.contents.has('b.csv')).toBe(true)
    expect(store.hasUnsavedWork()).toBe(false)
  })

  it('reports in-flight writes as unsaved work', async () => {
    const { root, store } = await setup()
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    const original = root.getFileHandle.bind(root)
    root.getFileHandle = async (name, options) => {
      await gate
      return original(name, options)
    }
    const write = store.writeJSON('a.json', [1])
    await vi.advanceTimersByTimeAsync(120)
    expect(store.hasUnsavedWork()).toBe(true)
    release()
    await write
    expect(store.hasUnsavedWork()).toBe(false)
  })

  it('does not report unsaved work when nothing is outstanding', async () => {
    const { store } = await setup()
    expect(store.hasUnsavedWork()).toBe(false)
  })

  describe('write failures', () => {
    it('records the failure, keeps the cached edit and still rejects the caller', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('InvalidStateError')
      await expect(settle(store.writeJSON('accounts.json', [{ id: 1 }]))).resolves.toBe('rejected')
      expect(store.getSafetySnapshot()).toEqual({
        failed: [{ path: 'accounts.json', kind: 'other' }],
        corrupt: [],
        permissionLost: false,
        backupsHealthy: true,
      })
      await expect(store.readJSON('accounts.json', [])).resolves.toEqual([{ id: 1 }])
      expect(root.contents.get('accounts.json')).toBe('')
      expect(store.hasUnsavedWork()).toBe(true)
    })

    it.each([
      ['QuotaExceededError', 'disk-full'],
      ['NotAllowedError', 'permission'],
      ['SecurityError', 'permission'],
    ] as const)('classifies %s as %s', async (name, kind) => {
      const { root, store } = await setup()
      root.faults.createWritable = diskError(name)
      await settle(store.writeJSON('accounts.json', [1]))
      expect(store.getSafetySnapshot().failed).toEqual([{ path: 'accounts.json', kind }])
      expect(store.getSafetySnapshot().permissionLost).toBe(kind === 'permission')
    })

    it('notifies safety subscribers and stops after unsubscribe', async () => {
      const { root, store } = await setup()
      const cb = vi.fn()
      const unsubscribe = store.subscribeSafety(cb)
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('a.json', [1]))
      expect(cb).toHaveBeenCalledTimes(1)
      unsubscribe()
      await settle(store.writeJSON('b.json', [1]))
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('survives a throwing safety subscriber', async () => {
      const { root, store } = await setup()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      store.subscribeSafety(() => {
        throw new Error('bad subscriber')
      })
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('a.json', [1]))
      expect(errorSpy).toHaveBeenCalledWith('FileStore safety subscriber error:', expect.any(Error))
      errorSpy.mockRestore()
    })

    it('keeps the snapshot reference stable until something changes', async () => {
      const { root, store } = await setup()
      const before = store.getSafetySnapshot()
      expect(store.getSafetySnapshot()).toBe(before)
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('a.json', [1]))
      const failed = store.getSafetySnapshot()
      expect(failed).not.toBe(before)
      await settle(store.writeJSON('a.json', [2]))
      expect(store.getSafetySnapshot()).toBe(failed)
    })

    it('retries the failed payload and clears the issue on success', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('accounts.json', [{ id: 1 }]))
      root.faults.close = undefined
      await retry(store)
      expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([{ id: 1 }])
      expect(store.getSafetySnapshot().failed).toEqual([])
      expect(store.hasUnsavedWork()).toBe(false)
    })

    it('keeps the issue when the retry fails again', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('QuotaExceededError')
      await settle(store.writeJSON('accounts.json', [1]))
      await expect(retry(store)).resolves.toBeUndefined()
      expect(store.getSafetySnapshot().failed).toEqual([{ path: 'accounts.json', kind: 'disk-full' }])
    })

    it('replaces the failed payload with a newer edit so the older value is never written last', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('accounts.json', ['old']))
      root.faults.close = undefined
      void store.writeJSON('accounts.json', ['new'])
      await retry(store)
      await vi.advanceTimersByTimeAsync(1000)
      expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual(['new'])
      expect(store.getSafetySnapshot().failed).toEqual([])
    })

    it('retries the newest payload when an edit lands after the failure', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('accounts.json', ['old']))
      void store.writeJSON('accounts.json', ['newer']).catch(() => {})
      root.faults.close = undefined
      await vi.advanceTimersByTimeAsync(1000)
      expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual(['newer'])
    })

    it('uses the newer pending payload when an in-flight write fails', async () => {
      const { root, store } = await setup()
      let release: () => void = () => {}
      const gate = new Promise<void>(resolve => (release = resolve))
      root.faults.close = diskError('InvalidStateError')
      const original = root.getFileHandle.bind(root)
      root.getFileHandle = async (name, options) => {
        await gate
        return original(name, options)
      }
      const first = store.writeJSON('a.json', ['first']).catch(() => {})
      await vi.advanceTimersByTimeAsync(120)
      const second = store.writeJSON('a.json', ['second']).catch(() => {})
      release()
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.all([first, second])
      root.faults.close = undefined
      await retry(store)
      expect(JSON.parse(String(root.contents.get('a.json')))).toEqual(['second'])
    })

    it('does not clear a failure while a newer write is still pending', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('a.json', [1]))
      root.faults.close = undefined
      let release: () => void = () => {}
      const gate = new Promise<void>(resolve => (release = resolve))
      const original = root.getFileHandle.bind(root)
      root.getFileHandle = async (name, options) => {
        await gate
        return original(name, options)
      }
      const retrying = store.retryFailed()
      await vi.advanceTimersByTimeAsync(1)
      void store.writeJSON('a.json', [2])
      release()
      await retrying
      expect(store.getSafetySnapshot().failed).toEqual([{ path: 'a.json', kind: 'other' }])
      await vi.advanceTimersByTimeAsync(1000)
      expect(store.getSafetySnapshot().failed).toEqual([])
    })

    it('skips retrying a path that already has a pending write', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('a.json', [1]))
      root.faults.close = undefined
      const pendingWrite = store.writeJSON('a.json', [2])
      await retry(store)
      expect(root.contents.get('a.json')).toBe('')
      await vi.advanceTimersByTimeAsync(1000)
      await pendingWrite
      expect(JSON.parse(String(root.contents.get('a.json')))).toEqual([2])
    })

    it('drops a failure when the file is deleted', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('a.json', [1]))
      await store.delete('a.json')
      expect(store.getSafetySnapshot().failed).toEqual([])
    })

    it('clears failures and permission state when the safety net is turned off', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('NotAllowedError')
      await settle(store.writeJSON('a.json', [1]))
      store.configureSafety({ enabled: false })
      expect(store.getSafetySnapshot()).toEqual({
        failed: [],
        corrupt: [],
        permissionLost: false,
        backupsHealthy: true,
      })
    })

    it('clears failures when a new folder is connected', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('InvalidStateError')
      await settle(store.writeJSON('a.json', [1]))
      await store.init(asHandle(new FakeDirectoryHandle()))
      expect(store.getSafetySnapshot().failed).toEqual([])
    })
  })

  describe('permission', () => {
    it('flags permission loss when the focus check is not granted', async () => {
      const { root, store } = await setup()
      root.queryPermission.mockResolvedValue('prompt')
      await store.checkPermission()
      expect(root.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
      expect(store.getSafetySnapshot().permissionLost).toBe(true)
    })

    it('flags permission loss when the check reports denied', async () => {
      const { root, store } = await setup()
      root.queryPermission.mockResolvedValue('denied')
      await store.checkPermission()
      expect(store.getSafetySnapshot().permissionLost).toBe(true)
    })

    it('clears permission loss and retries failed writes once access is back', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('NotAllowedError')
      await settle(store.writeJSON('a.json', [1]))
      expect(store.getSafetySnapshot().permissionLost).toBe(true)
      root.faults.close = undefined
      const checking = store.checkPermission()
      await vi.advanceTimersByTimeAsync(1)
      await checking
      expect(store.getSafetySnapshot()).toEqual({
        failed: [],
        corrupt: [],
        permissionLost: false,
        backupsHealthy: true,
      })
      expect(root.contents.has('a.json')).toBe(true)
    })

    it('does nothing on a granted check when everything is fine', async () => {
      const { store } = await setup()
      const before = store.getSafetySnapshot()
      await store.checkPermission()
      expect(store.getSafetySnapshot()).toBe(before)
    })

    it('does nothing when the browser has no queryPermission', async () => {
      const { root, store } = await setup()
      ;(root as { queryPermission?: unknown }).queryPermission = undefined
      await store.checkPermission()
      expect(store.getSafetySnapshot().permissionLost).toBe(false)
    })

    it('does nothing before a folder is connected', async () => {
      const store = new FileSystemFileStore()
      store.configureSafety({ enabled: true })
      await store.checkPermission()
      expect(store.getSafetySnapshot().permissionLost).toBe(false)
    })

    it('logs and ignores a failing permission query', async () => {
      const { root, store } = await setup()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      root.queryPermission.mockRejectedValue(new Error('nope'))
      await store.checkPermission()
      expect(store.getSafetySnapshot().permissionLost).toBe(false)
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('ignores a permission result that arrives after the safety net was turned off', async () => {
      const { root, store } = await setup()
      let answer: (state: PermissionState) => void = () => {}
      root.queryPermission.mockReturnValue(new Promise(resolve => (answer = resolve)))
      const check = store.checkPermission()
      store.configureSafety({ enabled: false })
      answer('denied')
      await check
      expect(store.getSafetySnapshot().permissionLost).toBe(false)
    })

    it('requests permission on reconnect and retries failed writes when granted', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('NotAllowedError')
      await settle(store.writeJSON('a.json', [1]))
      root.faults.close = undefined
      const reconnecting = store.requestReconnect()
      await vi.advanceTimersByTimeAsync(1)
      await expect(reconnecting).resolves.toBe('granted')
      expect(root.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
      expect(store.getSafetySnapshot()).toEqual({
        failed: [],
        corrupt: [],
        permissionLost: false,
        backupsHealthy: true,
      })
      expect(root.contents.has('a.json')).toBe(true)
    })

    it('keeps the permission issue when reconnect is denied', async () => {
      const { root, store } = await setup()
      root.faults.close = diskError('NotAllowedError')
      await settle(store.writeJSON('a.json', [1]))
      root.requestPermission.mockResolvedValue('denied')
      await expect(store.requestReconnect()).resolves.toBe('denied')
      expect(store.getSafetySnapshot().permissionLost).toBe(true)
      expect(store.getSafetySnapshot().failed).toHaveLength(1)
    })

    it('treats a browser without requestPermission as granted', async () => {
      const { root, store } = await setup()
      ;(root as { requestPermission?: unknown }).requestPermission = undefined
      await expect(store.requestReconnect()).resolves.toBe('granted')
    })

    it('reports denied when no folder is connected', async () => {
      const store = new FileSystemFileStore()
      await expect(store.requestReconnect()).resolves.toBe('denied')
    })
  })

  describe('backups', () => {
    const NOW = Date.UTC(2026, 10, 8, 12, 0, 0, 0)

    beforeEach(() => {
      vi.setSystemTime(NOW)
    })

    const textOf = async (data: string | Blob | undefined): Promise<string> =>
      data === undefined ? '<missing>' : typeof data === 'string' ? data : data.text()

    const folder = (root: FakeDirectoryHandle, path: string): FakeDirectoryHandle | undefined =>
      path.split('/').reduce<FakeDirectoryHandle | undefined>((dir, name) => dir?.dirs.get(name), root)

    const copiesIn = (root: FakeDirectoryHandle, dir: string): string[] =>
      [...(folder(root, dir)?.contents.keys() ?? [])].sort()

    const seed = (root: FakeDirectoryHandle, name: string, content: string) => root.contents.set(name, content)

    const save = async (store: FileSystemFileStore, path: string, data: unknown) => {
      const outcome = store.writeJSON(path, data)
      await vi.advanceTimersByTimeAsync(1000)
      await outcome
    }

    it('copies the previous bytes into _backups on the first overwrite and writes a README once', async () => {
      const { root, store } = await setup()
      seed(root, 'accounts.json', '[{"id":"old"}]')

      await save(store, 'accounts.json', [{ id: 'new' }])

      const [copy] = copiesIn(root, '_backups/accounts')
      expect(copy).toMatch(/^20261108T120000\d{3}Z\.json$/)
      await expect(textOf(folder(root, '_backups/accounts')?.contents.get(copy))).resolves.toBe('[{"id":"old"}]')
      expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([{ id: 'new' }])
      expect(await textOf(folder(root, '_backups')?.contents.get('README.txt'))).toContain('automatic copies')
    })

    it('makes no second copy for another overwrite within 6 hours', async () => {
      const { root, store } = await setup()
      seed(root, 'accounts.json', '[1]')

      await save(store, 'accounts.json', [2])
      await save(store, 'accounts.json', [3])

      expect(copiesIn(root, '_backups/accounts')).toHaveLength(1)
    })

    it('takes another copy once 6 hours have passed', async () => {
      const { root, store } = await setup()
      seed(root, 'accounts.json', '[1]')
      await save(store, 'accounts.json', [2])

      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
      await save(store, 'accounts.json', [3])

      expect(copiesIn(root, '_backups/accounts')).toHaveLength(2)
    })

    it('copies CSV files into a folder named after the file', async () => {
      const { root, store } = await setup()
      const balances = await root.getDirectoryHandle('balances', { create: true })
      balances.contents.set('2026.csv', 'month,balance\n2026-01,5\n')

      const outcome = store.writeCSV('balances/2026.csv', [['month', 'balance']])
      await vi.advanceTimersByTimeAsync(1000)
      await outcome

      const [copy] = copiesIn(root, '_backups/balances/2026')
      expect(copy).toMatch(/\.csv$/)
      await expect(textOf(folder(root, '_backups/balances/2026')?.contents.get(copy))).resolves.toBe(
        'month,balance\n2026-01,5\n',
      )
    })

    it('does not copy a file that did not exist yet', async () => {
      const { root, store } = await setup()
      await save(store, 'accounts.json', [1])
      expect(root.dirs.has('_backups')).toBe(false)
    })

    it('does not copy an empty file', async () => {
      const { root, store } = await setup()
      seed(root, 'accounts.json', '')
      await save(store, 'accounts.json', [1])
      expect(root.dirs.has('_backups')).toBe(false)
    })

    it('never copies tax documents or the derived summary cache', async () => {
      const { root, store } = await setup()
      const files = await (
        await root.getDirectoryHandle('taxes', { create: true })
      ).getDirectoryHandle('2025', { create: true })
      const docs = await files.getDirectoryHandle('files', { create: true })
      docs.contents.set('w2.pdf', 'pdf-bytes')
      const budget = await root.getDirectoryHandle('budget', { create: true })
      budget.contents.set('summary-cache.json', '{"old":true}')

      const pdf = store.writeBinary('taxes/2025/files/w2.pdf', new Uint8Array([1]).buffer)
      await save(store, 'budget/summary-cache.json', { fresh: true })
      await vi.advanceTimersByTimeAsync(1000)
      await pdf

      expect(root.dirs.has('_backups')).toBe(false)
    })

    it('does nothing while the safety net is off', async () => {
      const { root, store } = await setup(false)
      seed(root, 'accounts.json', '[1]')
      await save(store, 'accounts.json', [2])
      expect(root.dirs.has('_backups')).toBe(false)
      await expect(store.listBackups()).rejects.toThrow('not available')
    })

    it('still saves when the copy fails, reports it, and recovers on the next good copy', async () => {
      const { root, store } = await setup()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      seed(root, 'accounts.json', '[1]')
      seed(root, 'profile.json', '{"a":1}')
      const dir = await (
        await root.getDirectoryHandle('_backups', { create: true })
      ).getDirectoryHandle('accounts', {
        create: true,
      })
      dir.faults.createWritable = diskError('QuotaExceededError')

      await save(store, 'accounts.json', [2])

      expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([2])
      expect(store.getSafetySnapshot()).toEqual({
        failed: [],
        corrupt: [],
        permissionLost: false,
        backupsHealthy: false,
      })
      expect(errorSpy).toHaveBeenCalledWith('FileStore backup of "accounts.json" failed:', expect.any(DOMException))

      await save(store, 'profile.json', { a: 2 })
      expect(store.getSafetySnapshot().backupsHealthy).toBe(true)
      errorSpy.mockRestore()
    })

    it('turns backups off for the session when _backups cannot be set up, without blocking saves', async () => {
      const { root, store } = await setup()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      seed(root, 'accounts.json', '[1]')
      seed(root, 'profile.json', '{"a":1}')
      const backups = await root.getDirectoryHandle('_backups', { create: true })
      backups.faults.createWritable = diskError('InvalidStateError')

      await save(store, 'accounts.json', [2])
      await save(store, 'profile.json', { a: 2 })

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(store.getSafetySnapshot().backupsHealthy).toBe(false)
      expect(JSON.parse(String(root.contents.get('profile.json')))).toEqual({ a: 2 })
      errorSpy.mockRestore()
    })

    it('copies a file right before deleting it, even if one was taken earlier this session', async () => {
      const { root, store } = await setup()
      const balances = await root.getDirectoryHandle('balances', { create: true })
      balances.contents.set('2026.csv', 'v1')
      const first = store.writeCSV('balances/2026.csv', [['v2']])
      await vi.advanceTimersByTimeAsync(1000)
      await first

      await store.delete('balances/2026.csv')

      const copies = copiesIn(root, '_backups/balances/2026')
      expect(copies).toHaveLength(2)
      const texts = await Promise.all(
        copies.map(name => textOf(folder(root, '_backups/balances/2026')?.contents.get(name))),
      )
      expect(texts.sort()).toEqual(['v1', 'v2'])
      expect(balances.contents.has('2026.csv')).toBe(false)
    })

    it('deletes without a copy when the file never existed', async () => {
      const { root, store } = await setup()
      await expect(store.delete('balances/1999.csv')).resolves.toBeUndefined()
      expect(root.dirs.has('_backups')).toBe(false)
    })

    it('deletes an ineligible file without reading it or touching backup health', async () => {
      const { root, store } = await setup()
      const docs = await (
        await (await root.getDirectoryHandle('taxes', { create: true })).getDirectoryHandle('2025', { create: true })
      ).getDirectoryHandle('files', { create: true })
      docs.contents.set('w2.pdf', 'pdf-bytes')
      const getFile = vi.spyOn(FakeFileHandle.prototype, 'getFile')

      await store.delete('taxes/2025/files/w2.pdf')

      expect(getFile).not.toHaveBeenCalled()
      expect(docs.contents.has('w2.pdf')).toBe(false)
      expect(root.dirs.has('_backups')).toBe(false)
      expect(store.getSafetySnapshot().backupsHealthy).toBe(true)
      getFile.mockRestore()
    })

    it('does not report a backup failure when an ineligible file cannot be read before deletion', async () => {
      const { root, store } = await setup()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      root.contents.set('notes.txt', 'hello')
      const getFile = vi
        .spyOn(FakeFileHandle.prototype, 'getFile')
        .mockRejectedValue(new DOMException('x', 'NotReadableError'))

      await store.delete('notes.txt')

      expect(store.getSafetySnapshot().backupsHealthy).toBe(true)
      expect(errorSpy).not.toHaveBeenCalled()
      getFile.mockRestore()
      errorSpy.mockRestore()
    })

    it('lists copies newest first', async () => {
      const { root, store } = await setup()
      seed(root, 'accounts.json', '[1]')
      await save(store, 'accounts.json', [2])
      const entries = await store.listBackups()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ path: 'accounts.json', unsaved: false, size: 3 })
    })

    describe('restoreBackup', () => {
      const seedBackup = async (root: FakeDirectoryHandle, content: string) => {
        const dir = await (
          await root.getDirectoryHandle('_backups', { create: true })
        ).getDirectoryHandle('accounts', {
          create: true,
        })
        dir.contents.set('20261101T090000000Z.json', content)
        return {
          path: 'accounts.json',
          backupPath: '_backups/accounts/20261101T090000000Z.json',
          stamp: '20261101T090000000Z',
          unsaved: false,
          size: content.length,
        }
      }

      it('writes the copy over the file, keeps the current version, drops the cache and notifies subscribers', async () => {
        const { root, store } = await setup()
        seed(root, 'accounts.json', '["current"]')
        const entry = await seedBackup(root, '["old"]')
        await expect(store.readJSON('accounts.json', [])).resolves.toEqual(['current'])
        const notified = vi.fn()
        store.subscribe('accounts.json', notified)

        await store.restoreBackup(entry)

        await expect(textOf(root.contents.get('accounts.json'))).resolves.toBe('["old"]')
        await expect(store.readJSON('accounts.json', [])).resolves.toEqual(['old'])
        expect(notified).toHaveBeenCalledTimes(1)
        const copies = copiesIn(root, '_backups/accounts')
        expect(copies).toHaveLength(2)
        const texts = await Promise.all(
          copies.map(name => textOf(folder(root, '_backups/accounts')?.contents.get(name))),
        )
        expect(texts.sort()).toEqual(['["current"]', '["old"]'])
      })

      it('keeps an edit that is still waiting to be saved as an unsaved copy, and does not write it afterwards', async () => {
        const { root, store } = await setup()
        seed(root, 'accounts.json', '["current"]')
        const entry = await seedBackup(root, '["old"]')
        const waiting = store.writeJSON('accounts.json', ['typed just now'])

        await store.restoreBackup(entry)
        await vi.advanceTimersByTimeAsync(1000)
        await waiting

        await expect(textOf(root.contents.get('accounts.json'))).resolves.toBe('["old"]')
        const copies = copiesIn(root, '_backups/accounts')
        const unsaved = copies.find(name => name.endsWith('-unsaved.json'))
        expect(unsaved).toBeDefined()
        expect(JSON.parse(await textOf(folder(root, '_backups/accounts')?.contents.get(unsaved ?? '')))).toEqual([
          'typed just now',
        ])
        expect(store.hasUnsavedWork()).toBe(false)
      })

      it('keeps a failed save as an unsaved copy before clearing it', async () => {
        const { root, store } = await setup()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        seed(root, 'accounts.json', '["current"]')
        const entry = await seedBackup(root, '["old"]')
        root.faults.close = diskError('InvalidStateError')
        await settle(store.writeJSON('accounts.json', ['x']))
        root.faults.close = undefined
        expect(store.getSafetySnapshot().failed).toHaveLength(1)

        await store.restoreBackup(entry)

        expect(store.getSafetySnapshot().failed).toEqual([])
        const dir = folder(root, '_backups/accounts')
        const unsaved = copiesIn(root, '_backups/accounts').find(name => name.endsWith('-unsaved.json'))
        expect(unsaved).toBeDefined()
        expect(JSON.parse(await textOf(dir?.contents.get(unsaved ?? '')))).toEqual(['x'])
        errorSpy.mockRestore()
      })

      it('keeps the failed save when the unsaved copy cannot be made, and leaves the file alone', async () => {
        const { root, store } = await setup()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        seed(root, 'accounts.json', '["current"]')
        const entry = await seedBackup(root, '["old"]')
        root.faults.close = diskError('InvalidStateError')
        await settle(store.writeJSON('accounts.json', ['x']))
        root.faults.close = undefined
        const dir = folder(root, '_backups/accounts')
        if (dir) dir.faults.createWritable = diskError('QuotaExceededError')

        await expect(store.restoreBackup(entry)).rejects.toThrow('boom')

        expect(store.getSafetySnapshot().failed).toEqual([{ path: 'accounts.json', kind: 'other' }])
        expect(store.hasUnsavedWork()).toBe(true)
        expect(root.contents.get('accounts.json')).toBe('["current"]')
        errorSpy.mockRestore()
      })

      it('leaves the file alone and re-queues the waiting edit when the restore fails', async () => {
        const { root, store } = await setup()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        seed(root, 'accounts.json', '["current"]')
        const entry = await seedBackup(root, '["old"]')
        const unsavedDir = folder(root, '_backups/accounts')
        if (unsavedDir) unsavedDir.faults.createWritable = diskError('QuotaExceededError')
        const waiting = store.writeJSON('accounts.json', ['typed just now'])

        await expect(store.restoreBackup(entry)).rejects.toThrow('boom')
        expect(root.contents.get('accounts.json')).toBe('["current"]')

        if (unsavedDir) unsavedDir.faults.createWritable = undefined
        await vi.advanceTimersByTimeAsync(1000)
        await waiting
        expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual(['typed just now'])
        errorSpy.mockRestore()
      })

      it('merges the waiting edit into a newer one typed while the restore was failing', async () => {
        const { root, store } = await setup()
        seed(root, 'accounts.json', '["current"]')
        const entry = await seedBackup(root, '["old"]')
        const unsavedDir = folder(root, '_backups/accounts')
        let newer: Promise<void> = Promise.resolve()
        if (unsavedDir) {
          unsavedDir.faults.createWritable = () => {
            newer = store.writeJSON('accounts.json', ['newest'])
            throw new DOMException('boom', 'QuotaExceededError')
          }
        }
        const waiting = store.writeJSON('accounts.json', ['typed just now'])

        await expect(store.restoreBackup(entry)).rejects.toThrow('boom')
        if (unsavedDir) unsavedDir.faults.createWritable = undefined
        await vi.advanceTimersByTimeAsync(1000)
        await Promise.all([waiting, newer])

        expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual(['newest'])
      })

      it('rejects when the safety net is off', async () => {
        const { store } = await setup(false)
        await expect(
          store.restoreBackup({ path: 'a.json', backupPath: '_backups/a/x.json', stamp: 'x', unsaved: false, size: 1 }),
        ).rejects.toThrow('not available')
      })

      it('rejects when no folder is connected', async () => {
        const store = new FileSystemFileStore()
        store.configureSafety({ enabled: true })
        await expect(store.listBackups()).rejects.toThrow('not available')
      })
    })

    it('forgets session state when a new folder is connected', async () => {
      const { root, store } = await setup()
      seed(root, 'accounts.json', '[1]')
      await save(store, 'accounts.json', [2])

      const other = new FakeDirectoryHandle('other')
      seed(other, 'accounts.json', '[9]')
      await store.init(asHandle(other))
      await save(store, 'accounts.json', [10])

      expect(copiesIn(other, '_backups/accounts')).toHaveLength(1)
    })

    it('clears a backup warning when the safety net is turned off', async () => {
      const { root, store } = await setup()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      seed(root, 'accounts.json', '[1]')
      ;(await root.getDirectoryHandle('_backups', { create: true })).faults.createWritable = diskError('X')
      await save(store, 'accounts.json', [2])
      expect(store.getSafetySnapshot().backupsHealthy).toBe(false)

      store.configureSafety({ enabled: false })

      expect(store.getSafetySnapshot().backupsHealthy).toBe(true)
      errorSpy.mockRestore()
    })
  })

  describe('corrupt files', () => {
    const NOW = Date.UTC(2026, 10, 8, 12, 0, 0, 0)
    const enc = (text: string): Uint8Array => new TextEncoder().encode(text)

    beforeEach(() => {
      vi.setSystemTime(NOW)
    })

    const textOf = async (data: string | Blob | undefined): Promise<string> =>
      data === undefined ? '<missing>' : typeof data === 'string' ? data : data.text()

    const bytesOf = async (data: string | Blob | undefined): Promise<number[]> =>
      data === undefined ? [] : Array.from(new Uint8Array(await new Blob([data]).arrayBuffer()))

    const folder = (root: FakeDirectoryHandle, path: string): FakeDirectoryHandle | undefined =>
      path.split('/').reduce<FakeDirectoryHandle | undefined>((dir, name) => dir?.dirs.get(name), root)

    const corruptCopies = (root: FakeDirectoryHandle, name = 'accounts.json'): string[] =>
      [...root.contents.keys()].filter(key => key.startsWith(`${name}.corrupt-`)).sort()

    const backupCopies = (root: FakeDirectoryHandle, dir = '_backups/accounts'): string[] =>
      [...(folder(root, dir)?.contents.keys() ?? [])].sort()

    /** Records every file whose write was committed, in order. */
    const trackCommits = (root: FakeDirectoryHandle): string[] => {
      const committed: string[] = []
      root.faults.close = name => committed.push(name)
      return committed
    }

    const settleIO = () => vi.advanceTimersByTimeAsync(1000)

    /** Reads a corrupt file and waits for the quarantine copy and backup lookup to finish. */
    const detect = async (store: FileSystemFileStore, path = 'accounts.json'): Promise<unknown> => {
      const result = await store.readJSON(path, 'fallback')
      await settleIO()
      return result
    }

    const edit = async (store: FileSystemFileStore, path: string, data: unknown) => {
      const outcome = store.writeJSON(path, data).then(
        () => 'saved' as const,
        (error: unknown) => error,
      )
      await settleIO()
      return outcome
    }

    const seedBackup = (root: FakeDirectoryHandle, path: string, stamp: string, content: string, tag = '') => {
      const dir = path.replace(/\.json$/, '')
      let current = root
      for (const segment of ['_backups', ...dir.split('/')]) {
        let next = current.dirs.get(segment)
        if (!next) {
          next = new FakeDirectoryHandle(segment)
          current.dirs.set(segment, next)
        }
        current = next
      }
      current.contents.set(`${stamp}${tag}.json`, content)
    }

    const MALFORMED = [
      '{',
      '{"a":',
      '[1,2',
      'not json at all',
      '<html><body>502 Bad Gateway</body></html>',
      '{"a":1}}',
      '{"a":1} trailing text',
      '\uFEFF{"truncated":',
      "{'single':'quotes'}",
      '[1,,2]',
      'undefined',
      '{"a":1,}',
      '}{',
      '[',
      ']',
      '"unterminated',
      'nul\u0000l',
      '{"a":01}',
      '0x10',
      '--- yaml: true',
    ]

    it('covers twenty distinct malformed inputs', () => {
      expect(new Set(MALFORMED).size).toBe(20)
      for (const text of MALFORMED) expect(() => JSON.parse(text)).toThrow()
    })

    it.each(MALFORMED.map(text => [JSON.stringify(text), text]))(
      'quarantines %s without writing a byte to the original path',
      async (_label, text) => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', text)
        const committed = trackCommits(root)

        await expect(detect(store)).resolves.toBe('fallback')
        await expect(edit(store, 'accounts.json', [{ id: 'x' }])).resolves.toBeInstanceOf(FileStoreError)

        expect(committed.filter(name => name === 'accounts.json')).toEqual([])
        expect(root.contents.get('accounts.json')).toBe(text)
        const [copy] = corruptCopies(root)
        expect(copy).toMatch(/^accounts\.json\.corrupt-20261108T120000\d{3}Z$/)
        await expect(bytesOf(root.contents.get(copy))).resolves.toEqual(Array.from(enc(text)))
        expect(store.getSafetySnapshot().corrupt).toEqual([{ path: 'accounts.json', copyPath: copy, hasBackup: false }])
      },
    )

    it('copies bytes that are not valid text exactly as they are', async () => {
      const { root, store } = await setup()
      const raw = new Uint8Array([0x7b, 0xff, 0xfe, 0x00, 0xc3, 0x28])
      root.contents.set('accounts.json', new Blob([raw]))

      await detect(store)

      const [copy] = corruptCopies(root)
      await expect(bytesOf(root.contents.get(copy))).resolves.toEqual(Array.from(raw))
    })

    it('treats a zero-byte or whitespace-only file as missing: no banner, no copy, writes go through', async () => {
      const { root, store } = await setup()
      root.contents.set('accounts.json', '')
      root.contents.set('profile.json', ' \n\t ')

      await expect(detect(store, 'accounts.json')).resolves.toBe('fallback')
      await expect(detect(store, 'profile.json')).resolves.toBe('fallback')
      expect(store.getSafetySnapshot()).toBe(EMPTY)
      expect([...root.contents.keys()].filter(key => key.includes('.corrupt-'))).toEqual([])

      await expect(edit(store, 'accounts.json', [1])).resolves.toBe('saved')
      await expect(edit(store, 'profile.json', { a: 1 })).resolves.toBe('saved')
      expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([1])
      expect(JSON.parse(String(root.contents.get('profile.json')))).toEqual({ a: 1 })
    })

    it('does nothing when the safety net is off: the fallback is returned and the next save overwrites, as before', async () => {
      const { root, store } = await setup(false)
      root.contents.set('accounts.json', '{broken')

      await expect(detect(store)).resolves.toBe('fallback')
      expect(store.getSafetySnapshot()).toBe(EMPTY)
      await expect(edit(store, 'accounts.json', [1])).resolves.toBe('saved')

      expect(corruptCopies(root)).toEqual([])
      expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([1])
      expect(root.dirs.has('_backups')).toBe(false)
      expect(store.hasUnsavedWork()).toBe(false)
    })

    it('does not publish the issue until the copy is made, so the banner never shows a half-known state', async () => {
      const { root, store } = await setup()
      root.contents.set('accounts.json', '{broken')
      const seen: number[] = []
      store.subscribeSafety(() => seen.push(store.getSafetySnapshot().corrupt.length))

      await store.readJSON('accounts.json', null)
      expect(store.getSafetySnapshot().corrupt).toEqual([])
      await settleIO()

      expect(seen).toEqual([1])
    })

    it('reports a valid backup so Restore can be offered, and ignores unparseable ones', async () => {
      const { root, store } = await setup()
      root.contents.set('accounts.json', '{broken')
      seedBackup(root, 'accounts.json', '20261101T000000000Z', '{also broken')
      await detect(store)
      expect(store.getSafetySnapshot().corrupt[0].hasBackup).toBe(false)

      const other = await setup()
      other.root.contents.set('accounts.json', '{broken')
      seedBackup(other.root, 'accounts.json', '20261101T000000000Z', '[1]')
      await detect(other.store)
      expect(other.store.getSafetySnapshot().corrupt[0].hasBackup).toBe(true)
    })

    it('still raises the issue, without a backup, when the backups folder cannot be read', async () => {
      const { root, store } = await setup()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      root.contents.set('accounts.json', '{broken')
      const original = root.getDirectoryHandle.bind(root)
      root.getDirectoryHandle = async (name, options) => {
        if (name === '_backups') throw new Error('unreadable')
        return original(name, options)
      }

      await detect(store)

      expect(store.getSafetySnapshot().corrupt).toEqual([
        expect.objectContaining({ path: 'accounts.json', hasBackup: false }),
      ])
      errorSpy.mockRestore()
    })

    it('does not make another copy when the same broken file is read again', async () => {
      const { root, store } = await setup()
      root.contents.set('accounts.json', '{broken')
      await detect(store)
      await detect(store)
      expect(corruptCopies(root)).toHaveLength(1)

      const next = new FileSystemFileStore()
      await next.init(asHandle(root))
      next.configureSafety({ enabled: true })
      await detect(next)
      expect(corruptCopies(root)).toHaveLength(1)
      expect(next.getSafetySnapshot().corrupt[0].copyPath).toBe(corruptCopies(root)[0])
    })

    it('keeps the original untouched and says no copy exists when the copy cannot be saved', async () => {
      const { root, store } = await setup()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      root.contents.set('accounts.json', '{broken')
      root.faults.createWritable = name => {
        if (name.includes('.corrupt-')) throw new DOMException('full', 'QuotaExceededError')
      }
      const committed = trackCommits(root)

      await detect(store)
      await expect(edit(store, 'accounts.json', [1])).resolves.toBeInstanceOf(FileStoreError)

      expect(store.getSafetySnapshot().corrupt).toEqual([{ path: 'accounts.json', copyPath: null, hasBackup: false }])
      expect(root.contents.get('accounts.json')).toBe('{broken')
      expect(committed).toEqual([])
      expect(corruptCopies(root)).toEqual([])
      errorSpy.mockRestore()
    })

    describe('held writes', () => {
      it('refuses every write to a corrupt path, keeps the edit on screen, and is not a save failure', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)

        const outcome = await edit(store, 'accounts.json', [{ id: 'new' }])

        expect(outcome).toBeInstanceOf(FileStoreError)
        expect((outcome as FileStoreError).code).toBe('corrupt-blocked')
        expect(root.contents.get('accounts.json')).toBe('{broken')
        await expect(store.readJSON('accounts.json', [])).resolves.toEqual([{ id: 'new' }])
        expect(store.getSafetySnapshot().failed).toEqual([])
        expect(store.hasUnsavedWork()).toBe(true)
        expect(root.dirs.has('_backups')).toBe(false)
      })

      it('lets writes to other files through', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)

        await expect(edit(store, 'profile.json', { name: 'A' })).resolves.toBe('saved')

        expect(JSON.parse(String(root.contents.get('profile.json')))).toEqual({ name: 'A' })
      })

      it('holds a write that was queued before the file was found to be corrupt', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        const committed = trackCommits(root)

        const outcome = edit(store, 'accounts.json', [1])
        await expect(outcome).resolves.toBeInstanceOf(FileStoreError)

        expect(committed.filter(name => name === 'accounts.json')).toEqual([])
        expect(root.contents.get('accounts.json')).toBe('{broken')
        expect(corruptCopies(root)).toHaveLength(1)
        expect(store.getSafetySnapshot().corrupt).toHaveLength(1)
      })

      it('does not overwrite a corrupt file that was never read, and quarantines it first', async () => {
        const { root, store } = await setup()
        root.contents.set('goals.json', '{"financialGoals":[')

        await expect(edit(store, 'goals.json', { financialGoals: [] })).resolves.toBeInstanceOf(FileStoreError)

        expect(root.contents.get('goals.json')).toBe('{"financialGoals":[')
        const [copy] = corruptCopies(root, 'goals.json')
        await expect(textOf(root.contents.get(copy))).resolves.toBe('{"financialGoals":[')
        expect(store.getSafetySnapshot().corrupt[0]).toMatchObject({ path: 'goals.json', copyPath: copy })
      })

      it('checks a never-read file once, then writes normally', async () => {
        const { root, store } = await setup()
        root.contents.set('goals.json', '{"financialGoals":[]}')

        await expect(edit(store, 'goals.json', { financialGoals: [1] })).resolves.toBe('saved')
        root.contents.set('goals.json', '{"financialGoals":[1]}')
        await expect(edit(store, 'goals.json', { financialGoals: [2] })).resolves.toBe('saved')

        expect(JSON.parse(String(root.contents.get('goals.json')))).toEqual({ financialGoals: [2] })
        expect(store.getSafetySnapshot()).toBe(EMPTY)
      })

      it('does not treat a binary or CSV write to a .json-looking path as needing a check', async () => {
        const { root, store } = await setup()
        root.contents.set('balances/2026.csv', 'x')
        const balances = await root.getDirectoryHandle('balances', { create: true })
        balances.contents.set('2026.csv', 'month,balance\n{broken')

        const outcome = store.writeCSV('balances/2026.csv', [['month']])
        await settleIO()

        await expect(outcome).resolves.toBeUndefined()
        expect(store.getSafetySnapshot()).toBe(EMPTY)
      })

      it('surfaces a read error during the check as a save failure instead of writing', async () => {
        const { root, store } = await setup()
        root.contents.set('goals.json', '[1]')
        const original = root.getFileHandle.bind(root)
        root.getFileHandle = async (name, options) => {
          if (!options?.create && name === 'goals.json') throw new DOMException('no', 'NotAllowedError')
          return original(name, options)
        }
        const outcome = edit(store, 'goals.json', [2])

        await expect(outcome).resolves.not.toBe('saved')
        expect(store.getSafetySnapshot().failed).toEqual([{ path: 'goals.json', kind: 'permission' }])
        expect(root.contents.get('goals.json')).toBe('[1]')
      })

      it('writes a new file without a check when nothing exists yet', async () => {
        const { root, store } = await setup()
        await expect(edit(store, 'goals.json', [1])).resolves.toBe('saved')
        expect(root.contents.get('goals.json')).toBeDefined()
      })

      it('clears the hold when the file turns out to parse again and nothing was held', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        expect(store.getSafetySnapshot().corrupt).toHaveLength(1)

        root.contents.set('accounts.json', '[1]')
        await expect(store.readJSON('accounts.json', [])).resolves.toEqual([1])

        expect(store.getSafetySnapshot()).toBe(EMPTY)
      })

      it('keeps the hold on a file that parses again while an edit is still held', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        await edit(store, 'accounts.json', [9])

        store.configureSafety({ enabled: true })
        root.contents.set('accounts.json', '[1]')
        // Another tab saved; this one dropped its cache and re-reads.
        await (store as unknown as { cache: Map<string, unknown> }).cache.delete('accounts.json')
        await store.readJSON('accounts.json', [])

        expect(store.getSafetySnapshot().corrupt).toHaveLength(1)
        expect(store.hasUnsavedWork()).toBe(true)
      })
    })

    describe('start fresh', () => {
      it('writes the held edit, keeps the unreadable copy, and unblocks later saves', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        await edit(store, 'accounts.json', [1])
        await edit(store, 'accounts.json', [1, 2])
        const subscriber = vi.fn()
        store.subscribe('accounts.json', subscriber)

        await expect(store.resolveCorrupt('accounts.json', 'start-fresh')).resolves.toBeNull()

        expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([1, 2])
        const [copy] = corruptCopies(root)
        await expect(textOf(root.contents.get(copy))).resolves.toBe('{broken')
        expect(store.getSafetySnapshot()).toBe(EMPTY)
        expect(store.hasUnsavedWork()).toBe(false)
        expect(subscriber).toHaveBeenCalled()
        // The corrupt bytes are not copied into _backups: the .corrupt- copy already holds them.
        expect(backupCopies(root)).toEqual([])

        await expect(edit(store, 'accounts.json', [1, 2, 3])).resolves.toBe('saved')
        expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([1, 2, 3])
      })

      it('writes nothing when no edit was held, and does not flag the same bytes again', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        const committed = trackCommits(root)

        await store.resolveCorrupt('accounts.json', 'start-fresh')
        await detect(store)

        expect(committed.filter(name => name === 'accounts.json')).toEqual([])
        expect(root.contents.get('accounts.json')).toBe('{broken')
        expect(store.getSafetySnapshot()).toBe(EMPTY)
        await expect(edit(store, 'accounts.json', [7])).resolves.toBe('saved')
        expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([7])
      })

      it('flags the file again if it breaks again after the user resolved it and it was rewritten', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        await store.resolveCorrupt('accounts.json', 'start-fresh')
        await edit(store, 'accounts.json', [1])

        root.contents.set('accounts.json', '{broken again')
        ;(store as unknown as { cache: Map<string, unknown> }).cache.delete('accounts.json')
        await detect(store)

        expect(store.getSafetySnapshot().corrupt).toHaveLength(1)
        expect(corruptCopies(root)).toHaveLength(2)
      })

      it('makes a fresh copy first when the file changed on disk since it was found', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        root.contents.set('accounts.json', '{broken differently')
        await edit(store, 'accounts.json', [1])

        await store.resolveCorrupt('accounts.json', 'start-fresh')

        const copies = await Promise.all(corruptCopies(root).map(name => textOf(root.contents.get(name))))
        expect(copies.sort()).toEqual(['{broken', '{broken differently'])
      })

      it('falls back to _backups when the copy cannot be made, and still never loses the bytes', async () => {
        const { root, store } = await setup()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        root.contents.set('accounts.json', '{broken')
        root.faults.createWritable = name => {
          if (name.includes('.corrupt-')) throw new DOMException('full', 'QuotaExceededError')
        }
        await detect(store)
        await edit(store, 'accounts.json', [1])

        await store.resolveCorrupt('accounts.json', 'start-fresh')

        const [backup] = backupCopies(root)
        await expect(textOf(folder(root, '_backups/accounts')?.contents.get(backup))).resolves.toBe('{broken')
        expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([1])
        expect(store.getSafetySnapshot()).toBe(EMPTY)
        errorSpy.mockRestore()
      })

      it('refuses, leaving the file and the held edit alone, when no copy of any kind can be saved', async () => {
        const { root, store } = await setup()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        root.contents.set('accounts.json', '{broken')
        root.faults.createWritable = name => {
          if (name.includes('.corrupt-')) throw new DOMException('full', 'QuotaExceededError')
        }
        const original = root.getDirectoryHandle.bind(root)
        root.getDirectoryHandle = async (name, options) => {
          if (name === '_backups' && options?.create) throw new DOMException('full', 'QuotaExceededError')
          return original(name, options)
        }
        await detect(store)
        await edit(store, 'accounts.json', [1])

        await expect(store.resolveCorrupt('accounts.json', 'start-fresh')).rejects.toThrow()

        expect(root.contents.get('accounts.json')).toBe('{broken')
        expect(store.getSafetySnapshot().corrupt).toHaveLength(1)
        expect(store.hasUnsavedWork()).toBe(true)
        errorSpy.mockRestore()
      })

      it('refuses when there is no way to back up at all', async () => {
        const { root, store } = await setup()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        root.contents.set('accounts.json', '{broken')
        root.faults.createWritable = name => {
          if (name.includes('.corrupt-')) throw new DOMException('full', 'QuotaExceededError')
        }
        await detect(store)
        const internals = store as unknown as { getBackups: () => null }
        internals.getBackups = () => null

        await expect(store.resolveCorrupt('accounts.json', 'start-fresh')).rejects.toThrow('left untouched')

        expect(root.contents.get('accounts.json')).toBe('{broken')
        errorSpy.mockRestore()
      })

      it('keeps the file, the copy and the held edit when the write itself fails, so it can be tried again', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        await edit(store, 'accounts.json', [1])
        root.faults.close = name => {
          if (name === 'accounts.json') throw new DOMException('boom', 'InvalidStateError')
        }

        await expect(store.resolveCorrupt('accounts.json', 'start-fresh')).rejects.toThrow('boom')

        expect(root.contents.get('accounts.json')).toBe('{broken')
        expect(store.getSafetySnapshot().corrupt).toHaveLength(1)
        expect(store.hasUnsavedWork()).toBe(true)

        root.faults.close = undefined
        await store.resolveCorrupt('accounts.json', 'start-fresh')
        expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([1])
      })

      it('preserves nothing and writes the edit when the file was removed meanwhile', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        await edit(store, 'accounts.json', [1])
        root.contents.delete('accounts.json')

        await store.resolveCorrupt('accounts.json', 'start-fresh')

        expect(JSON.parse(String(root.contents.get('accounts.json')))).toEqual([1])
        expect(corruptCopies(root)).toHaveLength(1)
      })

      it('skips the copy when the identical one is still in place and the bytes are unchanged', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        const before = corruptCopies(root)

        await store.resolveCorrupt('accounts.json', 'start-fresh')

        expect(corruptCopies(root)).toEqual(before)
      })
    })

    describe('restore latest backup', () => {
      it('writes the newest valid backup, keeps the unreadable copy, and keeps the held edit as an unsaved backup', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        seedBackup(root, 'accounts.json', '20261101T000000000Z', '[1]')
        seedBackup(root, 'accounts.json', '20261102T000000000Z', '[2]')
        seedBackup(root, 'accounts.json', '20261103T000000000Z', '{broken backup')
        await detect(store)
        await edit(store, 'accounts.json', [9])
        const subscriber = vi.fn()
        store.subscribe('accounts.json', subscriber)

        const restored = await store.resolveCorrupt('accounts.json', 'restore-latest')

        expect(restored).toMatchObject({ path: 'accounts.json', stamp: '20261102T000000000Z' })
        await expect(textOf(root.contents.get('accounts.json'))).resolves.toBe('[2]')
        const [copy] = corruptCopies(root)
        await expect(textOf(root.contents.get(copy))).resolves.toBe('{broken')
        const names = backupCopies(root)
        const unsaved = names.find(name => name.endsWith('-unsaved.json'))
        expect(unsaved).toBeDefined()
        await expect(textOf(folder(root, '_backups/accounts')?.contents.get(unsaved ?? ''))).resolves.toBe(
          JSON.stringify([9], null, 2),
        )
        expect(names).toHaveLength(4)
        expect(store.getSafetySnapshot()).toBe(EMPTY)
        expect(store.hasUnsavedWork()).toBe(false)
        expect(subscriber).toHaveBeenCalled()
        await expect(store.readJSON('accounts.json', null)).resolves.toEqual([2])
      })

      it('uses an unsaved edit only when there is no regular backup', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        seedBackup(root, 'accounts.json', '20261105T000000000Z', '[5]', '-unsaved')
        await detect(store)
        expect(store.getSafetySnapshot().corrupt[0].hasBackup).toBe(true)

        await store.resolveCorrupt('accounts.json', 'restore-latest')

        await expect(textOf(root.contents.get('accounts.json'))).resolves.toBe('[5]')
      })

      it('rejects with the file untouched and the hold in place when no backup parses', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        seedBackup(root, 'accounts.json', '20261101T000000000Z', 'nope')
        await detect(store)
        await edit(store, 'accounts.json', [9])

        await expect(store.resolveCorrupt('accounts.json', 'restore-latest')).rejects.toThrow('no valid backup')

        expect(root.contents.get('accounts.json')).toBe('{broken')
        expect(store.getSafetySnapshot().corrupt).toHaveLength(1)
        expect(store.hasUnsavedWork()).toBe(true)
      })

      it('leaves the file and the hold alone when the unsaved edit cannot be backed up', async () => {
        const { root, store } = await setup()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        root.contents.set('accounts.json', '{broken')
        seedBackup(root, 'accounts.json', '20261101T000000000Z', '[1]')
        await detect(store)
        await edit(store, 'accounts.json', [9])
        folder(root, '_backups/accounts')!.faults.createWritable = name => {
          if (name.endsWith('-unsaved.json')) throw new DOMException('full', 'QuotaExceededError')
        }

        await expect(store.resolveCorrupt('accounts.json', 'restore-latest')).rejects.toThrow()

        expect(root.contents.get('accounts.json')).toBe('{broken')
        expect(store.getSafetySnapshot().corrupt).toHaveLength(1)
        errorSpy.mockRestore()
      })

      it('restores without an unsaved copy when nothing was edited', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        seedBackup(root, 'accounts.json', '20261101T000000000Z', '[1]')
        await detect(store)

        await store.resolveCorrupt('accounts.json', 'restore-latest')

        await expect(textOf(root.contents.get('accounts.json'))).resolves.toBe('[1]')
        expect(backupCopies(root)).toEqual(['20261101T000000000Z.json'])
      })

      it('works for a nested path', async () => {
        const { root, store } = await setup()
        const budget = await root.getDirectoryHandle('budget', { create: true })
        budget.contents.set('categories.json', '{broken')
        seedBackup(root, 'budget/categories.json', '20261101T000000000Z', '{"a":1}')

        await detect(store, 'budget/categories.json')
        await store.resolveCorrupt('budget/categories.json', 'restore-latest')

        await expect(textOf(budget.contents.get('categories.json'))).resolves.toBe('{"a":1}')
        expect([...budget.contents.keys()].some(key => key.startsWith('categories.json.corrupt-'))).toBe(true)
      })
    })

    describe('resolveCorrupt guards', () => {
      it('does nothing for a path with no unresolved problem', async () => {
        const { store } = await setup()
        await expect(store.resolveCorrupt('accounts.json', 'start-fresh')).resolves.toBeNull()
      })

      it('does nothing when the safety net is off', async () => {
        const { root, store } = await setup(false)
        root.contents.set('accounts.json', '{broken')
        await expect(store.resolveCorrupt('accounts.json', 'start-fresh')).resolves.toBeNull()
        expect(root.contents.get('accounts.json')).toBe('{broken')
      })

      it('shares one run between simultaneous resolutions', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        seedBackup(root, 'accounts.json', '20261101T000000000Z', '[1]')
        await detect(store)

        const first = store.resolveCorrupt('accounts.json', 'restore-latest')
        const second = store.resolveCorrupt('accounts.json', 'restore-latest')

        expect(second).toBe(first)
        await first
        expect(backupCopies(root)).toHaveLength(1)
      })

      it('does nothing when the issue was already resolved while waiting for the lock', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        const outcome = store.resolveCorrupt('accounts.json', 'start-fresh')
        ;(store as unknown as { corrupt: Map<string, unknown> }).corrupt.delete('accounts.json')

        await expect(outcome).resolves.toBeNull()
      })
    })

    describe('other paths into the same file', () => {
      it('restoreBackup on a held path ends the hold and keeps the held edit as an unsaved backup', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        seedBackup(root, 'accounts.json', '20261101T000000000Z', '[1]')
        await detect(store)
        await edit(store, 'accounts.json', [9])
        const [entry] = await store.listBackups()

        await store.restoreBackup(entry as BackupEntry)

        await expect(textOf(root.contents.get('accounts.json'))).resolves.toBe('[1]')
        expect(store.getSafetySnapshot()).toBe(EMPTY)
        expect(store.hasUnsavedWork()).toBe(false)
        expect(backupCopies(root).some(name => name.endsWith('-unsaved.json'))).toBe(true)
        await expect(edit(store, 'accounts.json', [2])).resolves.toBe('saved')
      })

      it('deleting a corrupt file keeps a copy, removes it, and ends the hold', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        await edit(store, 'accounts.json', [9])

        await store.delete('accounts.json')

        expect(root.contents.has('accounts.json')).toBe(false)
        const [copy] = corruptCopies(root)
        await expect(textOf(root.contents.get(copy))).resolves.toBe('{broken')
        expect(store.getSafetySnapshot()).toBe(EMPTY)
        expect(store.hasUnsavedWork()).toBe(false)
      })

      it('refuses to delete a corrupt file when its bytes cannot be kept', async () => {
        const { root, store } = await setup()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        root.faults.createWritable = name => {
          if (name.includes('.corrupt-')) throw new DOMException('full', 'QuotaExceededError')
        }
        root.contents.set('accounts.json', '{broken and changed')
        ;(store as unknown as { getBackups: () => null }).getBackups = () => null

        await expect(store.delete('accounts.json')).rejects.toThrow('left untouched')

        expect(root.contents.get('accounts.json')).toBe('{broken and changed')
        errorSpy.mockRestore()
      })
    })

    describe('lifecycle', () => {
      it('forgets everything when the safety net is turned off', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)
        await edit(store, 'accounts.json', [1])

        store.configureSafety({ enabled: false })

        expect(store.getSafetySnapshot()).toBe(EMPTY)
        expect(store.hasUnsavedWork()).toBe(false)
      })

      it('forgets everything when a new folder is connected', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await detect(store)

        await store.init(asHandle(new FakeDirectoryHandle('other')))

        expect(store.getSafetySnapshot()).toBe(EMPTY)
      })

      it('drops a copy that finishes after the net was turned off', async () => {
        const { root, store } = await setup()
        root.contents.set('accounts.json', '{broken')
        await store.readJSON('accounts.json', null)

        store.configureSafety({ enabled: false })
        await settleIO()

        expect(store.getSafetySnapshot()).toBe(EMPTY)
      })
    })
  })
})
