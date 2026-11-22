import { describe, it, expect } from 'vitest'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { loadSavingsOverrides, OVERRIDES_PATH } from './savingsOverrides'

describe('loadSavingsOverrides', () => {
  it('uses the file the Growth tab writes', () => {
    expect(OVERRIDES_PATH).toBe('savings-tracker-overrides.json')
  })

  it('returns an empty log when the file does not exist', async () => {
    expect(await loadSavingsOverrides(new MemoryFileStore())).toEqual({})
  })

  it('reads every known field per year', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON(OVERRIDES_PATH, { 2025: { grossIncome: 1, taxes: 2, netIncome: 3, savings: 4 } })
    expect(await loadSavingsOverrides(store)).toEqual({ 2025: { grossIncome: 1, taxes: 2, netIncome: 3, savings: 4 } })
  })

  it('keeps only finite numbers and drops years left with no fields', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON(OVERRIDES_PATH, {
      2024: { netIncome: '5', savings: null, taxes: true },
      2025: { netIncome: 10, savings: 'x', extra: 9 },
      2026: { netIncome: -3.5 },
      abc: { netIncome: 1 },
      2027: 'nope',
      2028: null,
    })
    expect(await loadSavingsOverrides(store)).toEqual({ 2025: { netIncome: 10 }, 2026: { netIncome: -3.5 } })
  })

  it.each([[null], [[1, 2]], ['text'], [42]])('returns an empty log for a non-object file (%j)', async raw => {
    const store = new MemoryFileStore()
    await store.writeJSON(OVERRIDES_PATH, raw)
    expect(await loadSavingsOverrides(store)).toEqual({})
  })

  it('lets read errors propagate', async () => {
    const store = new MemoryFileStore()
    store.readJSON = () => Promise.reject(new Error('disk'))
    await expect(loadSavingsOverrides(store)).rejects.toThrow('disk')
  })
})
