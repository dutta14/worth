import { describe, it, expect, vi } from 'vitest'
import { MemoryFileStore } from './memoryFileStore'
import { balanceFilePath, groupBalancesByYear, loadBalances, saveBalances } from './balanceStorage'
import type { BalanceEntry } from '../pages/data/types'

const entry = (id: number, month: string, balance = 100, accountId = 1): BalanceEntry => ({
  id,
  accountId,
  month,
  balance,
})

describe('groupBalancesByYear', () => {
  it('groups by the year in the month key and skips malformed months', () => {
    const grouped = groupBalancesByYear([
      entry(1, '2025-01'),
      entry(2, '2026-03'),
      entry(3, '2025-12'),
      entry(4, 'bad'),
    ])
    expect([...grouped.keys()]).toEqual(['2025', '2026'])
    expect(grouped.get('2025')).toHaveLength(2)
  })
})

describe('saveBalances', () => {
  it('writes one CSV per year with a header row', async () => {
    const store = new MemoryFileStore()
    await saveBalances(store, [entry(1, '2025-01', 10, 7), entry(2, '2026-02', 20)])
    await expect(store.readCSV(balanceFilePath(2025))).resolves.toEqual([
      ['month', 'accountId', 'balance'],
      ['2025-01', '7', '10'],
    ])
    await expect(store.readCSV(balanceFilePath(2026))).resolves.toEqual([
      ['month', 'accountId', 'balance'],
      ['2026-02', '1', '20'],
    ])
  })

  it('round-trips through loadBalances', async () => {
    const store = new MemoryFileStore()
    await saveBalances(store, [entry(1, '2025-01', 10), entry(2, '2026-02', 20)])
    const loaded = await loadBalances(store)
    expect(loaded.map(({ month, balance }) => ({ month, balance }))).toEqual([
      { month: '2025-01', balance: 10 },
      { month: '2026-02', balance: 20 },
    ])
  })

  it('queues every year write before the first one resolves', async () => {
    const store = new MemoryFileStore()
    const resolvers: (() => void)[] = []
    const writeCSV = vi
      .spyOn(store, 'writeCSV')
      .mockImplementation(() => new Promise<void>(resolve => resolvers.push(resolve)))
    const saving = saveBalances(store, [entry(1, '2024-01'), entry(2, '2025-01'), entry(3, '2026-01')])
    await Promise.resolve()
    expect(writeCSV).toHaveBeenCalledTimes(3)
    expect(writeCSV.mock.calls.map(([path]) => path)).toEqual([
      'balances/2024.csv',
      'balances/2025.csv',
      'balances/2026.csv',
    ])
    resolvers.forEach(resolve => resolve())
    await saving
  })

  it('deletes year files that no longer have entries and keeps unrelated files', async () => {
    const store = new MemoryFileStore()
    await store.writeCSV('balances/2023.csv', [['month', 'accountId', 'balance']])
    await store.writeCSV('balances/2024.csv', [['month', 'accountId', 'balance']])
    await store.writeCSV('balances/notes.csv', [['x']])
    await saveBalances(store, [entry(1, '2024-01')])
    expect(await store.exists('balances/2023.csv')).toBe(false)
    expect(await store.exists('balances/2024.csv')).toBe(true)
    expect(await store.exists('balances/notes.csv')).toBe(true)
  })

  it('does not delete a year it is writing', async () => {
    const store = new MemoryFileStore()
    await store.writeCSV('balances/2025.csv', [['old']])
    await saveBalances(store, [entry(1, '2025-05', 5)])
    await expect(store.readCSV('balances/2025.csv')).resolves.toEqual([
      ['month', 'accountId', 'balance'],
      ['2025-05', '1', '5'],
    ])
  })

  it('rejects when a write fails', async () => {
    const store = new MemoryFileStore()
    vi.spyOn(store, 'writeCSV').mockRejectedValue(new Error('disk full'))
    await expect(saveBalances(store, [entry(1, '2025-01')])).rejects.toThrow('disk full')
  })
})
