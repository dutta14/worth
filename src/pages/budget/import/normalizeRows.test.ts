import { describe, it, expect } from 'vitest'
import { normalizeRows } from './normalizeRows'
import type { ColumnMapping } from './types'

const MAX_YEAR = 2027

const single: ColumnMapping = {
  amountMode: 'single',
  date: 0,
  description: 1,
  amount: 2,
  debit: null,
  credit: null,
  category: null,
  signConvention: 'negative-is-spending',
  dateFormat: 'YYYY-MM-DD',
  decimalSeparator: '.',
}

const split: ColumnMapping = {
  ...single,
  amountMode: 'split',
  amount: null,
  debit: 2,
  credit: 3,
  dateFormat: 'MM/DD/YYYY',
}

const run = (records: string[][], mapping: ColumnMapping, options = {}) =>
  normalizeRows(records, mapping, { maxYear: MAX_YEAR, ...options })

describe('normalizeRows (single amount column)', () => {
  it('normalizes date, cents, description and a blank category', () => {
    const { rows, skipped } = run([['2026-10-02', ' Starbucks ', '-6.75']], single)
    expect(skipped).toEqual([])
    expect(rows).toEqual([
      { sourceRow: 1, date: '2026-10-02', amountCents: -675, description: 'Starbucks', category: null },
    ])
  })

  it('keeps the file category, trimmed, and maps a blank one to null', () => {
    const mapping = { ...single, category: 3 }
    const { rows } = run(
      [
        ['2026-10-02', 'A', '-1.00', ' Dining '],
        ['2026-10-03', 'B', '-2.00', '  '],
        ['2026-10-04', 'C', '-3.00', ''],
      ],
      mapping,
    )
    expect(rows.map(r => r.category)).toEqual(['Dining', null, null])
  })

  it('negates amounts when positive numbers are spending', () => {
    const mapping: ColumnMapping = { ...single, signConvention: 'positive-is-spending' }
    const { rows } = run(
      [
        ['2026-10-02', 'Charge', '6.75'],
        ['2026-10-03', 'Payment', '-500.00'],
        ['2026-10-04', 'Zero', '0.00'],
      ],
      mapping,
    )
    expect(rows.map(r => r.amountCents)).toEqual([-675, 50000, 0])
    expect(rows.every(r => !Object.is(r.amountCents, -0))).toBe(true)
  })

  it('uses a comma decimal when asked', () => {
    const mapping: ColumnMapping = { ...single, decimalSeparator: ',', dateFormat: 'DD.MM.YYYY' }
    const { rows } = run([['05.10.2026', 'Miete', '-1.234,56']], mapping)
    expect(rows[0]).toMatchObject({ date: '2026-10-05', amountCents: -123456 })
  })

  it('treats a missing description column as an empty description', () => {
    const { rows } = run([['2026-10-02', 'x', '-1.00']], { ...single, description: null })
    expect(rows[0].description).toBe('')
  })

  it('numbers rows from firstSourceRow and counts blank records', () => {
    const { rows, skipped } = run(
      [['2026-10-02', 'A', '-1.00'], [''], ['not a date', 'B', '-2.00'], ['2026-10-04', 'C', '-3.00']],
      single,
      { firstSourceRow: 6 },
    )
    expect(rows.map(r => r.sourceRow)).toEqual([6, 9])
    expect(skipped).toEqual([{ sourceRow: 8, reason: 'bad-date', raw: 'not a date,B,-2.00' }])
  })

  it('ignores entirely blank records without listing them', () => {
    const { rows, skipped } = run([[''], ['', '', ''], [' ', ' ', ' '], ['2026-10-02', 'A', '-1.00']], single)
    expect(rows).toHaveLength(1)
    expect(skipped).toEqual([])
  })

  it('skips a bad date with its row number', () => {
    const { rows, skipped } = run([['2026-02-30', 'A', '-1.00']], single)
    expect(rows).toEqual([])
    expect(skipped).toEqual([{ sourceRow: 1, reason: 'bad-date', raw: '2026-02-30,A,-1.00' }])
  })

  it('skips a bad amount', () => {
    const { skipped } = run(
      [
        ['2026-10-02', 'A', 'abc'],
        ['2026-10-03', 'B', ''],
        ['2026-10-04', 'C', '1,5'],
      ],
      single,
    )
    expect(skipped.map(s => s.reason)).toEqual(['bad-amount', 'bad-amount', 'bad-amount'])
  })

  it('skips a record with nothing but a description as empty', () => {
    const { skipped } = run(
      [
        ['2026-10-02', 'A', '-1.00'],
        ['', 'continued text', ''],
      ],
      single,
    )
    expect(skipped).toEqual([{ sourceRow: 2, reason: 'empty', raw: ',continued text,' }])
  })

  it('skips a record with a missing date but an amount as bad-date', () => {
    const { skipped } = run([['', 'A', '-1.00']], single)
    expect(skipped[0].reason).toBe('bad-date')
  })

  it('ignores a column index beyond the record as blank', () => {
    const { skipped } = run([['2026-10-02', 'A']], { ...single, amount: 9 }, { columnCount: 2 })
    expect(skipped[0].reason).toBe('bad-amount')
  })

  it('returns nothing for no records', () => {
    expect(run([], single)).toEqual({ rows: [], skipped: [] })
  })
})

describe('normalizeRows (debit and credit columns)', () => {
  it('maps debit to spending and credit to income', () => {
    const { rows, skipped } = run(
      [
        ['10/01/2026', 'Payroll', '', '3200.00'],
        ['10/02/2026', 'Starbucks', '6.75', ''],
      ],
      split,
    )
    expect(skipped).toEqual([])
    expect(rows.map(r => r.amountCents)).toEqual([320000, -675])
  })

  it('treats a debit printed with a minus or parentheses as spending too', () => {
    const { rows } = run(
      [
        ['10/02/2026', 'A', '-6.75', ''],
        ['10/03/2026', 'B', '(7.00)', ''],
        ['10/04/2026', 'C', '', '-5.00'],
      ],
      split,
    )
    expect(rows.map(r => r.amountCents)).toEqual([-675, -700, 500])
  })

  it('nets a row that has 0.00 in the other column', () => {
    const { rows } = run(
      [
        ['10/15/2026', 'Transfer in', '0.00', '500.00'],
        ['10/16/2026', 'Transfer out', '25.00', '0.00'],
        ['10/17/2026', 'Zero both', '0.00', '0.00'],
      ],
      split,
    )
    expect(rows.map(r => r.amountCents)).toEqual([50000, -2500, 0])
    expect(Object.is(rows[2].amountCents, 0)).toBe(true)
  })

  it('skips a row where both debit and credit are blank as empty (AC-3)', () => {
    const { rows, skipped } = run([['10/02/2026', 'Balance forward', '', '']], split)
    expect(rows).toEqual([])
    expect(skipped).toEqual([{ sourceRow: 1, reason: 'empty', raw: '10/02/2026,Balance forward,,' }])
  })

  it('skips a row whose debit or credit cannot be read', () => {
    const { skipped } = run(
      [
        ['10/02/2026', 'A', 'abc', ''],
        ['10/03/2026', 'B', '', 'xyz'],
      ],
      split,
    )
    expect(skipped.map(s => s.reason)).toEqual(['bad-amount', 'bad-amount'])
  })

  it('works with only a credit column mapped', () => {
    const { rows } = run([['10/02/2026', 'A', '', '5.00']], { ...split, debit: null })
    expect(rows[0].amountCents).toBe(500)
  })

  it('works with only a debit column mapped', () => {
    const { rows } = run([['10/02/2026', 'A', '5.00', '']], { ...split, credit: null })
    expect(rows[0].amountCents).toBe(-500)
  })

  it('ignores the sign convention in split mode', () => {
    const { rows } = run([['10/02/2026', 'A', '5.00', '']], { ...split, signConvention: 'positive-is-spending' })
    expect(rows[0].amountCents).toBe(-500)
  })
})

describe('normalizeRows (ragged records)', () => {
  const records = [
    ['2026-10-01', 'ok', '-1.00'],
    ['2026-10-02', 'too few'],
    ['2026-10-03', 'too many', '-3.00', 'extra'],
    ['2026-10-04', 'ok again', '-4.00'],
  ]

  it('skips records with the wrong width as column-count and keeps the rest', () => {
    const { rows, skipped } = run(records, single)
    expect(rows.map(r => r.sourceRow)).toEqual([1, 4])
    expect(skipped).toEqual([
      { sourceRow: 2, reason: 'column-count', raw: '2026-10-02,too few' },
      { sourceRow: 3, reason: 'column-count', raw: '2026-10-03,too many,-3.00,extra' },
    ])
  })

  it('tolerates extra trailing empty cells', () => {
    const { rows, skipped } = run(
      [
        ['2026-10-01', 'a', '-1.00'],
        ['2026-10-02', 'b', '-2.00'],
        ['2026-10-03', 'c', '-3.00', ''],
        ['2026-10-04', 'd', '-4.00', '', ' '],
      ],
      single,
    )
    expect(skipped).toEqual([])
    expect(rows).toHaveLength(4)
  })

  it('takes the expected width from the option when given', () => {
    const { skipped } = run([['2026-10-01', 'a', '-1.00']], single, { columnCount: 4 })
    expect(skipped[0].reason).toBe('column-count')
  })

  it('skips a one-cell raw line left by an unterminated quote', () => {
    const { skipped } = run(
      [['2026-10-01', 'a', '-1.00'], ['2026-10-02,"oops,-2.00'], ['2026-10-03', 'c', '-3.00']],
      single,
    )
    expect(skipped).toEqual([{ sourceRow: 2, reason: 'column-count', raw: '"2026-10-02,""oops,-2.00"' }])
  })

  it('quotes cells that need it and truncates very long raw text', () => {
    const long = 'x'.repeat(2000)
    const { skipped } = run(
      [
        ['2026-10-01', 'a', '-1.00'],
        ['bad, date', long, '-1.00'],
      ],
      single,
    )
    expect(skipped[0].raw.startsWith('"bad, date",xxx')).toBe(true)
    expect(skipped[0].raw).toHaveLength(501)
    expect(skipped[0].raw.endsWith('…')).toBe(true)
  })
})

describe('normalizeRows (date format resolution)', () => {
  const unset: ColumnMapping = { ...single, dateFormat: null }

  it('uses the only format the data allows when none is chosen', () => {
    const { rows } = run([['2026-10-02', 'A', '-1.00']], unset)
    expect(rows[0].date).toBe('2026-10-02')
  })

  it('resolves an otherwise ambiguous column from a later unambiguous sample', () => {
    const { rows } = run(
      [
        ['03/04/2026', 'A', '-1.00'],
        ['25/04/2026', 'B', '-2.00'],
      ],
      unset,
    )
    expect(rows.map(r => r.date)).toEqual(['2026-04-03', '2026-04-25'])
  })

  it('never guesses between DD/MM and MM/DD: ambiguous data with no chosen format skips every row', () => {
    const { rows, skipped } = run(
      [
        ['03/04/2026', 'A', '-1.00'],
        ['05/06/2026', 'B', '-2.00'],
      ],
      unset,
    )
    expect(rows).toEqual([])
    expect(skipped.map(s => s.reason)).toEqual(['bad-date', 'bad-date'])
  })

  it('skips every row when no format fits', () => {
    const { skipped } = run([['soon', 'A', '-1.00']], unset)
    expect(skipped[0].reason).toBe('bad-date')
  })

  it('lets the user choose between DD/MM and MM/DD and gets different months (F10)', () => {
    const records = [['03/04/2026', 'A', '-1.00']]
    expect(run(records, { ...single, dateFormat: 'MM/DD/YYYY' }).rows[0].date).toBe('2026-03-04')
    expect(run(records, { ...single, dateFormat: 'DD/MM/YYYY' }).rows[0].date).toBe('2026-04-03')
  })

  it('skips rows whose date does not fit the chosen format', () => {
    const { skipped } = run([['04/03/2026', 'A', '-1.00']], { ...single, dateFormat: 'YYYY-MM-DD' })
    expect(skipped[0].reason).toBe('bad-date')
  })

  it('uses the clock for the year bound when no maxYear is given', () => {
    const { rows, skipped } = normalizeRows(
      [
        ['2026-10-02', 'A', '-1.00'],
        ['2999-01-01', 'B', '-2.00'],
      ],
      single,
    )
    expect(rows).toHaveLength(1)
    expect(skipped[0].reason).toBe('bad-date')
  })
})
