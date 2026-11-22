import { useEffect, useState } from 'react'

/**
 * The current time, refreshed when the tab becomes visible or the window regains focus.
 * No timers: a tab left open past midnight or a month change corrects itself on return.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const refresh = () => setNow(new Date())
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return now
}
