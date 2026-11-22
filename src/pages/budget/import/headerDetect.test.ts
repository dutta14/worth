import { describe, it, expect } from 'vitest'
import { tokenize } from './tokenize'
import { detectHeaderRow, modalWidth, normalizeHeader, suggestMapping } from './headerDetect'

describe('detectHeaderRow', () => {
  it('finds a header in the first record', () => {
    const result = detectHeaderRow([
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Shop', '-5.00'],
    ])
    expect(result).toEqual({
      hasHeader: true,
      headerIndex: 0,
      headers: ['Date', 'Description', 'Amount'],
      dataRecords: [['2026-01-01', 'Shop', '-5.00']],
      preambleCount: 0,
      footerCount: 0,
      firstSourceRow: 2,
    })
  })

  it('trims header cells', () => {
    const result = detectHeaderRow([
      [' Date ', ' Amount '],
      ['2026-01-01', '5'],
    ])
    expect(result.headers).toEqual(['Date', 'Amount'])
  })

  it('skips preamble records above the header and reports the right source row', () => {
    const result = detectHeaderRow([
      ['Account Name', 'Everyday Checking', ''],
      ['Date Range', '10/01/2026 - 10/31/2026', ''],
      [''],
      ['Date', 'Description', 'Amount'],
      ['10/01/2026', 'Shop', '-5.00'],
    ])
    expect(result.headerIndex).toBe(3)
    expect(result.firstSourceRow).toBe(5)
    expect(result.dataRecords).toEqual([['10/01/2026', 'Shop', '-5.00']])
  })

  it('does not take a text-only preamble record for the header when the next record is not data', () => {
    const result = detectHeaderRow([
      ['Account', 'Checking', 'Primary'],
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Shop', '-5.00'],
    ])
    expect(result.headerIndex).toBe(1)
  })

  it('drops trailing blank and footer records but keeps interior blank records', () => {
    const result = detectHeaderRow([
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Shop', '-5.00'],
      [''],
      ['2026-01-02', 'Cafe', '-3.00'],
      [''],
      ['Total', '', '-8.00'],
      ['Closing balance', '', '100.00'],
      [''],
    ])
    expect(result.dataRecords).toEqual([['2026-01-01', 'Shop', '-5.00'], [''], ['2026-01-02', 'Cafe', '-3.00']])
    expect(result.footerCount).toBe(2)
  })

  it('counts preamble records above the header, not blank ones', () => {
    const result = detectHeaderRow([
      ['Account Name', 'Everyday Checking', ''],
      [''],
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Shop', '-5.00'],
    ])
    expect(result.preambleCount).toBe(1)
  })

  it('treats a file as headerless when a notes row follows data, so the notes row is reported, not promoted', () => {
    const { records } = tokenize(
      '2024-01-01,Coffee,-3.00\n2024-01-02,Tea,-4.00\nPending,Transactions,here\n2024-01-03,Food,-5.00',
      ',',
    )
    const result = detectHeaderRow(records)
    expect(result.hasHeader).toBe(false)
    expect(result.headerIndex).toBe(-1)
    expect(result.dataRecords).toEqual(records)
    expect(result.firstSourceRow).toBe(1)
  })

  it('keeps a trailing transaction whose date is blank or N/A so it can be reported', () => {
    const { records } = tokenize(
      'Date,Desc,Amount\n2024-01-01,Coffee,-3.00\n2024-01-02,Tea,-4.00\nN/A,Food,-5.00\n,Gas,-9.00',
      ',',
    )
    const result = detectHeaderRow(records)
    expect(result.dataRecords).toHaveLength(4)
    expect(result.footerCount).toBe(0)
  })

  it('trims trailing summary records by label or by having no amount, but stops at a real transaction', () => {
    const result = detectHeaderRow([
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Shop', '-5.00'],
      ['Pending', 'Food', '-9.00'],
      ['Total', '', '-14.00'],
      ['Ending balance', '', '100.00'],
      ['Generated on October 31', '', ''],
    ])
    expect(result.dataRecords).toEqual([
      ['2026-01-01', 'Shop', '-5.00'],
      ['Pending', 'Food', '-9.00'],
    ])
    expect(result.footerCount).toBe(3)
  })

  it('keeps a trailing record with a date-shaped cell even if its date is invalid, so it can be reported', () => {
    const result = detectHeaderRow([
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Shop', '-5.00'],
      ['2026-02-30', 'Bad date', '-3.00'],
    ])
    expect(result.dataRecords).toHaveLength(2)
  })

  it('keeps all records when no record looks like it has a date, so nothing is dropped silently', () => {
    const result = detectHeaderRow(
      [
        ['Date', 'Description', 'Amount'],
        ['Jan fifth', 'Shop', '-5.00'],
        ['Jan sixth', 'Cafe', '-3.00'],
      ],
      { hasHeader: true },
    )
    expect(result.dataRecords).toHaveLength(2)
  })

  it('detects no header when the first record is data, and names columns by position', () => {
    const records = [
      ['2026-10-01', 'Payroll', '3200.00'],
      ['2026-10-02', 'Starbucks', '-6.75'],
    ]
    expect(detectHeaderRow(records)).toEqual({
      hasHeader: false,
      headerIndex: -1,
      headers: ['Column 1', 'Column 2', 'Column 3'],
      dataRecords: records,
      preambleCount: 0,
      footerCount: 0,
      firstSourceRow: 1,
    })
  })

  it('honors hasHeader: false even when a header would be detected', () => {
    const records = [
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Shop', '-5.00'],
    ]
    const result = detectHeaderRow(records, { hasHeader: false })
    expect(result.hasHeader).toBe(false)
    expect(result.dataRecords).toEqual(records)
    expect(result.firstSourceRow).toBe(1)
  })

  it('honors an explicit header index', () => {
    const result = detectHeaderRow(
      [
        ['Date', 'Description', 'Amount'],
        ['Day', 'Note', 'Sum'],
        ['2026-01-01', 'Shop', '-5.00'],
      ],
      { headerIndex: 1 },
    )
    expect(result.headers).toEqual(['Day', 'Note', 'Sum'])
    expect(result.firstSourceRow).toBe(3)
    expect(result.dataRecords).toEqual([['2026-01-01', 'Shop', '-5.00']])
  })

  it('treats an out-of-range explicit header index as no header', () => {
    const records = [['2026-01-01', 'Shop', '-5.00']]
    expect(detectHeaderRow(records, { headerIndex: 5 }).hasHeader).toBe(false)
    expect(detectHeaderRow(records, { headerIndex: -2 }).hasHeader).toBe(false)
  })

  it('falls back to the first non-blank record when a header is required but none is detected', () => {
    const result = detectHeaderRow([[''], ['2026-01-01', 'Shop', '-5.00'], ['2026-01-02', 'Cafe', '-3.00']], {
      hasHeader: true,
    })
    expect(result.hasHeader).toBe(true)
    expect(result.headerIndex).toBe(1)
    expect(result.dataRecords).toEqual([['2026-01-02', 'Cafe', '-3.00']])
  })

  it('accepts a header followed by a date row whose amount is blank, as a weaker match', () => {
    const result = detectHeaderRow([
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Pending', ''],
    ])
    expect(result.headerIndex).toBe(0)
  })

  it('keeps the first weak match when several text records are followed by an amount-less date row', () => {
    const result = detectHeaderRow([
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Pending', ''],
      ['Posted', 'Name', 'Sum'],
      ['2026-01-02', 'Also pending', ''],
    ])
    expect(result.headerIndex).toBe(0)
  })

  it('tolerates a header one cell narrower than the data (trailing delimiter on data rows)', () => {
    const result = detectHeaderRow([
      ['Date', 'Description', 'Amount'],
      ['2026-01-01', 'Shop', '-5.00', ''],
      ['2026-01-02', 'Cafe', '-3.00', ''],
    ])
    expect(result.headerIndex).toBe(0)
  })

  it('rejects a header candidate that holds a date or an amount', () => {
    const result = detectHeaderRow([
      ['Date', 'Amount', 'Memo'],
      ['2026-01-01', '5.00', 'x'],
      ['2026-01-02', '6.00', 'y'],
    ])
    expect(result.headerIndex).toBe(0)
    expect(result.dataRecords).toHaveLength(2)
  })

  it('handles a single-column file', () => {
    const result = detectHeaderRow([['Amount'], ['5.00'], ['6.00']])
    expect(result.headers).toEqual(['Column 1'])
    expect(result.hasHeader).toBe(false)
  })

  it('returns an empty result for no records or only blank records', () => {
    expect(detectHeaderRow([])).toEqual({
      hasHeader: false,
      headerIndex: -1,
      headers: [],
      dataRecords: [],
      preambleCount: 0,
      footerCount: 0,
      firstSourceRow: 1,
    })
    expect(detectHeaderRow([[''], ['']]).dataRecords).toEqual([])
  })

  it('returns no data records for a header-only file', () => {
    const result = detectHeaderRow([['Date', 'Description', 'Amount']], { hasHeader: true })
    expect(result.hasHeader).toBe(true)
    expect(result.dataRecords).toEqual([])
  })
})

describe('modalWidth', () => {
  it('returns the most common width', () => {
    expect(modalWidth([['a'], ['a', 'b', 'c'], ['a', 'b', 'c']])).toBe(3)
  })

  it('prefers the wider width on a tie', () => {
    expect(modalWidth([['a'], ['a', 'b']])).toBe(2)
  })

  it('returns 0 for no records', () => {
    expect(modalWidth([])).toBe(0)
  })
})

describe('normalizeHeader', () => {
  it.each([
    ['Transaction Date', 'transaction date'],
    ['  AMOUNT  ', 'amount'],
    ['Amount (USD)', 'amount'],
    ['Trans. Date', 'trans date'],
    ['Posted_Date', 'posted date'],
    ['Check #', 'check'],
    ['Buchungstext', 'buchungstext'],
    ['Désignation', 'designation'],
    ['Debit [EUR]', 'debit'],
    ['Money-Out', 'money out'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected)
  })
})

describe('suggestMapping', () => {
  it('maps Date, Description, Amount', () => {
    expect(suggestMapping(['Date', 'Description', 'Amount'])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
      amountMode: 'single',
    })
  })

  it('maps Transaction Date / Description / Amount (AC-1)', () => {
    expect(suggestMapping(['Transaction Date', 'Description', 'Amount'])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
      amountMode: 'single',
    })
  })

  it('maps Posted Date and Payee', () => {
    expect(suggestMapping(['Posted Date', 'Payee', 'Amount'])).toMatchObject({ date: 0, description: 1, amount: 2 })
  })

  it('prefers Transaction Date over Post Date and leaves Type unmapped', () => {
    const headers = ['Transaction Date', 'Post Date', 'Description', 'Category', 'Type', 'Amount']
    expect(suggestMapping(headers)).toEqual({
      date: 0,
      description: 2,
      category: 3,
      amount: 5,
      amountMode: 'single',
    })
  })

  it('switches to split mode for debit and credit columns and ignores the balance', () => {
    expect(suggestMapping(['Date', 'Description', 'Debit', 'Credit', 'Balance'])).toEqual({
      date: 0,
      description: 1,
      debit: 2,
      credit: 3,
      amountMode: 'split',
    })
  })

  it('recognizes money in / money out and withdrawals / deposits', () => {
    expect(suggestMapping(['Date', 'Details', 'Money Out', 'Money In'])).toMatchObject({
      debit: 2,
      credit: 3,
      amountMode: 'split',
    })
    expect(suggestMapping(['Date', 'Memo', 'Withdrawals', 'Deposits'])).toMatchObject({ debit: 2, credit: 3 })
  })

  it('uses split mode when only one of debit or credit exists', () => {
    expect(suggestMapping(['Date', 'Description', 'Debit'])).toMatchObject({ debit: 2, amountMode: 'split' })
    expect(suggestMapping(['Date', 'Description', 'Credit'])).toMatchObject({ credit: 2, amountMode: 'split' })
  })

  it('prefers a single amount column when both an amount and debit/credit columns exist', () => {
    expect(suggestMapping(['Date', 'Amount', 'Debit', 'Credit'])).toMatchObject({
      amount: 1,
      debit: 2,
      credit: 3,
      amountMode: 'single',
    })
  })

  it('suggests the first of duplicated headers and claims each column once', () => {
    expect(suggestMapping(['Date', 'Amount', 'Amount'])).toMatchObject({ amount: 1 })
  })

  it('prefers the higher-priority description synonym over an earlier column', () => {
    expect(suggestMapping(['Date', 'Memo', 'Description', 'Amount'])).toMatchObject({ description: 2 })
  })

  it('does not suggest a sign convention, date format or decimal separator', () => {
    const suggestion = suggestMapping(['Date', 'Description', 'Amount'])
    expect(suggestion).not.toHaveProperty('signConvention')
    expect(suggestion).not.toHaveProperty('dateFormat')
    expect(suggestion).not.toHaveProperty('decimalSeparator')
  })

  it('returns an empty suggestion for unrecognized headers', () => {
    expect(suggestMapping(['Buchungstag', 'Valuta', 'Buchungstext', 'Betrag', 'Waehrung'])).toEqual({})
    expect(suggestMapping([])).toEqual({})
  })

  it('does not use the ambiguous "type" header for anything', () => {
    expect(suggestMapping(['Type', 'Date', 'Amount'])).not.toHaveProperty('category')
  })
})
