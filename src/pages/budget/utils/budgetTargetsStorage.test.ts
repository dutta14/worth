import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { TARGETS_PATH, loadBudgetTargets, saveBudgetTargets } from './budgetTargetsStorage'
import type { BudgetTargetsFile } from './budgetTargets'

const SAMPLE: BudgetTargetsFile = {
  version: 1,
  groups: {
    dining: { label: 'Dining', history: [{ from: null, monthly: 500 }] },
  },
}

let store: MemoryFileStore

beforeEach(() => {
  store = new MemoryFileStore()
})

// MemoryFileStore has no raw-text writer, so corrupt content is staged through a spied readJSON.
async function stageUnreadable(content: unknown): Promise<void> {
  await store.writeJSON(TARGETS_PATH, { staged: true })
  vi.spyOn(store, 'readJSON').mockResolvedValue(content as never)
}

describe('TARGETS_PATH', () => {
  it('is budget/targets.json', () => {
    expect(TARGETS_PATH).toBe('budget/targets.json')
  })
})

describe('loadBudgetTargets', () => {
  it('returns an empty ready file when budget/targets.json does not exist', async () => {
    expect(await loadBudgetTargets(store)).toEqual({ state: 'ready', targets: { version: 1, groups: {} } })
  })

  it('does not write when the file is missing', async () => {
    const write = vi.spyOn(store, 'writeJSON')
    await loadBudgetTargets(store)
    expect(write).not.toHaveBeenCalled()
  })

  it('loads an existing file', async () => {
    await store.writeJSON(TARGETS_PATH, SAMPLE)
    expect(await loadBudgetTargets(store)).toEqual({ state: 'ready', targets: SAMPLE })
  })

  it('normalizes entries on load', async () => {
    await store.writeJSON(TARGETS_PATH, {
      version: 1,
      groups: {
        dining: {
          history: [
            { from: '2026-11', monthly: 600 },
            { from: null, monthly: 500 },
            { from: 'bad', monthly: 1 },
          ],
        },
        broken: 'nope',
      },
    })
    expect(await loadBudgetTargets(store)).toEqual({
      state: 'ready',
      targets: {
        version: 1,
        groups: {
          dining: {
            history: [
              { from: null, monthly: 500 },
              { from: '2026-11', monthly: 600 },
            ],
          },
        },
      },
    })
  })

  it('reports an unreadable file when it exists but JSON parsing failed (reads as the null fallback)', async () => {
    await stageUnreadable(null)
    expect(await loadBudgetTargets(store)).toEqual({ state: 'unreadable' })
  })

  it('reports an unreadable file for a newer version', async () => {
    await store.writeJSON(TARGETS_PATH, { version: 2, groups: {} })
    expect(await loadBudgetTargets(store)).toEqual({ state: 'unreadable' })
  })

  it.each([[[]], ['text'], [{ version: 1 }]])('reports an unreadable file for the wrong shape %j', async content => {
    await store.writeJSON(TARGETS_PATH, content)
    expect(await loadBudgetTargets(store)).toEqual({ state: 'unreadable' })
  })

  it('reports unreadable instead of throwing when the store fails', async () => {
    vi.spyOn(store, 'exists').mockRejectedValue(new Error('permission denied'))
    expect(await loadBudgetTargets(store)).toEqual({ state: 'unreadable' })
  })
})

describe('saveBudgetTargets', () => {
  it('writes the file to budget/targets.json', async () => {
    expect(await saveBudgetTargets(store, SAMPLE)).toEqual({ ok: true })
    expect(await store.readJSON(TARGETS_PATH, null)).toEqual(SAMPLE)
  })

  it('overwrites a readable file', async () => {
    await store.writeJSON(TARGETS_PATH, SAMPLE)
    const next: BudgetTargetsFile = { version: 1, groups: {} }
    expect(await saveBudgetTargets(store, next)).toEqual({ ok: true })
    expect(await store.readJSON(TARGETS_PATH, null)).toEqual(next)
  })

  it('refuses to overwrite a file from a newer version', async () => {
    const newer = { version: 2, groups: { dining: { history: [{ from: null, monthly: 1 }], extra: true } } }
    await store.writeJSON(TARGETS_PATH, newer)
    expect(await saveBudgetTargets(store, SAMPLE)).toEqual({ ok: false, reason: 'unreadable' })
    expect(await store.readJSON(TARGETS_PATH, null)).toEqual(newer)
  })

  it('refuses to overwrite a corrupt file', async () => {
    await stageUnreadable(null)
    const write = vi.spyOn(store, 'writeJSON')
    expect(await saveBudgetTargets(store, SAMPLE)).toEqual({ ok: false, reason: 'unreadable' })
    expect(write).not.toHaveBeenCalled()
  })

  it('propagates a failed write so callers can roll back', async () => {
    vi.spyOn(store, 'writeJSON').mockRejectedValue(new Error('disk full'))
    await expect(saveBudgetTargets(store, SAMPLE)).rejects.toThrow('disk full')
  })

  it('notifies subscribers of budget/targets.json on write', async () => {
    const cb = vi.fn()
    store.subscribe(TARGETS_PATH, cb)
    await saveBudgetTargets(store, SAMPLE)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
