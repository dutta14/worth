import { describe, it, expect, vi } from 'vitest'
import { emptyStore, storeWithMonths } from '../../../test/importHelpers'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { monthCsvPath, saveMonths, SaveMonthsError } from './budgetStorage'

const CSV = 'Date,Category,Amount,Description\n2026-10-01,Salary,3200.00,Payroll'

describe('monthCsvPath', () => {
  it('places a month under its year folder', () => {
    expect(monthCsvPath('2026-10')).toBe('transactions/2026/2026-10.csv')
  })
})

describe('saveMonths', () => {
  it('writes only the named months plus categories.json and announces the change', async () => {
    const fileStore = new MemoryFileStore()
    const listener = vi.fn()
    window.addEventListener('budget-changed', listener)
    const store = storeWithMonths({ '2026-09': CSV, '2026-10': CSV })
    await saveMonths(fileStore, store, ['2026-10'])
    window.removeEventListener('budget-changed', listener)
    expect(await fileStore.listFiles('transactions/2026')).toEqual(['2026-10.csv'])
    expect(await fileStore.exists('budget/categories.json')).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('names the months that failed and does not write categories.json', async () => {
    const fileStore = new MemoryFileStore()
    vi.spyOn(fileStore, 'writeCSV').mockImplementation(async path => {
      if (path.endsWith('2026-11.csv')) throw new Error('disk full')
    })
    const store = storeWithMonths({ '2026-10': CSV, '2026-11': CSV })
    const error = await saveMonths(fileStore, store, ['2026-10', '2026-11']).catch(e => e)
    expect(error).toBeInstanceOf(SaveMonthsError)
    expect(error).toMatchObject({ failedMonths: ['2026-11'], categoriesFailed: false })
    expect(await fileStore.exists('budget/categories.json')).toBe(false)
  })

  it('reports a categories.json failure separately', async () => {
    const fileStore = new MemoryFileStore()
    vi.spyOn(fileStore, 'writeJSON').mockRejectedValue(new Error('read only'))
    const error = await saveMonths(fileStore, emptyStore(), []).catch(e => e)
    expect(error).toMatchObject({ failedMonths: [], categoriesFailed: true })
    expect(error.message).toContain('categories.json')
  })
})
