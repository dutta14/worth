import { useEffect } from 'react'
import type { FileStore, SafetyNetStore } from '../utils/fileStoreTypes'

const startFlush = (store: SafetyNetStore): void => {
  store.flush().catch(error => console.error('Flush on page hide failed:', error))
}

/**
 * Starts every pending write as soon as the page is hidden or unloading, and
 * asks the browser to confirm leaving only when work is still unsaved.
 *
 * The browser gives no guarantee that async writes finish during a real close;
 * this shortens the window and protects tab switches, which keep the page alive.
 */
export function usePageHideFlush(store: (FileStore & SafetyNetStore) | null): void {
  useEffect(() => {
    if (!store) return

    const onPageHide = (): void => startFlush(store)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') startFlush(store)
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      startFlush(store)
      if (!store.hasUnsavedWork()) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [store])
}
