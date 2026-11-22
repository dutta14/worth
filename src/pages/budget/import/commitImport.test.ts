import { describe, it, expect, vi } from 'vitest'
import { emptyStore, planFromTexts, storeWithMonths } from '../../../test/importHelpers'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import type { FileStore } from '../../../utils/fileStoreTypes'
import type { BudgetStore } from '../types'
import { canUndoImport, executeImport, executeUndo, type CommitResult } from './commitImport'
import f02b from './fixtures/F02b-transaction-date.csv?raw'
import f05 from './fixtures/F05-two-month-span.csv?raw'

const OCT = 'Date,Category,Amount,Description\n2026-10-01,Salary,3200.00,Payroll Acme Corp'

/** A file store whose writes to chosen paths fail, to exercise rollback. */
function failingStore(failOn: (path: string, call: number) => boolean) {
  const memory = new MemoryFileStore()
  const calls: string[] = []
  const store = Object.create(memory) as FileStore
  const wrap = (name: 'writeCSV' | 'writeJSON') => {
    store[name] = (async (path: string, data: never) => {
      calls.push(`${name}:${path}`)
      if (failOn(path, calls.length)) throw new Error('disk full')
      return (memory[name] as (p: string, d: never) => Promise<void>)(path, data)
    }) as never
  }
  wrap('writeCSV')
  wrap('writeJSON')
  return { store, memory, calls }
}

const okResult = (result: CommitResult) => {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`)
  return result
}

describe('executeImport', () => {
  it('writes only the touched months and categories.json, and returns the merged store', async () => {
    const fileStore = new MemoryFileStore()
    const store = storeWithMonths({ '2026-09': OCT })
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    const { result, store: next } = await executeImport({ fileStore, store, plan })

    const ok = okResult(result)
    expect(ok.months).toEqual(['2026-10', '2026-11'])
    expect(ok.imported).toBe(plan.totals.newRows)
    expect(await fileStore.listFiles('transactions/2026')).toEqual(['2026-10.csv', '2026-11.csv'])
    expect(await fileStore.exists('budget/categories.json')).toBe(true)
    expect(next?.csvs['2026-09']).toBe(store.csvs['2026-09'])
    expect(next?.years).toContain(2026)
  })

  it('merges into an existing month, keeping its rows byte for byte', async () => {
    const fileStore = new MemoryFileStore()
    const plan = planFromTexts([{ name: 'a.csv', text: 'Date,Description,Amount\n2026-10-05,Tea,-3.00' }])
    const { store: next } = await executeImport({ fileStore, store: storeWithMonths({ '2026-10': OCT }), plan })
    expect(next?.csvs['2026-10'].csv.split('\n')).toEqual([
      'Date,Category,Amount,Description',
      '2026-10-01,Salary,3200.00,Payroll Acme Corp',
      '2026-10-05,Uncategorized,-3.00,Tea',
    ])
  })

  it('adds the fallback categories to the matching Others groups', async () => {
    const plan = planFromTexts([{ name: 'f02b.csv', text: f02b }])
    const { store: next } = await executeImport({ fileStore: new MemoryFileStore(), store: emptyStore(), plan })
    const groups = next?.categoryGroups ?? []
    expect(groups.find(g => g.id === 'others')?.categories).toContain('Uncategorized')
    expect(groups.find(g => g.id === 'income-others')?.categories).toContain('Uncategorized income')
  })

  it('does nothing to storage when the plan adds no rows', async () => {
    const fileStore = new MemoryFileStore()
    const spy = vi.spyOn(fileStore, 'writeCSV')
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    const { store: after } = await executeImport({ fileStore, store: emptyStore(), plan })
    const again = planFromTexts([{ name: 'f05.csv', text: f05 }], {
      existing: Object.fromEntries(Object.entries(after?.csvs ?? {}).map(([m, c]) => [m, c.csv])),
    })
    spy.mockClear()
    const { result } = await executeImport({ fileStore, store: after!, plan: again })
    expect(okResult(result).months).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports an unmergeable month before writing anything', async () => {
    const fileStore = new MemoryFileStore()
    const spy = vi.spyOn(fileStore, 'writeCSV')
    const store = storeWithMonths({ '2026-11': 'foo,bar\n1,2' })
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    const { result, store: next } = await executeImport({ fileStore, store, plan })
    expect(result).toMatchObject({ ok: false, reason: 'unmergeable', failedMonths: ['2026-11'] })
    expect(next).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('still imports when the pre-import snapshot throws, and says so', async () => {
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    const snapshot = vi.fn().mockRejectedValue(new Error('no backup'))
    const { result } = await executeImport({ fileStore: new MemoryFileStore(), store: emptyStore(), plan, snapshot })
    expect(snapshot).toHaveBeenCalledWith('import')
    expect(okResult(result).snapshotFailed).toBe(true)
  })

  it('takes the snapshot before the first write', async () => {
    const fileStore = new MemoryFileStore()
    const order: string[] = []
    vi.spyOn(fileStore, 'writeCSV').mockImplementation(async () => {
      order.push('write')
    })
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    await executeImport({
      fileStore,
      store: emptyStore(),
      plan,
      snapshot: async () => {
        order.push('snapshot')
      },
    })
    expect(order[0]).toBe('snapshot')
  })

  it('restores every touched month and reports the failure when one month cannot be written', async () => {
    const { store: fileStore, memory } = failingStore(path => path.endsWith('2026-11.csv'))
    await memory.writeCSV('transactions/2026/2026-10.csv', [
      ['Date', 'Category', 'Amount', 'Description'],
      ['2026-10-01', 'Salary', '3200.00', 'Payroll Acme Corp'],
    ])
    const store = storeWithMonths({ '2026-10': OCT })
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    const { result, store: next } = await executeImport({ fileStore, store, plan })

    expect(result).toEqual({
      ok: false,
      reason: 'write',
      failedMonths: ['2026-11'],
      categoriesFailed: false,
      restored: true,
    })
    expect(next).toBeNull()
    expect((await memory.readCSV('transactions/2026/2026-10.csv')).map(r => r.join(','))).toEqual(OCT.split('\n'))
    expect(await memory.exists('transactions/2026/2026-11.csv')).toBe(false)
    expect(await memory.exists('budget/categories.json')).toBe(false)
  })

  it('reports that categories failed and restores months when categories.json cannot be written', async () => {
    const { store: fileStore, memory } = failingStore(path => path === 'budget/categories.json')
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    const { result } = await executeImport({ fileStore, store: emptyStore(), plan })
    expect(result).toMatchObject({ ok: false, reason: 'write', categoriesFailed: true, restored: true })
    expect(await memory.listFiles('transactions/2026')).toEqual([])
  })

  it('says the restore was incomplete when putting a month back also fails', async () => {
    let writes = 0
    const { store: fileStore } = failingStore(path => {
      if (path.endsWith('2026-10.csv')) return ++writes > 1
      return path.endsWith('2026-11.csv')
    })
    const store = storeWithMonths({ '2026-10': OCT })
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    const { result } = await executeImport({ fileStore, store, plan })
    expect(result).toMatchObject({ ok: false, restored: false })
  })

  it('replaces months when asked to', async () => {
    const plan = planFromTexts([{ name: 'a.csv', text: 'Date,Description,Amount\n2026-10-05,Tea,-3.00' }], {
      options: { skipDuplicates: true, replaceMonths: true },
    })
    const { store: next } = await executeImport({
      fileStore: new MemoryFileStore(),
      store: storeWithMonths({ '2026-10': OCT }),
      plan,
    })
    expect(next?.csvs['2026-10'].csv.split('\n')).toEqual([
      'Date,Category,Amount,Description',
      '2026-10-05,Uncategorized,-3.00,Tea',
    ])
  })

  it('never doubles rows when the same file is imported twice', async () => {
    const fileStore = new MemoryFileStore()
    let store: BudgetStore = emptyStore()
    for (let i = 0; i < 2; i++) {
      const plan = planFromTexts([{ name: 'f05.csv', text: f05 }], {
        existing: Object.fromEntries(Object.entries(store.csvs).map(([m, c]) => [m, c.csv])),
      })
      const { store: next } = await executeImport({ fileStore, store, plan })
      store = next ?? store
    }
    const rows = Object.values(store.csvs).flatMap(c => c.csv.split('\n').slice(1))
    expect(rows).toHaveLength(f05.trim().split('\n').length - 1)
  })
})

describe('undo', () => {
  const importOnce = async (store: BudgetStore, fileStore = new MemoryFileStore()) => {
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    const { result, store: next } = await executeImport({ fileStore, store, plan })
    return { fileStore, record: okResult(result).undo, next: next! }
  }

  it('is available right after the import and unavailable once a month changes', async () => {
    const { record, next } = await importOnce(emptyStore())
    expect(canUndoImport(record, next)).toBe(true)
    const edited = {
      ...next,
      csvs: {
        ...next.csvs,
        '2026-10': { ...next.csvs['2026-10'], csv: `${next.csvs['2026-10'].csv}\n2026-10-09,X,-1.00,Y` },
      },
    }
    expect(canUndoImport(record, edited)).toBe(false)
    const missing = { ...next, csvs: {} }
    expect(canUndoImport(record, missing)).toBe(false)
  })

  it('removes months the import created, plus the categories and year it added', async () => {
    const { fileStore, record, next } = await importOnce(emptyStore())
    const { result, store: undone } = await executeUndo({ fileStore, store: next, record })
    expect(result).toEqual({ ok: true })
    expect(undone?.csvs).toEqual({})
    expect(undone?.years).toEqual([])
    expect(undone?.categoryGroups?.flatMap(g => g.categories)).toEqual([])
    expect(await fileStore.listFiles('transactions/2026')).toEqual([])
  })

  it('puts back the text of months that existed before', async () => {
    const before = storeWithMonths({ '2026-10': OCT })
    const { fileStore, record, next } = await importOnce(before)
    const { store: undone } = await executeUndo({ fileStore, store: next, record })
    expect(undone?.csvs['2026-10'].csv).toBe(OCT)
    expect(undone?.csvs['2026-11']).toBeUndefined()
    expect((await fileStore.readCSV('transactions/2026/2026-10.csv')).map(r => r.join(','))).toEqual(OCT.split('\n'))
  })

  it('keeps a year that still has data from before', async () => {
    const before = storeWithMonths({ '2026-09': OCT })
    const { fileStore, record, next } = await importOnce(before)
    const { store: undone } = await executeUndo({ fileStore, store: next, record })
    expect(undone?.years).toEqual([2026])
  })

  it('reports failure when a restore write fails', async () => {
    const before = storeWithMonths({ '2026-10': OCT })
    const { record, next } = await importOnce(before)
    const { store: fileStore } = failingStore(path => path.endsWith('2026-10.csv'))
    const { result, store: undone } = await executeUndo({ fileStore, store: next, record })
    expect(result).toEqual({ ok: false, failedMonths: ['2026-10'] })
    expect(undone).toBeNull()
  })

  it('reports failure when a created month cannot be deleted', async () => {
    const { record, next } = await importOnce(emptyStore())
    const fileStore = new MemoryFileStore()
    vi.spyOn(fileStore, 'delete').mockRejectedValue(new Error('locked'))
    const { result } = await executeUndo({ fileStore, store: next, record })
    expect(result).toEqual({ ok: false, failedMonths: ['2026-10', '2026-11'] })
  })
})
