import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_TEST_GROUPS, containsRule, storeWithMonths } from '../../../test/importHelpers'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import type { FileStore } from '../../../utils/fileStoreTypes'
import type { CategoryGroup } from '../types'
import { canUndoImport, executeUndo } from './commitImport'
import {
  countRuleImpact,
  executeRecategorize,
  isFallbackCategory,
  planRecategorize,
  toImpactRows,
} from './recategorize'
import { categoryResolver } from './rules'

const groups: CategoryGroup[] = [
  { id: 'food', name: 'Food', categories: ['Dining', 'Groceries'] },
  ...DEFAULT_TEST_GROUPS,
]
const resolve = categoryResolver(groups)

const OCT = [
  'Date,Category,Amount,Description,Notes',
  '2026-10-01,Uncategorized,-4.50,STARBUCKS #1,keep me',
  '2026-10-01,Uncategorized,-4.50,STARBUCKS #1,second',
  '2026-10-02,Dining,-9.00,STARBUCKS #2,',
  '2026-10-03,uncategorized,-30.00,Kroger 55,',
  '2026-10-04,Uncategorized,-1.00,Corner shop,',
].join('\n')
const NOV = 'Date,Category,Amount,Description\n2026-11-01,Uncategorized,-4.00,Starbucks'

const rules = [containsRule('r_01', 'starbucks', 'Dining'), containsRule('r_02', 'kroger', 'Groceries')]

describe('isFallbackCategory', () => {
  it.each(['Uncategorized', ' uncategorized ', 'UNCATEGORIZED INCOME', 'Uncategorized Income'])('accepts %s', name => {
    expect(isFallbackCategory(name)).toBe(true)
  })

  it('rejects a real category', () => {
    expect(isFallbackCategory('Dining')).toBe(false)
  })
})

describe('planRecategorize', () => {
  it('moves only fallback rows, by position, and keeps every other column', () => {
    const plan = planRecategorize({ '2026-10': { csv: OCT }, '2026-11': { csv: NOV } }, rules, resolve)

    expect(plan.changed).toBe(4)
    expect(Object.keys(plan.months)).toEqual(['2026-10', '2026-11'])
    expect(plan.months['2026-10'].changed).toBe(3)
    expect(plan.months['2026-10'].after).toContain('2026-10-01,Dining,-4.50,STARBUCKS #1,keep me')
    expect(plan.months['2026-10'].after).toContain('2026-10-01,Dining,-4.50,STARBUCKS #1,second')
    expect(plan.months['2026-10'].after).toContain('2026-10-03,Groceries,-30.00,Kroger 55')
    expect(plan.months['2026-10'].after).toContain('Corner shop')
    expect(plan.months['2026-10'].after).toContain('Uncategorized,-1.00,Corner shop')
  })

  it('leaves months with no change out of the plan', () => {
    const plan = planRecategorize({ '2026-10': { csv: OCT } }, [containsRule('r', 'zzz', 'Dining')], resolve)
    expect(plan).toEqual({ months: {}, changed: 0, skippedRules: 0 })
  })

  it('restricts the plan to one rule when asked', () => {
    const plan = planRecategorize({ '2026-10': { csv: OCT } }, rules, resolve, 'r_02')
    expect(plan.changed).toBe(1)
    expect(plan.months['2026-10'].after).toContain('Groceries')
    expect(plan.months['2026-10'].after).not.toContain('Dining,-4.50')
  })

  it('counts a rule whose category no longer exists as skipped and leaves the row alone', () => {
    const plan = planRecategorize({ '2026-10': { csv: OCT } }, [containsRule('r_x', 'kroger', 'Gone')], resolve)
    expect(plan.changed).toBe(0)
    expect(plan.skippedRules).toBe(1)
  })

  it('does not change a row whose rule category is already its category', () => {
    const plan = planRecategorize(
      { '2026-10': { csv: OCT } },
      [containsRule('r', 'corner', 'Uncategorized')],
      categoryResolver([...groups, { id: 'x', name: 'X', categories: ['Uncategorized'] }]),
    )
    expect(plan.changed).toBe(0)
  })

  it('skips rows with no date or amount, short files and files without the needed columns', () => {
    const csvs = {
      '2026-10': {
        csv: 'Date,Category,Amount,Description\n,Uncategorized,-4.50,Starbucks\n2026-10-02,Uncategorized,,Starbucks',
      },
      '2026-11': { csv: 'Date,Category,Amount,Description' },
      '2026-12': { csv: 'Foo,Bar\n1,2' },
    }
    expect(planRecategorize(csvs, rules, resolve).changed).toBe(0)
  })

  it('tolerates rows shorter than the header', () => {
    const csv = 'Date,Category,Amount,Description\n2026-10-01,Uncategorized,-4.50'
    expect(planRecategorize({ '2026-10': { csv } }, rules, resolve).changed).toBe(0)
  })
})

describe('executeRecategorize', () => {
  const setup = async () => {
    const fileStore = new MemoryFileStore()
    const store = storeWithMonths({ '2026-10': OCT, '2026-11': NOV }, { categoryGroups: groups })
    const plan = planRecategorize(store.csvs, rules, resolve)
    return { fileStore, store, plan }
  }

  it('writes the touched months, returns the new store and an undo record that restores them', async () => {
    const { fileStore, store, plan } = await setup()
    const { result, store: next } = await executeRecategorize({ fileStore, store, plan })

    expect(result).toMatchObject({ ok: true, changed: 4, months: ['2026-10', '2026-11'] })
    if (!result.ok) throw new Error('expected success')
    expect(next?.csvs['2026-10'].csv).toBe(plan.months['2026-10'].after)
    expect((await fileStore.readCSV('transactions/2026/2026-10.csv')).flat()).toContain('Groceries')
    expect(result.undo.addedCategories).toEqual([])

    expect(next && (await canUndoImport(result.undo, next))).toBe(true)
    const undone = await executeUndo({ fileStore, store: next ?? store, record: result.undo })
    expect(undone.result.ok).toBe(true)
    expect(undone.store?.csvs['2026-10'].csv).toBe(OCT)
  })

  it('refuses without writing when a month changed since the plan was made', async () => {
    const { fileStore, store, plan } = await setup()
    const changed = storeWithMonths({ '2026-10': `${OCT}\n2026-10-09,Uncategorized,-1,Extra`, '2026-11': NOV })
    const { result, store: next } = await executeRecategorize({ fileStore, store: changed, plan })

    expect(result).toEqual({ ok: false, reason: 'stale', failedMonths: ['2026-10'], restored: true })
    expect(next).toBeNull()
    expect(await fileStore.listFiles('transactions/2026')).toEqual([])
    expect(store.csvs['2026-10'].csv).toBe(OCT)
  })

  it('puts the months back and reports the failure when a write fails', async () => {
    const { store, plan } = await setup()
    const memory = new MemoryFileStore()
    const fileStore = Object.create(memory) as FileStore
    const write = memory.writeCSV.bind(memory)
    let calls = 0
    fileStore.writeCSV = vi.fn(async (path: string, rows: string[][]) => {
      calls++
      if (calls === 2) throw new Error('disk full')
      return write(path, rows)
    })

    const { result, store: next } = await executeRecategorize({ fileStore, store, plan })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reason).toBe('write')
    expect(result.failedMonths.length).toBeGreaterThan(0)
    expect(next).toBeNull()
  })
})

describe('countRuleImpact', () => {
  const rows = toImpactRows([
    { description: 'Starbucks #1', category: 'Uncategorized' },
    { description: 'STARBUCKS #2', category: 'Dining' },
    { description: 'Kroger', category: 'Uncategorized Income' },
    { description: undefined, category: 'Uncategorized' },
  ])

  it('counts every match and the uncategorized rows the new rule would move', () => {
    expect(countRuleImpact(rows, [], resolve, { value: 'starbucks', category: 'Dining' })).toEqual({
      matches: 2,
      applicable: 1,
    })
  })

  it('does not count a row an earlier rule already claims', () => {
    const earlier = [containsRule('r_01', 'starbucks', 'Groceries')]
    expect(countRuleImpact(rows, earlier, resolve, { value: 'starbucks', category: 'Dining' })).toEqual({
      matches: 2,
      applicable: 0,
    })
  })

  it('returns zero for a value that is too short', () => {
    expect(countRuleImpact(rows, [], resolve, { value: 's', category: 'Dining' })).toEqual({
      matches: 0,
      applicable: 0,
    })
  })

  it('still counts matches before a category is chosen', () => {
    expect(countRuleImpact(rows, [], resolve, { value: 'kroger', category: '' })).toEqual({
      matches: 1,
      applicable: 1,
    })
  })
})
