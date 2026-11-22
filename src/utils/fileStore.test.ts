import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryFileStore } from './memoryFileStore'
import { FileSystemFileStore } from './fileStore'

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
      expect(store.getSafetySnapshot()).toEqual({ failed: [], permissionLost: false, backupsHealthy: true })
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
      expect(store.getSafetySnapshot()).toEqual({ failed: [], permissionLost: false, backupsHealthy: true })
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
      expect(store.getSafetySnapshot()).toEqual({ failed: [], permissionLost: false, backupsHealthy: true })
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
      expect(store.getSafetySnapshot()).toEqual({ failed: [], permissionLost: false, backupsHealthy: false })
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

      it('clears a failed save for that file', async () => {
        const { root, store } = await setup()
        seed(root, 'accounts.json', '["current"]')
        const entry = await seedBackup(root, '["old"]')
        root.faults.close = diskError('InvalidStateError')
        await settle(store.writeJSON('accounts.json', ['x']))
        root.faults.close = undefined
        expect(store.getSafetySnapshot().failed).toHaveLength(1)

        await store.restoreBackup(entry)

        expect(store.getSafetySnapshot().failed).toEqual([])
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
})
