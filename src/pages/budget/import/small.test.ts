import { describe, it, expect } from 'vitest'
import { columnLabels } from './columnLabels'
import { formatMoney, formatMonth, formatMonthList, formatSignedMoney } from './format'
import { AUTO_SETTINGS, headerSignature, parseFileText } from './parseFile'
import { countLabel, filterEntries, reviewEntries, SKIP_REASON_TEXT } from './reviewRows'
import { planFromTexts } from '../../../test/importHelpers'
import { findLegacyColumns } from '../utils/csvParser'

describe('format', () => {
  it('names months and lists them', () => {
    expect(formatMonth('2026-10')).toBe('Oct 2026')
    expect(formatMonthList([])).toBe('')
    expect(formatMonthList(['2026-10'])).toBe('Oct 2026')
    expect(formatMonthList(['2026-10', '2026-11'])).toBe('Oct 2026 and Nov 2026')
    expect(formatMonthList(['2026-10', '2026-11', '2026-12'])).toBe('Oct 2026, Nov 2026 and Dec 2026')
  })

  it('formats money with and without a sign', () => {
    expect(formatMoney(-123450)).toBe('$1,234.50')
    expect(formatSignedMoney(-1250)).toBe('-$12.50')
    expect(formatSignedMoney(100000)).toBe('$1,000.00')
  })
})

describe('columnLabels', () => {
  it('tells repeated and empty headers apart by position', () => {
    expect(columnLabels(['Date', '', 'Amount', 'Amount'])).toEqual([
      'Date',
      'Column 2',
      'Amount (column 3)',
      'Amount (column 4)',
    ])
  })
})

describe('parseFileText', () => {
  it('detects the delimiter and header, and honours a header row override', () => {
    const text = 'Statement,,\nDate;Amount\n2026-10-01;-5.00'.replace('Statement,,', 'Bank statement')
    const auto = parseFileText(text, AUTO_SETTINGS)
    expect(auto.detection.dataRecords.length).toBeGreaterThan(0)
    const forced = parseFileText('a,b\nDate,Amount\n2026-10-01,-5.00', { ...AUTO_SETTINGS, headerRow: 2 })
    expect(forced.detection.headers).toEqual(['Date', 'Amount'])
  })

  it('builds a header signature that ignores case and padding', () => {
    expect(headerSignature([' Date ', 'AMOUNT'])).toBe('date|amount')
  })
})

describe('findLegacyColumns', () => {
  it('finds the canonical columns and a description synonym', () => {
    expect(findLegacyColumns(['date', 'category', 'amount', 'memo'])).toEqual({
      dateIdx: 0,
      catIdx: 1,
      amtIdx: 2,
      descIdx: 3,
    })
  })

  it('uses the one extra column of a four-column header as the description', () => {
    expect(findLegacyColumns(['date', 'category', 'amount', 'zzz']).descIdx).toBe(3)
  })

  it('reports -1 for missing columns', () => {
    expect(findLegacyColumns(['when', 'what'])).toEqual({ dateIdx: -1, catIdx: -1, amtIdx: -1, descIdx: -1 })
  })
})

describe('review rows', () => {
  const csv = 'Date,Description,Amount\n2026-10-02,Coffee,-4.25\n2026-10-02,Coffee,-4.25\nnot a date,Tea,-1.00'
  const existing = { '2026-10': 'Date,Category,Amount,Description\n2026-10-02,X,-4.25,Coffee' }

  it('lists new, duplicate and skipped rows in file order', () => {
    const plan = planFromTexts([{ name: 'a.csv', text: csv }], { existing })
    const entries = reviewEntries(plan)
    expect(entries.map(e => e.kind)).toEqual(['duplicate', 'new', 'skipped'])
    expect(filterEntries(entries, 'all')).toHaveLength(3)
    expect(filterEntries(entries, 'new')).toHaveLength(1)
    expect(filterEntries(entries, 'duplicates')).toHaveLength(1)
    expect(filterEntries(entries, 'skipped').map(e => e.reason)).toEqual(['bad-date'])
    expect(SKIP_REASON_TEXT['bad-date']).toBe('Date not recognized')
  })

  it('marks a duplicate that is still imported as a duplicate when skipping is off', () => {
    const plan = planFromTexts([{ name: 'a.csv', text: csv }], {
      existing,
      options: { skipDuplicates: false, replaceMonths: false },
    })
    expect(reviewEntries(plan).map(e => e.kind)).toEqual(['duplicate', 'new', 'skipped'])
  })

  it('pluralizes counts', () => {
    expect(countLabel(1, 'row', 'rows')).toBe('1 row')
    expect(countLabel(1200, 'row', 'rows')).toBe('1,200 rows')
  })
})
