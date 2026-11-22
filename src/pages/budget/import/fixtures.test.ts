import { describe, it, expect } from 'vitest'
import { parseCSV as parseLegacyCSV } from '../utils/csvParser'
import { sniffDelimiter } from './delimiter'
import { detectHeaderRow, suggestMapping } from './headerDetect'
import { normalizeRows, type NormalizeResult } from './normalizeRows'
import { detectDateFormats } from './parseDate'
import { assertRowCount, decodeBytes, ImportLimitError } from './readFile'
import { tokenize } from './tokenize'
import type { ColumnMapping, Delimiter, DateFormat } from './types'
import f01 from './fixtures/F01-debit-credit.csv?raw'
import f02 from './fixtures/F02-posted-date-payee.csv?raw'
import f02b from './fixtures/F02b-transaction-date.csv?raw'
import f03 from './fixtures/F03-card-export.csv?raw'
import f04 from './fixtures/F04-european-semicolon.csv?raw'
import f05 from './fixtures/F05-two-month-span.csv?raw'
import f06 from './fixtures/F06-quoting.csv?raw'
import f07 from './fixtures/F07-amount-shapes.csv?raw'
import f08 from './fixtures/F08-preamble-footer.csv?raw'
import f09 from './fixtures/F09-no-header.csv?raw'
import f10 from './fixtures/F10-ambiguous-dates.csv?raw'
import f11 from './fixtures/F11-legacy-canonical.csv?raw'
import f13 from './fixtures/F13-same-day-repeats.csv?raw'
import f15 from './fixtures/F15-malformed.csv?raw'

const MAX_YEAR = 2027

interface PipelineResult extends NormalizeResult {
  encoding: string
  delimiter: Delimiter
  headers: string[]
  suggestion: Partial<ColumnMapping>
  mapping: ColumnMapping
  headerIndex: number
  firstSourceRow: number
  tokenizeErrors: { row: number; message: string }[]
  dateFormats: DateFormat[]
}

const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Encodes text the way a Windows-1252 export would (only the Latin-1 range is needed here). */
const encodeWindows1252 = (text: string): Uint8Array => Uint8Array.from(Array.from(text, ch => ch.charCodeAt(0)))

function encodeUtf16le(text: string): Uint8Array {
  const out = [0xff, 0xfe]
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0xff, text.charCodeAt(i) >> 8)
  return Uint8Array.from(out)
}

function runPipeline(
  bytes: Uint8Array,
  overrides: Partial<ColumnMapping> = {},
  detect: { hasHeader?: boolean } = {},
): PipelineResult {
  const { text, encoding } = decodeBytes(bytes)
  const delimiter = sniffDelimiter(text)
  const { records, errors } = tokenize(text, delimiter)
  const detection = detectHeaderRow(records, detect)
  const suggestion = suggestMapping(detection.headers)
  const mapping: ColumnMapping = {
    amountMode: 'single',
    date: 0,
    description: null,
    amount: null,
    debit: null,
    credit: null,
    category: null,
    signConvention: 'negative-is-spending',
    dateFormat: null,
    decimalSeparator: '.',
    ...suggestion,
    ...overrides,
  }
  const dateFormats = detectDateFormats(
    detection.dataRecords.map(record => record[mapping.date] ?? ''),
    { maxYear: MAX_YEAR },
  )
  const normalized = normalizeRows(detection.dataRecords, mapping, {
    firstSourceRow: detection.firstSourceRow,
    maxYear: MAX_YEAR,
  })
  return {
    ...normalized,
    encoding,
    delimiter,
    headers: detection.headers,
    suggestion,
    mapping,
    headerIndex: detection.headerIndex,
    firstSourceRow: detection.firstSourceRow,
    tokenizeErrors: errors,
    dateFormats,
  }
}

const run = (text: string, overrides: Partial<ColumnMapping> = {}, detect: { hasHeader?: boolean } = {}) =>
  runPipeline(encodeUtf8(text), overrides, detect)

const months = (rows: { date: string }[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.date.slice(0, 7)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

describe('F01: Date, Description, Debit, Credit, Balance (MM/DD/YYYY)', () => {
  it('proposes split mode with the balance ignored and reads debit as spending, credit as income', () => {
    const result = run(f01)
    expect(result.suggestion).toEqual({ date: 0, description: 1, debit: 2, credit: 3, amountMode: 'split' })
    expect(result.skipped).toEqual([])
    expect(result.rows.map(r => [r.date, r.amountCents, r.description])).toEqual([
      ['2026-10-01', 320000, 'PAYROLL ACME CORP'],
      ['2026-10-02', -675, 'STARBUCKS #1234'],
      ['2026-10-03', -4820, 'SHELL OIL 5551'],
      ['2026-10-15', 50000, 'TRANSFER FROM SAVINGS'],
      ['2026-10-20', -185000, 'RENT, OCTOBER'],
    ])
    expect(result.rows.every(r => r.category === null)).toBe(true)
  })

  it('resolves the date format from the data because one date has a day above 12', () => {
    expect(run(f01).dateFormats).toEqual(['MM/DD/YYYY'])
  })
})

describe('F02: Posted Date, Payee, Amount (ISO, signed)', () => {
  it('maps the three columns and leaves every row without a category', () => {
    const result = run(f02)
    expect(result.suggestion).toEqual({ date: 0, description: 1, amount: 2, amountMode: 'single' })
    expect(result.skipped).toEqual([])
    expect(result.rows.map(r => r.amountCents)).toEqual([320000, -675, -4820, 2500])
    expect(result.rows.map(r => r.description)).toEqual([
      'Payroll Acme Corp',
      'Starbucks',
      'Shell Oil',
      'Refund Hardware Store',
    ])
    expect(result.rows.every(r => r.category === null)).toBe(true)
  })

  it('imports every row of the Transaction Date variant with none dropped (AC-1)', () => {
    const result = run(f02b)
    expect(result.suggestion).toMatchObject({ date: 0, description: 1, amount: 2 })
    expect(result.rows).toHaveLength(3)
    expect(result.skipped).toEqual([])
    expect(result.rows.every(r => r.category === null)).toBe(true)
  })
})

describe('F03: card export with positive charges', () => {
  it('keeps file categories and turns payments into income once "positive is spending" is chosen', () => {
    const result = run(f03, { signConvention: 'positive-is-spending' })
    expect(result.suggestion).toEqual({
      date: 0,
      description: 2,
      category: 3,
      amount: 5,
      amountMode: 'single',
    })
    expect(result.skipped).toEqual([])
    expect(result.rows.map(r => [r.description, r.category, r.amountCents])).toEqual([
      ['STARBUCKS #1234', 'Food & Drink', -675],
      ['WHOLEFDS MKT 10', 'Groceries', -8214],
      ['AUTOPAY PAYMENT THANK YOU', null, 50000],
      ['AMAZON MKTPLACE', 'Shopping', -1999],
    ])
  })

  it('does not choose the sign convention itself', () => {
    expect(run(f03).suggestion).not.toHaveProperty('signConvention')
  })
})

describe('F04: European semicolon file in windows-1252', () => {
  const result = runPipeline(encodeWindows1252(f04), {
    date: 0,
    description: 2,
    amount: 3,
    amountMode: 'single',
    decimalSeparator: ',',
  })

  it('decodes windows-1252 and detects the semicolon delimiter', () => {
    expect(result.encoding).toBe('windows-1252')
    expect(result.delimiter).toBe(';')
    expect(result.suggestion).toEqual({})
  })

  it('reads umlauts, comma decimals and DD.MM.YYYY dates', () => {
    expect(result.skipped).toEqual([])
    expect(result.dateFormats).toEqual(['DD.MM.YYYY'])
    expect(result.rows.map(r => [r.date, r.amountCents, r.description])).toEqual([
      ['2026-10-03', -450, 'Bäckerei Müller'],
      ['2026-10-05', -123456, 'Miete Oktober'],
      ['2026-10-15', 280000, 'Gehalt Süd GmbH'],
      ['2026-10-31', -1250, 'Café Größe, Berlin'],
    ])
  })

  it('exercises the fallback because the encoded bytes are not valid UTF-8', () => {
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(encodeWindows1252(f04))).toThrow()
  })

  it('misreads "1.234,56" under a period decimal instead of corrupting it', () => {
    const wrong = runPipeline(encodeWindows1252(f04), { date: 0, description: 2, amount: 3, decimalSeparator: '.' })
    expect(wrong.skipped.map(s => s.reason)).toContain('bad-amount')
    expect(wrong.rows.map(r => r.amountCents)).not.toContain(123)
  })
})

describe('F05: statement spanning two months', () => {
  it('keeps each row on its own transaction date so a caller can split by month', () => {
    const result = run(f05)
    expect(result.skipped).toEqual([])
    expect(months(result.rows)).toEqual({ '2026-10': 2, '2026-11': 2 })
  })

  it('splits a statement spanning two years', () => {
    const result = run('Date,Description,Amount\n2025-12-31,A,-1.00\n2026-01-01,B,-2.00\n')
    expect(months(result.rows)).toEqual({ '2025-12': 1, '2026-01': 1 })
  })
})

describe('F06: BOM, CRLF, quoting, trailing blank rows', () => {
  const check = (result: PipelineResult, newline: string) => {
    expect(result.skipped).toEqual([])
    expect(result.tokenizeErrors).toEqual([])
    expect(result.rows.map(r => r.description)).toEqual([
      'Smith, John & Sons',
      'He said "hello"',
      `Line one${newline}line two`,
      'Plain description',
    ])
    expect(result.rows.map(r => r.amountCents)).toEqual([-2000, -550, -725, 1000])
    expect(result.headers).toEqual(['Date', 'Description', 'Amount'])
  }

  it('parses the LF file', () => {
    check(run(f06), '\n')
  })

  it('parses the same file with a UTF-8 BOM and CRLF line endings', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...encodeUtf8(f06.replace(/\n/g, '\r\n'))])
    const result = runPipeline(bytes)
    expect(result.encoding).toBe('utf-8')
    expect(result.headers[0]).toBe('Date')
    check(result, '\r\n')
  })

  it('parses the same file with CR-only line endings', () => {
    const result = run(f06.replace(/\n/g, '\r'))
    expect(result.rows.map(r => r.amountCents)).toEqual([-2000, -550, -725, 1000])
  })

  it('does not list trailing blank rows as skipped', () => {
    expect(run(f06 + '\n\n\n').skipped).toEqual([])
    expect(run(f06.replace(/\n/g, '\r\n') + '\r\n\r\n').skipped).toEqual([])
  })
})

describe('F07: amount shapes', () => {
  it('reads every shape exactly to the cent', () => {
    const result = run(f07)
    expect(result.skipped).toEqual([])
    expect(result.rows.map(r => r.amountCents)).toEqual([-123450, 200000, -4500, 7500, -1250])
  })
})

describe('F08: preamble and footer', () => {
  it('finds the header below the preamble, ignores the footer, and cites the file row numbers', () => {
    // Every date has a day of 12 or less, so the format must be chosen.
    const result = run(f08, { dateFormat: 'MM/DD/YYYY' })
    expect(result.headerIndex).toBe(4)
    expect(result.headers).toEqual(['Date', 'Description', 'Amount'])
    expect(result.skipped).toEqual([])
    expect(result.rows.map(r => r.sourceRow)).toEqual([6, 7, 8])
    expect(result.rows.map(r => r.amountCents)).toEqual([320000, -675, -4820])
  })
})

describe('F09: no header', () => {
  it('detects the missing header, names columns by position, and imports the first row too', () => {
    const result = run(f09, { date: 0, description: 1, amount: 2 })
    expect(result.headerIndex).toBe(-1)
    expect(result.headers).toEqual(['Column 1', 'Column 2', 'Column 3'])
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({ sourceRow: 1, date: '2026-10-01', amountCents: 320000 })
  })

  it('imports the first row as data when the user says so, even for a file that looks headed', () => {
    const result = run(f02, { date: 0, description: 1, amount: 2 }, { hasHeader: false })
    expect(result.headerIndex).toBe(-1)
    expect(result.skipped).toEqual([expect.objectContaining({ sourceRow: 1, reason: 'bad-date' })])
    expect(result.rows).toHaveLength(4)
  })
})

describe('F10: ambiguous dates', () => {
  it('reports both candidate formats and refuses to guess', () => {
    const result = run(f10)
    expect(result.dateFormats).toEqual(['MM/DD/YYYY', 'DD/MM/YYYY'])
    expect(result.rows).toEqual([])
    expect(result.skipped.map(s => s.reason)).toEqual(['bad-date', 'bad-date', 'bad-date'])
  })

  it('files the rows under the month of the chosen format', () => {
    expect(run(f10, { dateFormat: 'MM/DD/YYYY' }).rows.map(r => r.date)).toEqual([
      '2026-03-04',
      '2026-05-06',
      '2026-07-08',
    ])
    expect(run(f10, { dateFormat: 'DD/MM/YYYY' }).rows.map(r => r.date)).toEqual([
      '2026-04-03',
      '2026-06-05',
      '2026-08-07',
    ])
  })
})

describe('F11: legacy canonical Date, Category, Amount, Description', () => {
  it('maps without help and matches what the legacy parser reads', () => {
    const result = run(f11)
    expect(result.suggestion).toEqual({
      date: 0,
      category: 1,
      amount: 2,
      description: 3,
      amountMode: 'single',
    })
    const legacy = parseLegacyCSV(f11)
    expect(result.rows.map(r => ({ ...r, sourceRow: undefined }))).toEqual(
      legacy.map(t => ({
        sourceRow: undefined,
        date: t.date,
        amountCents: Math.round(t.amount * 100),
        description: t.description,
        category: t.category,
      })),
    )
  })
})

describe('F13: same-day repeats', () => {
  it('parses both identical rows; collapsing duplicates is the planner job, not the parser', () => {
    const result = run(f13)
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({ date: '2026-10-02', amountCents: -425, description: 'Coffee Shop' })
    expect({ ...result.rows[0], sourceRow: 0 }).toEqual({ ...result.rows[1], sourceRow: 0 })
  })
})

describe('F14: UTF-16 LE, tab-delimited', () => {
  it('decodes and parses like the comma-delimited F01', () => {
    const tabbed = tokenize(f01, ',')
      .records.map(record => record.join('\t'))
      .join('\n')
    const result = runPipeline(encodeUtf16le(tabbed))
    expect(result.encoding).toBe('utf-16le')
    expect(result.delimiter).toBe('\t')
    expect(result.rows).toEqual(run(f01).rows)
  })
})

describe('F15: malformed rows', () => {
  it('skips the offending rows with their row numbers and imports the rest', () => {
    const result = run(f15)
    expect(result.tokenizeErrors).toEqual([{ row: 3, message: 'Row 3 has an opening quote with no closing quote.' }])
    expect(result.rows.map(r => [r.sourceRow, r.amountCents])).toEqual([
      [2, -1000],
      [6, -4000],
    ])
    expect(result.skipped.map(s => [s.sourceRow, s.reason])).toEqual([
      [3, 'column-count'],
      [4, 'column-count'],
      [5, 'column-count'],
    ])
  })
})

describe('F12: 50,000 rows', () => {
  const build = (count: number): string =>
    [
      'Date,Description,Amount',
      ...Array.from({ length: count }, (_, i) => `2026-0${(i % 9) + 1}-15,"Shop ${i}, Inc",-${i % 100}.25`),
    ].join('\n')

  it('parses and normalizes within the 5 second budget', () => {
    const bytes = encodeUtf8(build(50_000))
    const started = Date.now()
    const result = runPipeline(bytes)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(result.rows).toHaveLength(50_000)
    expect(result.skipped).toEqual([])
    expect(() => assertRowCount(result.rows.length)).not.toThrow()
  })

  it('refuses 50,001 rows', () => {
    const { records } = tokenize(build(50_001), ',')
    const detection = detectHeaderRow(records)
    expect(detection.dataRecords).toHaveLength(50_001)
    expect(() => assertRowCount(detection.dataRecords.length, 'big.csv')).toThrow(ImportLimitError)
  })
})
