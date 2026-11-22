import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FileStoreContext } from '../../../contexts/FileStoreContext'
import type { FileStoreContextValue } from '../../../contexts/FileStoreContext'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import type { CategoryGroup } from '../types'
import type { BudgetTargetsFile } from '../utils/budgetTargets'
import { TARGETS_PATH } from '../utils/budgetTargetsStorage'
import { SAVE_ERROR_MESSAGE, currentMonthKey, useBudgetTargets } from './useBudgetTargets'

const GROUPS: CategoryGroup[] = [
  { id: 'dining', name: 'Dining', categories: ['Restaurants'] },
  { id: 'others', name: 'Others', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: [] },
]

const SAVED: BudgetTargetsFile = {
  version: 1,
  groups: { dining: { label: 'Dining', history: [{ from: null, monthly: 500 }] } },
}

let store: MemoryFileStore

const wrapper = ({ children }: { children: ReactNode }) => (
  <FileStoreContext.Provider value={{ fileStore: store, isReady: true } as unknown as FileStoreContextValue}>
    {children}
  </FileStoreContext.Provider>
)

interface HookProps {
  groups: CategoryGroup[]
  groupsLoaded: boolean
}

const setup = (initial: Partial<HookProps> = {}) =>
  renderHook((props: HookProps) => useBudgetTargets(props), {
    wrapper,
    initialProps: { groups: GROUPS, groupsLoaded: true, ...initial },
  })

const stageUnreadable = async (content: unknown) => {
  await store.writeJSON(TARGETS_PATH, { staged: true })
  vi.spyOn(store, 'readJSON').mockResolvedValue(content as never)
}

beforeEach(() => {
  store = new MemoryFileStore()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 18))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('currentMonthKey', () => {
  it('formats the local month as YYYY-MM', () => {
    expect(currentMonthKey(new Date(2026, 0, 5))).toBe('2026-01')
  })

  it('defaults to now', () => {
    expect(currentMonthKey()).toBe('2026-11')
  })
})

describe('useBudgetTargets', () => {
  describe('loading', () => {
    it('starts loading, then ready and empty when the file does not exist', async () => {
      const { result } = setup()
      expect(result.current.status).toBe('loading')
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(result.current.targets.groups).toEqual({})
    })

    it('loads an existing file', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(result.current.targets.groups.dining.history).toEqual([{ from: null, monthly: 500 }])
    })

    it('does not write while reading', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const write = vi.spyOn(store, 'writeJSON')
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(write).not.toHaveBeenCalled()
    })

    it('refreshes when another tab changes the file', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await store.writeJSON(TARGETS_PATH, SAVED)
      })

      await waitFor(() => expect(result.current.targets.groups.dining).toBeDefined())
    })

    it('stops listening after unmount', async () => {
      const { result, unmount } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const read = vi.spyOn(store, 'exists')
      unmount()
      await store.writeJSON(TARGETS_PATH, SAVED)
      expect(read).not.toHaveBeenCalled()
    })

    it('ignores a load that finishes after unmount', async () => {
      const { result, unmount } = setup()
      unmount()
      await Promise.resolve()
      expect(result.current.status).toBe('loading')
    })
  })

  describe('unreadable file', () => {
    it.each([
      ['corrupt JSON', 'not an object'],
      ['a newer version', { version: 2, groups: {} }],
    ])('goes unreadable for %s and applies no targets', async (_name, content) => {
      await stageUnreadable(content)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('unreadable'))
      expect(result.current.targets.groups).toEqual({})
    })

    it('never writes when setTarget is attempted', async () => {
      await stageUnreadable({ version: 2, groups: {} })
      const write = vi.spyOn(store, 'writeJSON')
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('unreadable'))

      let outcome: { ok: boolean } | undefined
      await act(async () => {
        outcome = await result.current.setTarget('dining', 'Dining', 500)
      })

      expect(outcome).toEqual({ ok: false })
      expect(write).not.toHaveBeenCalled()
    })

    it('leaves the file bytes unchanged when the file turns unreadable between load and save', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const write = vi.spyOn(store, 'writeJSON')
      vi.spyOn(store, 'readJSON').mockResolvedValue({ version: 9, groups: {} } as never)

      let outcome: { ok: boolean } | undefined
      await act(async () => {
        outcome = await result.current.setTarget('dining', 'Dining', 600)
      })

      expect(outcome).toEqual({ ok: false })
      expect(write).not.toHaveBeenCalled()
      expect(result.current.status).toBe('unreadable')
      expect(result.current.targets.groups).toEqual({})
      expect(result.current.message).toBe(SAVE_ERROR_MESSAGE)
    })
  })

  describe('setTarget', () => {
    it('writes a first target with from: null and announces it', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 500)
      })

      expect(result.current.message).toBe('Dining target set to $500 a month.')
      expect(await store.readJSON(TARGETS_PATH, null)).toEqual(SAVED)
    })

    it('updates state before the write resolves', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      let release: () => void = () => {}
      vi.spyOn(store, 'writeJSON').mockImplementation(
        () =>
          new Promise<void>(resolve => {
            release = resolve
          }),
      )

      let pending: Promise<{ ok: boolean }> | undefined
      act(() => {
        pending = result.current.setTarget('dining', 'Dining', 500)
      })
      await waitFor(() => expect(result.current.targets.groups.dining).toBeDefined())

      await act(async () => {
        release()
        await pending
      })
    })

    it('adds an entry from the current month when changing an existing target', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 600)
      })

      expect(result.current.targets.groups.dining.history).toEqual([
        { from: null, monthly: 500 },
        { from: '2026-11', monthly: 600 },
      ])
    })

    it('announces a cleared target and deletes a record that only had an always entry', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', null)
      })

      expect(result.current.message).toBe('Dining target cleared.')
      expect(result.current.targets.groups).toEqual({})
      expect(await store.readJSON(TARGETS_PATH, null)).toEqual({ version: 1, groups: {} })
    })

    it('skips the write and says so when the value is unchanged', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const write = vi.spyOn(store, 'writeJSON')

      let outcome: { ok: boolean } | undefined
      await act(async () => {
        outcome = await result.current.setTarget('dining', 'Dining', 500)
      })

      expect(outcome).toEqual({ ok: true })
      expect(result.current.message).toBe('Dining target is already $500 a month.')
      expect(write).not.toHaveBeenCalled()
    })

    it('skips the write silently when clearing a group that has no target', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const write = vi.spyOn(store, 'writeJSON')

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', null)
      })

      expect(result.current.message).toBe('')
      expect(write).not.toHaveBeenCalled()
    })

    it('stores 0 as a real target', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.setTarget('others', 'Others', 0)
      })

      expect(result.current.targets.groups.others.history).toEqual([{ from: null, monthly: 0 }])
      expect(result.current.message).toBe('Others target set to $0 a month.')
    })

    it('does nothing before the first load finishes', async () => {
      const { result } = setup()
      let outcome: { ok: boolean } | undefined
      await act(async () => {
        outcome = await result.current.setTarget('dining', 'Dining', 500)
      })
      expect(outcome).toEqual({ ok: false })
    })

    it.each(['removed', 'income-others', 'unknown-group'])(
      'refuses a target for %s once groups are loaded',
      async id => {
        const { result } = setup()
        await waitFor(() => expect(result.current.status).toBe('ready'))
        const write = vi.spyOn(store, 'writeJSON')

        let outcome: { ok: boolean } | undefined
        await act(async () => {
          outcome = await result.current.setTarget(id, 'X', 5)
        })

        expect(outcome).toEqual({ ok: false })
        expect(write).not.toHaveBeenCalled()
      },
    )

    it('accepts any group id before groups have loaded', async () => {
      const { result } = setup({ groupsLoaded: false, groups: [] })
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 500)
      })

      expect(await store.readJSON(TARGETS_PATH, null)).toEqual(SAVED)
    })
  })

  describe('write failure', () => {
    it('restores the previous state, reports the error and returns not ok', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      vi.spyOn(store, 'writeJSON').mockRejectedValue(new Error('disk gone'))

      let outcome: { ok: boolean } | undefined
      await act(async () => {
        outcome = await result.current.setTarget('dining', 'Dining', 900)
      })

      expect(outcome).toEqual({ ok: false })
      expect(result.current.targets.groups.dining.history).toEqual([{ from: null, monthly: 500 }])
      expect(result.current.message).toBe(SAVE_ERROR_MESSAGE)
      expect(result.current.status).toBe('ready')
    })
  })

  describe('overlapping edits with a failing coalesced write', () => {
    const rejectTogether = () => {
      let fail: () => void = () => {}
      const shared = new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error('disk gone'))
      })
      shared.catch(() => {})
      const write = vi.spyOn(store, 'writeJSON').mockImplementation(() => shared)
      return { fail, write }
    }

    it('reverts every unsaved edit, not just the last, and names them', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const { fail, write } = rejectTogether()

      let first: Promise<{ ok: boolean }> | undefined
      let second: Promise<{ ok: boolean }> | undefined
      act(() => {
        first = result.current.setTarget('dining', 'Dining', 600)
      })
      act(() => {
        second = result.current.setTarget('others', 'Others', 200)
      })
      await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
      expect(result.current.targets.groups.dining.history).toHaveLength(2)
      expect(result.current.targets.groups.others).toBeDefined()

      await act(async () => {
        fail()
        await Promise.all([first, second])
      })

      expect(await first).toEqual({ ok: false })
      expect(await second).toEqual({ ok: false })
      expect(result.current.targets.groups.dining.history).toEqual([{ from: null, monthly: 500 }])
      expect(result.current.targets.groups.others).toBeUndefined()
      expect(result.current.message).toBe(`${SAVE_ERROR_MESSAGE} Reverted: Dining, Others.`)
    })

    it('does not name reverted targets when only one edit failed', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      vi.spyOn(store, 'writeJSON').mockRejectedValue(new Error('disk gone'))

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 600)
      })

      expect(result.current.message).toBe(SAVE_ERROR_MESSAGE)
    })

    it('rolls back to the last confirmed save, keeping an earlier edit that was written', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 500)
      })
      vi.spyOn(store, 'writeJSON').mockRejectedValue(new Error('disk gone'))

      await act(async () => {
        await result.current.setTarget('others', 'Others', 200)
      })

      expect(Object.keys(result.current.targets.groups)).toEqual(['dining'])
    })
  })

  describe('announcements', () => {
    it('gives every announcement a new id, even when the text repeats', async () => {
      await store.writeJSON(TARGETS_PATH, SAVED)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 500)
      })
      const firstId = result.current.messageId
      const text = result.current.message
      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 500)
      })

      expect(result.current.message).toBe(text)
      expect(result.current.messageId).toBeGreaterThan(firstId)
    })

    it('announces a repeated save failure again', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      vi.spyOn(store, 'writeJSON').mockRejectedValue(new Error('disk gone'))

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 500)
      })
      const firstId = result.current.messageId
      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 500)
      })

      expect(result.current.message).toBe(SAVE_ERROR_MESSAGE)
      expect(result.current.messageId).toBeGreaterThan(firstId)
    })
  })

  describe('pruning', () => {
    const WITH_ORPHAN: BudgetTargetsFile = {
      version: 1,
      groups: {
        ...SAVED.groups,
        'expense-group-gone': { label: 'Gone', history: [{ from: null, monthly: 50 }] },
        'income-others': { label: 'Income', history: [{ from: null, monthly: 50 }] },
      },
    }

    it('keeps orphans while groups are still loading, so an empty first render cannot wipe targets', async () => {
      await store.writeJSON(TARGETS_PATH, WITH_ORPHAN)
      const { result } = setup({ groupsLoaded: false, groups: [] })
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(Object.keys(result.current.targets.groups)).toHaveLength(3)
    })

    it('hides orphans from the exposed targets once groups have loaded', async () => {
      await store.writeJSON(TARGETS_PATH, WITH_ORPHAN)
      const { result, rerender } = setup({ groupsLoaded: false, groups: [] })
      await waitFor(() => expect(result.current.status).toBe('ready'))

      rerender({ groups: GROUPS, groupsLoaded: true })

      expect(Object.keys(result.current.targets.groups)).toEqual(['dining'])
    })

    it('does not rewrite the file on read', async () => {
      await store.writeJSON(TARGETS_PATH, WITH_ORPHAN)
      const write = vi.spyOn(store, 'writeJSON')
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(write).not.toHaveBeenCalled()
    })

    it('drops orphans from the file on the next write', async () => {
      await store.writeJSON(TARGETS_PATH, WITH_ORPHAN)
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.setTarget('others', 'Others', 80)
      })

      const written = await store.readJSON<BudgetTargetsFile>(TARGETS_PATH, { version: 1, groups: {} })
      expect(Object.keys(written.groups).sort()).toEqual(['dining', 'others'])
    })

    it('does not prune on write while groups are still loading', async () => {
      await store.writeJSON(TARGETS_PATH, WITH_ORPHAN)
      const { result } = setup({ groupsLoaded: false, groups: [] })
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.setTarget('others', 'Others', 80)
      })

      const written = await store.readJSON<BudgetTargetsFile>(TARGETS_PATH, { version: 1, groups: {} })
      expect(Object.keys(written.groups)).toHaveLength(4)
    })
  })

  describe('local saves and the subscription', () => {
    it('does not reload over its own optimistic state while a save is in flight', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const exists = vi.spyOn(store, 'exists')

      await act(async () => {
        await result.current.setTarget('dining', 'Dining', 500)
      })

      expect(exists).toHaveBeenCalledTimes(1) // the pre-write safety check only
      expect(result.current.targets.groups.dining).toBeDefined()
    })
  })
})
