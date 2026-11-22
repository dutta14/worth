import { describe, it, expect } from 'vitest'
import { appendRowsToMonthCsv, formatCents, readExistingRows, replaceMonthCsv } from './mergeCsv'
import type { PlannedRow } from './types'

const planned = (over: Partial<PlannedRow> = {}): PlannedRow => ({
  sourceRow: 1,
  date: '2026-10-05',
  amountCents: -1250,
  description: 'Lunch, with team',
  category: null,
  resolvedCategory: 'Uncategorized',
  fallback: true,
  fileName: 'a.csv',
  fileIndex: 0,
  ...over,
})

describe('formatCents', () => {
  it('writes plain decimals with a sign', () => {
    expect(formatCents(-1250)).toBe('-12.50')
    expect(formatCents(5)).toBe('0.05')
    expect(formatCents(320000)).toBe('3200.00')
    expect(formatCents(-5)).toBe('-0.05')
  })
})

describe('readExistingRows', () => {
  it('returns no rows for missing or empty text', () => {
    expect(readExistingRows(null)).toEqual([])
    expect(readExistingRows('  ')).toEqual([])
  })

  it('keeps rows with a blank category', () => {
    const rows = readExistingRows('Date,Category,Amount,Description\n2026-10-01,,-3.00,Tea')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: '2026-10-01', amountCents: -300, description: 'Tea' })
  })

  it('reads columns by header name in any order', () => {
    const rows = readExistingRows('Amount,Date,Category\n-3.00,2026-10-01,Dining')
    expect(rows[0]).toMatchObject({ date: '2026-10-01', amountCents: -300, description: '' })
  })
})

describe('replaceMonthCsv', () => {
  it('writes the canonical header and quotes fields that need it', () => {
    expect(replaceMonthCsv([planned()])).toBe(
      'Date,Category,Amount,Description\n2026-10-05,Uncategorized,-12.50,"Lunch, with team"',
    )
  })

  it('writes the file category when there is one and the fallback otherwise', () => {
    const text = replaceMonthCsv([planned({ resolvedCategory: 'Dining', category: 'Dining', fallback: false })])
    expect(text.split('\n')[1]).toBe('2026-10-05,Dining,-12.50,"Lunch, with team"')
  })
})

describe('appendRowsToMonthCsv', () => {
  it('creates the month from the canonical header when nothing exists', () => {
    expect(appendRowsToMonthCsv(null, [planned()])).toBe(replaceMonthCsv([planned()]))
    expect(appendRowsToMonthCsv('', [planned()])).toBe(replaceMonthCsv([planned()]))
  })

  it('leaves existing text untouched and adds rows at the end', () => {
    const existing = 'Date,Category,Amount,Description\n2026-10-01,Salary,3200.00,Payroll'
    const merged = appendRowsToMonthCsv(existing, [planned()])
    expect(merged?.startsWith(`${existing}\n`)).toBe(true)
    expect(merged?.endsWith('2026-10-05,Uncategorized,-12.50,"Lunch, with team"')).toBe(true)
  })

  it('does not add a blank line when the existing text ends with a newline', () => {
    const merged = appendRowsToMonthCsv('Date,Category,Amount,Description\n2026-10-01,Salary,1.00,P\n', [planned()])
    expect(merged).not.toContain('\n\n')
  })

  it('returns the existing text when there is nothing to append', () => {
    const existing = 'Date,Category,Amount,Description\n2026-10-01,Salary,1.00,P'
    expect(appendRowsToMonthCsv(existing, [])).toBe(existing)
  })

  it("follows the file's own column order", () => {
    const merged = appendRowsToMonthCsv('Amount,Description,Date,Category\n-3.00,Tea,2026-10-01,Dining', [planned()])
    expect(merged?.split('\n')[2]).toBe('-12.50,"Lunch, with team",2026-10-05,Uncategorized')
  })

  it('adds a Description column to a file that has none, keeping existing rows', () => {
    const merged = appendRowsToMonthCsv('Date,Category,Amount\n2026-10-01,Dining,-3.00', [planned()])
    expect(merged?.split('\n')).toEqual([
      'Date,Category,Amount,Description',
      '2026-10-01,Dining,-3.00,',
      '2026-10-05,Uncategorized,-12.50,"Lunch, with team"',
    ])
  })

  it('returns null when the existing file has no usable header', () => {
    expect(appendRowsToMonthCsv('foo,bar\n1,2', [planned()])).toBeNull()
  })
})
