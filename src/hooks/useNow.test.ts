import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNow } from './useNow'

const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 8, 12, 0, 0))
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('useNow', () => {
  it('returns the current time on first render', () => {
    const { result } = renderHook(() => useNow())
    expect(result.current.getTime()).toBe(new Date(2026, 10, 8, 12, 0, 0).getTime())
  })

  it('does not change when time passes without an event', () => {
    const { result } = renderHook(() => useNow())
    const first = result.current
    act(() => {
      vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    })
    expect(result.current).toBe(first)
  })

  it('does not schedule any timers', () => {
    renderHook(() => useNow())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes when the window regains focus', () => {
    const { result } = renderHook(() => useNow())
    vi.setSystemTime(new Date(2026, 10, 9, 8, 0, 0))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current.getTime()).toBe(new Date(2026, 10, 9, 8, 0, 0).getTime())
  })

  it('refreshes when the tab becomes visible', () => {
    const { result } = renderHook(() => useNow())
    vi.setSystemTime(new Date(2026, 11, 1, 9, 0, 0))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.getTime()).toBe(new Date(2026, 11, 1, 9, 0, 0).getTime())
  })

  it('ignores visibilitychange while the tab is hidden', () => {
    const { result } = renderHook(() => useNow())
    const first = result.current
    setVisibility('hidden')
    vi.setSystemTime(new Date(2026, 11, 1, 9, 0, 0))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(first)
  })

  it('stops listening after unmount', () => {
    const { result, unmount } = renderHook(() => useNow())
    const first = result.current
    unmount()
    vi.setSystemTime(new Date(2026, 11, 1, 9, 0, 0))
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(result.current).toBe(first)
  })
})
