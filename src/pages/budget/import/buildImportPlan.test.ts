import { describe, it, expect } from 'vitest'
import { emptyStore, planFromTexts } from '../../../test/importHelpers'
import { parseCSV as parseLegacyCSV } from '../utils/csvParser'
import { buildImportPlan, fallbackCategoryFor, monthOf } from './buildImportPlan'
import type { NormalizedRow } from './types'
import f02b from './fixtures/F02b-transaction-date.csv?raw'
import f05 from './fixtures/F05-two-month-span.csv?raw'
import f11 from './fixtures/F11-legacy-canonical.csv?raw'
import f13 from './fixtures/F13-same-day-repeats.csv?raw'

const normalized = (over: Partial<NormalizedRow>): NormalizedRow => ({
  sourceRow: 1,
  date: '2026-10-02',
  amountCents: -100,
  description: 'x',
  category: null,
  ...over,
})

describe('fallbackCategoryFor / monthOf', () => {
  it('files income and zero or negative amounts under the right fallback', () => {
    expect(fallbackCategoryFor(100)).toBe('Uncategorized income')
    expect(fallbackCategoryFor(-100)).toBe('Uncategorized')
    expect(fallbackCategoryFor(0)).toBe('Uncategorized')
    expect(monthOf('2026-10-02')).toBe('2026-10')
  })
})

describe('buildImportPlan', () => {
  it('splits rows by the month of their own date', () => {
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }])
    expect(Object.keys(plan.months)).toEqual(['2026-10', '2026-11'])
    expect(plan.months['2026-10'].added.map(r => r.date)).toEqual(['2026-10-29', '2026-10-31'])
    expect(plan.months['2026-11'].added.length).toBeGreaterThan(0)
  })

  it('splits across a year boundary', () => {
    const plan = planFromTexts([
      { name: 'a.csv', text: 'Date,Description,Amount\n2025-12-31,A,-1.00\n2026-01-01,B,-2.00' },
    ])
    expect(Object.keys(plan.months)).toEqual(['2025-12', '2026-01'])
  })

  it('files uncategorized rows under the sign-based fallbacks and counts them', () => {
    const plan = planFromTexts([{ name: 'f02b.csv', text: f02b }])
    const rows = Object.values(plan.months).flatMap(m => m.added)
    expect(rows.find(r => r.description === 'Payroll Acme Corp')?.resolvedCategory).toBe('Uncategorized income')
    expect(rows.find(r => r.description === 'Starbucks')?.resolvedCategory).toBe('Uncategorized')
    expect(plan.fallbackCount).toBe(rows.length)
    expect(plan.newCategories).toEqual(
      expect.arrayContaining([
        { name: 'Uncategorized', group: 'expense' },
        { name: 'Uncategorized income', group: 'income' },
      ]),
    )
    expect(plan.totals.incomeCents).toBeGreaterThan(0)
    expect(plan.totals.spendingCents).toBeGreaterThan(0)
  })

  it('keeps the file category and does not count it as a fallback', () => {
    const plan = planFromTexts([{ name: 'f11.csv', text: f11 }])
    const rows = Object.values(plan.months).flatMap(m => m.added)
    expect(rows.every(r => !r.fallback)).toBe(true)
    expect(plan.fallbackCount).toBe(0)
    expect(plan.newCategories.map(c => c.name)).toEqual(expect.arrayContaining(['Salary', 'Dining', 'Gas']))
  })

  it('reuses the spelling of an existing category regardless of case', () => {
    const plan = planFromTexts(
      [{ name: 'a.csv', text: 'Date,Category,Amount,Description\n2026-10-01,dining,-5.00,Lunch' }],
      {
        groups: [
          { id: 'others', name: 'Others', categories: ['Dining'] },
          { id: 'income-others', name: 'Others', categories: [], type: 'income' },
        ],
      },
    )
    expect(plan.months['2026-10'].added[0].resolvedCategory).toBe('Dining')
    expect(plan.newCategories).toEqual([])
  })

  it('imports legacy-shaped files exactly as the legacy parser reads them', () => {
    const legacy = parseLegacyCSV(f11)
    const plan = planFromTexts([{ name: 'f11.csv', text: f11 }])
    const rows = Object.values(plan.months).flatMap(m => m.added)
    expect(rows.map(r => [r.date, r.resolvedCategory, r.amountCents / 100, r.description])).toEqual(
      legacy.map(t => [t.date, t.category, t.amount, t.description]),
    )
  })

  it('keeps same-day repeats on a first import and adds nothing on a re-import', () => {
    const first = planFromTexts([{ name: 'f13.csv', text: f13 }])
    const rows = first.months['2026-10'].added
    expect(rows.filter(r => r.description === 'Coffee Shop')).toHaveLength(2)

    const existing = {
      '2026-10': [
        'Date,Category,Amount,Description',
        ...rows.map(r => `${r.date},X,${r.amountCents / 100},${r.description}`),
      ].join('\n'),
    }
    const again = planFromTexts([{ name: 'f13.csv', text: f13 }], { existing })
    expect(again.totals.newRows).toBe(0)
    expect(again.totals.duplicates).toBe(rows.length)
    expect(again.months['2026-10'].duplicateRows).toHaveLength(rows.length)
    expect(again.months['2026-10'].existingCount).toBe(rows.length)
  })

  it('dedupes overlapping files in the same batch', () => {
    const plan = planFromTexts([
      { name: 'a.csv', text: f13 },
      { name: 'b.csv', text: f13 },
    ])
    expect(plan.files.map(f => [f.newRows, f.duplicates])).toEqual([
      [3, 0],
      [0, 3],
    ])
  })

  it('imports every row when skipping duplicates is off, still reporting them', () => {
    const existing = { '2026-10': 'Date,Category,Amount,Description\n2026-10-02,X,-4.25,Coffee Shop' }
    const plan = planFromTexts([{ name: 'f13.csv', text: f13 }], {
      existing,
      options: { skipDuplicates: false, replaceMonths: false },
    })
    expect(plan.totals.newRows).toBe(3)
    expect(plan.months['2026-10'].duplicateRows.length).toBeGreaterThan(0)
  })

  it('flags months that have a file even when its rows cannot be read', () => {
    const existing = {
      '2026-10': 'Transaction Date,Memo,Amount\n2026-10-02,Old,-1.00',
      '2026-11': '  \n',
    }
    const plan = planFromTexts([{ name: 'f05.csv', text: f05 }], { existing })
    expect(plan.months['2026-10']).toMatchObject({ existingCount: 0, hasExistingFile: true })
    expect(plan.months['2026-11']).toMatchObject({ existingCount: 0, hasExistingFile: false })
  })

  it('ignores stored rows when replacing months', () => {
    const existing = { '2026-10': 'Date,Category,Amount,Description\n2026-10-02,X,-4.25,Coffee Shop' }
    const plan = planFromTexts([{ name: 'f13.csv', text: f13 }], {
      existing,
      options: { skipDuplicates: true, replaceMonths: true },
    })
    expect(plan.totals.duplicates).toBe(0)
    expect(plan.totals.newRows).toBe(3)
  })

  it('carries skipped rows and tokenizer notices through with the file name', () => {
    const plan = buildImportPlan({
      files: [
        {
          name: 'bad.csv',
          rows: [normalized({})],
          skipped: [{ sourceRow: 4, reason: 'bad-date', raw: 'x' }],
          notices: ['Row 9 has an unterminated quote. It was skipped.'],
        },
      ],
      existingCsvs: {},
      categoryGroups: emptyStore().categoryGroups ?? [],
      options: { skipDuplicates: true, replaceMonths: false },
    })
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]).toMatchObject({ fileName: 'bad.csv', fileIndex: 0 })
    expect(plan.totals.skipped).toBe(1)
    expect(plan.notices).toEqual(['Row 9 has an unterminated quote. It was skipped.'])
  })
})
