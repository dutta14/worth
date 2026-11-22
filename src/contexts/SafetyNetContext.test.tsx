import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import type { FC, ReactNode } from 'react'
import { SafetyNetProvider, useSafetyNet } from './SafetyNetContext'
import { FileStoreContext } from './FileStoreContext'
import { FlagContext } from '../flags/FlagContext'
import type { FlagContextValue } from '../flags/FlagContext'
import { MemoryFileStore } from '../utils/memoryFileStore'
import { EMPTY_SAFETY_SNAPSHOT } from '../utils/safetyNet'
import type { BackupEntry, CorruptAction, SafetySnapshot } from '../utils/safetyNet'
import { makeFileStoreValue } from '../test/fileStoreTestUtils'
import type { FileStore } from '../utils/fileStoreTypes'

/** A stand-in for FileSystemFileStore that exposes the safety API with controllable state. */
const makeFakeStore = (hasHandle = true) => {
  let snapshot: SafetySnapshot = EMPTY_SAFETY_SNAPSHOT
  const subscribers = new Set<() => void>()
  const store = Object.assign(new MemoryFileStore(), {
    getHandle: () => (hasHandle ? ({} as FileSystemDirectoryHandle) : null),
    configureSafety: vi.fn(),
    getSafetySnapshot: () => snapshot,
    subscribeSafety: (cb: () => void) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    flush: vi.fn(async () => {}),
    hasUnsavedWork: vi.fn(() => false),
    retryFailed: vi.fn(async () => {}),
    checkPermission: vi.fn(async () => {}),
    requestReconnect: vi.fn<() => Promise<PermissionState>>(async () => 'granted'),
    listBackups: vi.fn<() => Promise<BackupEntry[]>>(async () => []),
    restoreBackup: vi.fn<(entry: BackupEntry) => Promise<void>>(async () => {}),
    resolveCorrupt: vi.fn<(path: string, action: CorruptAction) => Promise<BackupEntry | null>>(async () => null),
  })
  const setSnapshot = (next: SafetySnapshot) => {
    snapshot = next
    subscribers.forEach(cb => cb())
  }
  return { store, setSnapshot, subscribers }
}

const flagValue = (on: boolean): FlagContextValue => ({ resolveFlag: () => on }) as unknown as FlagContextValue

const makeWrapper = (store: FileStore, flagOn: boolean, pickFolder = vi.fn(async () => {})) => {
  const Wrapper: FC<{ children: ReactNode }> = ({ children }) => (
    <FlagContext.Provider value={flagValue(flagOn)}>
      <FileStoreContext.Provider value={{ ...makeFileStoreValue(store), pickFolder }}>
        <SafetyNetProvider>{children}</SafetyNetProvider>
      </FileStoreContext.Provider>
    </FlagContext.Provider>
  )
  return { Wrapper, pickFolder }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('SafetyNetProvider', () => {
  it('provides an inert default without a provider', () => {
    const { result } = renderHook(() => useSafetyNet())
    expect(result.current.enabled).toBe(false)
    expect(result.current.snapshot).toBe(EMPTY_SAFETY_SNAPSHOT)
    return expect(
      Promise.all([result.current.retryFailed(), result.current.reconnect(), result.current.chooseFolderAgain()]),
    ).resolves.toBeDefined()
  })

  describe('stays inert', () => {
    it('when the flag is off', () => {
      const { store } = makeFakeStore()
      const addSpy = vi.spyOn(window, 'addEventListener')
      const { Wrapper } = makeWrapper(store, false)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      expect(result.current.enabled).toBe(false)
      expect(store.configureSafety).not.toHaveBeenCalled()
      expect(addSpy).not.toHaveBeenCalledWith('pagehide', expect.anything())
      expect(addSpy).not.toHaveBeenCalledWith('focus', expect.anything())
    })

    it('for a memory store (demo and e2e modes)', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      const { Wrapper } = makeWrapper(new MemoryFileStore(), true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      expect(result.current.enabled).toBe(false)
      expect(addSpy).not.toHaveBeenCalledWith('pagehide', expect.anything())
      expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.anything())
    })

    it('before a folder is connected', () => {
      const { store } = makeFakeStore(false)
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      expect(result.current.enabled).toBe(false)
      expect(store.configureSafety).not.toHaveBeenCalled()
    })

    it('while demo mode is active', () => {
      localStorage.setItem('_demoMode', '1')
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      expect(result.current.enabled).toBe(false)
      expect(store.configureSafety).not.toHaveBeenCalled()
    })
  })

  describe('when enabled', () => {
    it('turns the safety net on and off with the provider lifecycle', () => {
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { result, unmount } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      expect(result.current.enabled).toBe(true)
      expect(store.configureSafety).toHaveBeenCalledTimes(1)
      expect(store.configureSafety).toHaveBeenLastCalledWith({ enabled: true })
      unmount()
      expect(store.configureSafety).toHaveBeenLastCalledWith({ enabled: false })
    })

    it('flushes pending writes on pagehide', () => {
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      window.dispatchEvent(new Event('pagehide'))
      expect(store.flush).toHaveBeenCalledTimes(1)
    })

    it('re-renders consumers when the store snapshot changes', () => {
      const { store, setSnapshot } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      expect(result.current.snapshot).toBe(EMPTY_SAFETY_SNAPSHOT)
      const failed: SafetySnapshot = {
        failed: [{ path: 'a.json', kind: 'other' }],
        corrupt: [],
        permissionLost: false,
        backupsHealthy: true,
      }
      act(() => setSnapshot(failed))
      expect(result.current.snapshot).toBe(failed)
    })

    it('unsubscribes from the store on unmount', () => {
      const { store, subscribers } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { unmount } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      expect(subscribers.size).toBe(1)
      unmount()
      expect(subscribers.size).toBe(0)
    })

    it('renders its children', () => {
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      render(<div>child content</div>, { wrapper: Wrapper })
      expect(screen.getByText('child content')).toBeInTheDocument()
    })

    it('delegates retryFailed to the store', async () => {
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      await act(() => result.current.retryFailed())
      expect(store.retryFailed).toHaveBeenCalledTimes(1)
    })

    it('reports whether anything still fails after the retry', async () => {
      const { store, setSnapshot } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      await expect(result.current.retryFailed()).resolves.toBe(false)
      act(() =>
        setSnapshot({
          failed: [{ path: 'a.json', kind: 'other' }],
          corrupt: [],
          permissionLost: false,
          backupsHealthy: true,
        }),
      )
      await expect(result.current.retryFailed()).resolves.toBe(true)
    })
  })

  describe('backups', () => {
    const entry: BackupEntry = {
      path: 'balances/2026.csv',
      backupPath: '_backups/balances/2026/20261101T090000000Z.csv',
      stamp: '20261101T090000000Z',
      unsaved: false,
      size: 12,
    }

    it('lists the copies the store reports', async () => {
      const { store } = makeFakeStore()
      store.listBackups.mockResolvedValue([entry])
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      await expect(result.current.listBackups()).resolves.toEqual([entry])
    })

    it('restores through the store, then tells the app to refresh its data', async () => {
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      const changed = vi.fn()
      window.addEventListener('data-changed', changed)

      await act(() => result.current.restoreBackup(entry))

      expect(store.restoreBackup).toHaveBeenCalledWith(entry)
      expect(changed).toHaveBeenCalledTimes(1)
      window.removeEventListener('data-changed', changed)
    })

    it('does not refresh the app when the restore fails', async () => {
      const { store } = makeFakeStore()
      store.restoreBackup.mockRejectedValue(new Error('disk gone'))
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      const changed = vi.fn()
      window.addEventListener('data-changed', changed)

      await expect(result.current.restoreBackup(entry)).rejects.toThrow('disk gone')

      expect(changed).not.toHaveBeenCalled()
      window.removeEventListener('data-changed', changed)
    })

    it('is inert when the net is off', async () => {
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, false)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      const changed = vi.fn()
      window.addEventListener('data-changed', changed)

      await expect(result.current.listBackups()).resolves.toEqual([])
      await result.current.restoreBackup(entry)

      expect(store.listBackups).not.toHaveBeenCalled()
      expect(store.restoreBackup).not.toHaveBeenCalled()
      expect(changed).not.toHaveBeenCalled()
      window.removeEventListener('data-changed', changed)
    })

    it('has an inert default without a provider', async () => {
      const { result } = renderHook(() => useSafetyNet())
      await expect(result.current.listBackups()).resolves.toEqual([])
      await expect(result.current.restoreBackup(entry)).resolves.toBeUndefined()
      await expect(result.current.resolveCorrupt('accounts.json', 'start-fresh')).resolves.toBeNull()
    })
  })

  describe('resolveCorrupt', () => {
    const entry: BackupEntry = {
      path: 'accounts.json',
      backupPath: '_backups/accounts/20261108T120000000Z.json',
      stamp: '20261108T120000000Z',
      unsaved: false,
      size: 10,
    }

    it('restoring a backup tells the app to refresh its data', async () => {
      const { store } = makeFakeStore()
      store.resolveCorrupt.mockResolvedValue(entry)
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      const changed = vi.fn()
      window.addEventListener('data-changed', changed)

      await expect(result.current.resolveCorrupt('accounts.json', 'restore-latest')).resolves.toBe(entry)

      expect(store.resolveCorrupt).toHaveBeenCalledWith('accounts.json', 'restore-latest')
      expect(changed).toHaveBeenCalledTimes(1)
      window.removeEventListener('data-changed', changed)
    })

    it('starting fresh does not need a refresh', async () => {
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      const changed = vi.fn()
      window.addEventListener('data-changed', changed)

      await expect(result.current.resolveCorrupt('accounts.json', 'start-fresh')).resolves.toBeNull()

      expect(changed).not.toHaveBeenCalled()
      window.removeEventListener('data-changed', changed)
    })

    it('passes a failure on to the caller without refreshing', async () => {
      const { store } = makeFakeStore()
      store.resolveCorrupt.mockRejectedValue(new Error('disk gone'))
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      const changed = vi.fn()
      window.addEventListener('data-changed', changed)

      await expect(result.current.resolveCorrupt('accounts.json', 'restore-latest')).rejects.toThrow('disk gone')

      expect(changed).not.toHaveBeenCalled()
      window.removeEventListener('data-changed', changed)
    })

    it('is inert when the net is off', async () => {
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, false)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })

      await expect(result.current.resolveCorrupt('accounts.json', 'restore-latest')).resolves.toBeNull()

      expect(store.resolveCorrupt).not.toHaveBeenCalled()
    })
  })

  describe('focus permission check', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
    })

    const setup = () => {
      const fake = makeFakeStore()
      const { Wrapper } = makeWrapper(fake.store, true)
      const view = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      return { ...fake, ...view }
    }

    it('checks permission when the window gains focus', () => {
      const { store } = setup()
      window.dispatchEvent(new Event('focus'))
      expect(store.checkPermission).toHaveBeenCalledTimes(1)
    })

    it('checks permission when the tab becomes visible', () => {
      const { store } = setup()
      document.dispatchEvent(new Event('visibilitychange'))
      expect(store.checkPermission).toHaveBeenCalledTimes(1)
    })

    it('skips the check while the document is hidden', () => {
      const { store } = setup()
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      window.dispatchEvent(new Event('focus'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      expect(store.checkPermission).not.toHaveBeenCalled()
    })

    it('throttles checks to one every five seconds', () => {
      const { store } = setup()
      window.dispatchEvent(new Event('focus'))
      vi.setSystemTime(Date.now() + 4999)
      window.dispatchEvent(new Event('focus'))
      expect(store.checkPermission).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 1)
      window.dispatchEvent(new Event('focus'))
      expect(store.checkPermission).toHaveBeenCalledTimes(2)
    })

    it('logs a failed check instead of throwing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { store } = setup()
      store.checkPermission.mockRejectedValueOnce(new Error('nope'))
      window.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Permission check failed:', expect.any(Error)))
    })

    it('stops listening on unmount', () => {
      const { store, unmount } = setup()
      unmount()
      window.dispatchEvent(new Event('focus'))
      expect(store.checkPermission).not.toHaveBeenCalled()
    })
  })

  describe('reconnect', () => {
    const permissionLost: SafetySnapshot = { failed: [], corrupt: [], permissionLost: true, backupsHealthy: true }

    it('requests permission and stays not-denied when granted', async () => {
      const { store, setSnapshot } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      act(() => setSnapshot(permissionLost))
      await act(() => result.current.reconnect())
      expect(store.requestReconnect).toHaveBeenCalledTimes(1)
      expect(result.current.reconnectDenied).toBe(false)
    })

    it('marks reconnect as denied when the user declines, and resets once access returns', async () => {
      const { store, setSnapshot } = makeFakeStore()
      store.requestReconnect.mockResolvedValue('denied')
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      act(() => setSnapshot(permissionLost))
      await act(() => result.current.reconnect())
      expect(result.current.reconnectDenied).toBe(true)
      act(() => setSnapshot(EMPTY_SAFETY_SNAPSHOT))
      expect(result.current.reconnectDenied).toBe(false)
    })

    it('treats a throwing permission request as denied', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { store } = makeFakeStore()
      store.requestReconnect.mockRejectedValue(new Error('no gesture'))
      const { Wrapper } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      await act(() => result.current.reconnect())
      expect(result.current.reconnectDenied).toBe(true)
      expect(errorSpy).toHaveBeenCalled()
    })

    it('does nothing when inert', async () => {
      const { Wrapper } = makeWrapper(new MemoryFileStore(), true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      await act(() => result.current.reconnect())
      expect(result.current.reconnectDenied).toBe(false)
    })
  })

  describe('chooseFolderAgain', () => {
    it('opens the folder picker', async () => {
      const { store } = makeFakeStore()
      const { Wrapper, pickFolder } = makeWrapper(store, true)
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      await act(() => result.current.chooseFolderAgain())
      expect(pickFolder).toHaveBeenCalledTimes(1)
    })

    it('stays quiet when the picker is dismissed', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true, vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')))
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      await act(() => result.current.chooseFolderAgain())
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('logs unexpected picker errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { store } = makeFakeStore()
      const { Wrapper } = makeWrapper(store, true, vi.fn().mockRejectedValue(new Error('unsupported-browser')))
      const { result } = renderHook(() => useSafetyNet(), { wrapper: Wrapper })
      await act(() => result.current.chooseFolderAgain())
      expect(errorSpy).toHaveBeenCalledWith('Choose folder failed:', expect.any(Error))
    })
  })
})
