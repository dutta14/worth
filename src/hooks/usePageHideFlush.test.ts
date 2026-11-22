import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePageHideFlush } from './usePageHideFlush'
import type { FileStore, SafetyNetStore } from '../utils/fileStoreTypes'

const makeStore = (unsaved = false) => {
  const store = {
    flush: vi.fn(async () => {}),
    hasUnsavedWork: vi.fn(() => unsaved),
  }
  return { store, asStore: store as unknown as FileStore & SafetyNetStore }
}

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

const fireBeforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

afterEach(() => {
  setVisibility('visible')
  vi.restoreAllMocks()
})

describe('usePageHideFlush', () => {
  it('flushes on pagehide', () => {
    const { store, asStore } = makeStore()
    renderHook(() => usePageHideFlush(asStore))
    window.dispatchEvent(new Event('pagehide'))
    expect(store.flush).toHaveBeenCalledTimes(1)
  })

  it('flushes when the page becomes hidden', () => {
    const { store, asStore } = makeStore()
    renderHook(() => usePageHideFlush(asStore))
    setVisibility('hidden')
    expect(store.flush).toHaveBeenCalledTimes(1)
  })

  it('does not flush when the page becomes visible', () => {
    const { store, asStore } = makeStore()
    renderHook(() => usePageHideFlush(asStore))
    setVisibility('visible')
    expect(store.flush).not.toHaveBeenCalled()
  })

  it('flushes on beforeunload but does not cancel it when nothing is unsaved', () => {
    const { store, asStore } = makeStore(false)
    renderHook(() => usePageHideFlush(asStore))
    const event = fireBeforeUnload()
    expect(store.flush).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it('cancels beforeunload when work is unsaved', () => {
    const { store, asStore } = makeStore(true)
    renderHook(() => usePageHideFlush(asStore))
    const event = fireBeforeUnload()
    expect(store.flush).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('logs instead of throwing when the flush fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, asStore } = makeStore()
    store.flush.mockRejectedValueOnce(new Error('disk'))
    renderHook(() => usePageHideFlush(asStore))
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Flush on page hide failed:', expect.any(Error)))
  })

  it('registers nothing without a store', () => {
    const add = vi.spyOn(window, 'addEventListener')
    renderHook(() => usePageHideFlush(null))
    expect(add).not.toHaveBeenCalledWith('pagehide', expect.anything())
    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.anything())
  })

  it('removes every listener on unmount', () => {
    const { store, asStore } = makeStore(true)
    const { unmount } = renderHook(() => usePageHideFlush(asStore))
    unmount()
    window.dispatchEvent(new Event('pagehide'))
    setVisibility('hidden')
    const event = fireBeforeUnload()
    expect(store.flush).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('re-registers for a new store', () => {
    const first = makeStore()
    const second = makeStore()
    const { rerender } = renderHook(({ s }) => usePageHideFlush(s), { initialProps: { s: first.asStore } })
    rerender({ s: second.asStore })
    window.dispatchEvent(new Event('pagehide'))
    expect(first.store.flush).not.toHaveBeenCalled()
    expect(second.store.flush).toHaveBeenCalledTimes(1)
  })
})
