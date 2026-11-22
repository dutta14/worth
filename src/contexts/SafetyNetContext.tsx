import {
  createContext,
  FC,
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
import { FLAGS } from '../flags/flagDefinitions'
import { useFlag } from '../flags/useFlag'
import { usePageHideFlush } from '../hooks/usePageHideFlush'
import { isSafetyNetStore } from '../utils/fileStoreTypes'
import { EMPTY_SAFETY_SNAPSHOT } from '../utils/safetyNet'
import type { SafetySnapshot } from '../utils/safetyNet'

const FOCUS_CHECK_MIN_INTERVAL_MS = 5000

export interface SafetyNetContextValue {
  /** True only for a real folder with the `data-safety-net` flag on. */
  enabled: boolean
  snapshot: SafetySnapshot
  /** True after the user declined the reconnect prompt. */
  reconnectDenied: boolean
  /** Resolves true when at least one write still fails after the retry. */
  retryFailed: () => Promise<boolean>
  /** Must be called directly from a click handler: the browser requires a user gesture. */
  reconnect: () => Promise<void>
  chooseFolderAgain: () => Promise<void>
}

const noop = async (): Promise<void> => {}
const noRetry = async (): Promise<boolean> => false

const defaultValue: SafetyNetContextValue = {
  enabled: false,
  snapshot: EMPTY_SAFETY_SNAPSHOT,
  reconnectDenied: false,
  retryFailed: noRetry,
  reconnect: noop,
  chooseFolderAgain: noop,
}

export const SafetyNetContext = createContext<SafetyNetContextValue>(defaultValue)

/** Components without a provider (tests, stories) get an inert default, like `useFileStore`. */
export const useSafetyNet = (): SafetyNetContextValue => useContext(SafetyNetContext)

const subscribeNothing = (): (() => void) => () => {}
const getEmptySnapshot = (): SafetySnapshot => EMPTY_SAFETY_SNAPSHOT

export const SafetyNetProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const flagOn = useFlag(FLAGS.DATA_SAFETY_NET)
  const { fileStore, pickFolder } = useFileStore()
  const [reconnectDenied, setReconnectDenied] = useState(false)
  const lastCheckRef = useRef(0)

  const store = useMemo(
    () =>
      flagOn && isSafetyNetStore(fileStore) && fileStore.getHandle() !== null && !isDemoActive() ? fileStore : null,
    [flagOn, fileStore],
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

  const value = useMemo<SafetyNetContextValue>(
    () => ({ enabled: store !== null, snapshot, reconnectDenied, retryFailed, reconnect, chooseFolderAgain }),
    [store, snapshot, reconnectDenied, retryFailed, reconnect, chooseFolderAgain],
  )

  return <SafetyNetContext.Provider value={value}>{children}</SafetyNetContext.Provider>
}

export default SafetyNetContext
