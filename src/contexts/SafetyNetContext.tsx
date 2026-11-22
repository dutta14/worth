import {
  createContext,
  FC,
  Fragment,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { isDemoActive, useFileStore } from './FileStoreContext'
import { usePageHideFlush } from '../hooks/usePageHideFlush'
import { isSafetyNetStore } from '../utils/fileStoreTypes'
import { EMPTY_SAFETY_SNAPSHOT } from '../utils/safetyNet'
import type { BackupEntry, CorruptAction, ExternalAction, SafetySnapshot } from '../utils/safetyNet'

const FOCUS_CHECK_MIN_INTERVAL_MS = 5000
const NOTICE_MS = 1000
const NOTICES: Record<ExternalAction, string> = {
  reload: 'Reloaded from disk. Any unsaved edits were kept in _backups.',
  keep: 'Saved your version. The previous version is in _backups.',
}

export interface SafetyNetContextValue {
  /** True only for a real folder, never in Demo Mode. */
  enabled: boolean
  snapshot: SafetySnapshot
  /** True after the user declined the reconnect prompt. */
  reconnectDenied: boolean
  /** Resolves true when at least one write still fails after the retry. */
  retryFailed: () => Promise<boolean>
  /** Must be called directly from a click handler: the browser requires a user gesture. */
  reconnect: () => Promise<void>
  chooseFolderAgain: () => Promise<void>
  /** Every copy in `_backups/`, newest first. Rejects when the folder cannot be read. */
  listBackups: () => Promise<BackupEntry[]>
  /** Replaces the file with the copy, then refreshes the visible data. Rejects with the file untouched. */
  restoreBackup: (entry: BackupEntry) => Promise<void>
  /**
   * Ends the hold on a corrupt JSON file, keeping its unreadable bytes. Resolves with the backup that was
   * restored (`null` for `start-fresh`). Rejects with the file untouched.
   */
  resolveCorrupt: (path: string, action: CorruptAction) => Promise<BackupEntry | null>
  /**
   * Ends the hold on files that changed on disk. `reload` discards this tab's version and remounts the app
   * shell so every page re-reads; `keep` overwrites the disk. Both keep what they replace in `_backups/`.
   * Rejects with the files untouched.
   */
  resolveExternal: (action: ExternalAction) => Promise<void>
  /** Status text for the banner's live region after a resolution; the banner may remount, so it lives here. */
  notice: string
}

const noop = async (): Promise<void> => {}
const noRetry = async (): Promise<boolean> => false
const noBackups = async (): Promise<BackupEntry[]> => []
const noResolution = async (): Promise<BackupEntry | null> => null

const defaultValue: SafetyNetContextValue = {
  enabled: false,
  snapshot: EMPTY_SAFETY_SNAPSHOT,
  reconnectDenied: false,
  retryFailed: noRetry,
  reconnect: noop,
  chooseFolderAgain: noop,
  listBackups: noBackups,
  restoreBackup: noop,
  resolveCorrupt: noResolution,
  resolveExternal: noop,
  notice: '',
}

export const SafetyNetContext = createContext<SafetyNetContextValue>(defaultValue)

/** Components without a provider (tests, stories) get an inert default, like `useFileStore`. */
export const useSafetyNet = (): SafetyNetContextValue => useContext(SafetyNetContext)

const subscribeNothing = (): (() => void) => () => {}
const getEmptySnapshot = (): SafetySnapshot => EMPTY_SAFETY_SNAPSHOT

export const SafetyNetProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { fileStore, pickFolder } = useFileStore()
  const [reconnectDenied, setReconnectDenied] = useState(false)
  const lastCheckRef = useRef(0)
  // Remounts the app shell after Reload so pages that read once on mount pick up the disk version.
  const [epoch, setEpoch] = useState(0)
  const [notice, setNotice] = useState('')

  const store = useMemo(
    () => (isSafetyNetStore(fileStore) && fileStore.getHandle() !== null && !isDemoActive() ? fileStore : null),
    [fileStore],
  )

  useEffect(() => {
    if (!store) return
    store.configureSafety({ enabled: true })
    return () => store.configureSafety({ enabled: false })
  }, [store])

  usePageHideFlush(store)

  useEffect(() => {
    if (!store) return
    const check = (): void => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastCheckRef.current < FOCUS_CHECK_MIN_INTERVAL_MS) return
      lastCheckRef.current = now
      store.checkPermission().catch(error => console.error('Permission check failed:', error))
      store.checkExternalChanges().catch(error => console.error('External change check failed:', error))
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [store])

  const subscribe = useCallback((cb: () => void) => (store ? store.subscribeSafety(cb) : subscribeNothing()), [store])
  const getSnapshot = useCallback(() => (store ? store.getSafetySnapshot() : getEmptySnapshot()), [store])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    if (!snapshot.permissionLost) setReconnectDenied(false)
  }, [snapshot.permissionLost])

  const retryFailed = useCallback(async () => {
    if (!store) return false
    await store.retryFailed()
    return store.getSafetySnapshot().failed.length > 0
  }, [store])

  const reconnect = useCallback(async () => {
    if (!store) return
    try {
      setReconnectDenied((await store.requestReconnect()) !== 'granted')
    } catch (error) {
      console.error('Reconnect failed:', error)
      setReconnectDenied(true)
    }
  }, [store])

  const chooseFolderAgain = useCallback(async () => {
    try {
      await pickFolder()
    } catch (error) {
      // Dismissing the picker is a normal outcome; the banner stays so the user can try again.
      if ((error as { name?: string })?.name !== 'AbortError') console.error('Choose folder failed:', error)
    }
  }, [pickFolder])

  const listBackups = useCallback(async () => (store ? store.listBackups() : []), [store])

  const restoreBackup = useCallback(
    async (entry: BackupEntry) => {
      if (!store) return
      await store.restoreBackup(entry)
      // Balances have no per-file subscription; DataContext refreshes them on this event.
      window.dispatchEvent(new Event('data-changed'))
    },
    [store],
  )

  const resolveCorrupt = useCallback(
    async (path: string, action: CorruptAction) => {
      if (!store) return null
      const restored = await store.resolveCorrupt(path, action)
      if (restored) window.dispatchEvent(new Event('data-changed'))
      return restored
    },
    [store],
  )

  const resolveExternal = useCallback(
    async (action: ExternalAction) => {
      if (!store) return
      if (action === 'keep') {
        await store.keepLocal()
        setNotice(NOTICES.keep)
        return
      }
      try {
        await store.reloadFromDisk()
      } finally {
        // Files reloaded before a failure still changed; balances only refresh on this event.
        window.dispatchEvent(new Event('data-changed'))
      }
      setNotice(NOTICES.reload)
      setEpoch(current => current + 1)
    },
    [store],
  )

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const focusedEpochRef = useRef(0)
  useEffect(() => {
    if (epoch === focusedEpochRef.current) return
    focusedEpochRef.current = epoch
    // The button that was pressed went away with the old shell; hand focus to the page instead of <body>.
    document.getElementById('main-content')?.focus()
  }, [epoch])

  const value = useMemo<SafetyNetContextValue>(
    () => ({
      enabled: store !== null,
      snapshot,
      reconnectDenied,
      retryFailed,
      reconnect,
      chooseFolderAgain,
      listBackups,
      restoreBackup,
      resolveCorrupt,
      resolveExternal,
      notice,
    }),
    [
      store,
      snapshot,
      reconnectDenied,
      retryFailed,
      reconnect,
      chooseFolderAgain,
      listBackups,
      restoreBackup,
      resolveCorrupt,
      resolveExternal,
      notice,
    ],
  )

  return (
    <SafetyNetContext.Provider value={value}>
      <Fragment key={epoch}>{children}</Fragment>
    </SafetyNetContext.Provider>
  )
}

export default SafetyNetContext
