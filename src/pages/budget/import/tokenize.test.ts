import { describe, it, expect } from 'vitest'
import { tokenize, tokenizeRecords } from './tokenize'

describe('tokenize', () => {
  it('returns no records for empty text', () => {
    expect(tokenize('', ',')).toEqual({ records: [], errors: [] })
  })

  it('splits records and cells on the delimiter', () => {
    expect(tokenize('a,b,c\n1,2,3', ',').records).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it.each([
    [';', 'a;b;c'],
    ['\t', 'a\tb\tc'],
    ['|', 'a|b|c'],
  ] as const)('splits on %j', (delimiter, text) => {
    expect(tokenize(text, delimiter).records).toEqual([['a', 'b', 'c']])
  })

  it('does not split on a comma when the delimiter is a semicolon', () => {
    expect(tokenize('a;1,5', ';').records).toEqual([['a', '1,5']])
  })

  it('keeps delimiters inside quoted fields', () => {
    expect(tokenize('a,"b,c",d', ',').records).toEqual([['a', 'b,c', 'd']])
  })

  it('unescapes doubled quotes', () => {
    expect(tokenize('a,"say ""hi""",c', ',').records).toEqual([['a', 'say "hi"', 'c']])
  })

  it('keeps newlines inside quoted fields', () => {
    expect(tokenize('a,"one\ntwo",c\nx,y,z', ',').records).toEqual([
      ['a', 'one\ntwo', 'c'],
      ['x', 'y', 'z'],
    ])
  })

  it('keeps CRLF inside quoted fields untouched', () => {
    expect(tokenize('"one\r\ntwo",b', ',').records).toEqual([['one\r\ntwo', 'b']])
  })

  it.each([
    ['CRLF', 'a,b\r\nc,d'],
    ['LF', 'a,b\nc,d'],
    ['CR', 'a,b\rc,d'],
  ])('ends a record on %s', (_name, text) => {
    expect(tokenize(text, ',').records).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('does not emit a record for a single trailing newline', () => {
    expect(tokenize('a,b\n', ',').records).toEqual([['a', 'b']])
    expect(tokenize('a,b\r\n', ',').records).toEqual([['a', 'b']])
  })

  it('keeps blank lines as single empty-cell records so row numbers match the file', () => {
    expect(tokenize('a,b\n\nc,d\n\n\n', ',').records).toEqual([['a', 'b'], [''], ['c', 'd'], [''], ['']])
  })

  it('preserves empty cells, including a trailing one', () => {
    expect(tokenize('a,,c,', ',').records).toEqual([['a', '', 'c', '']])
  })

  it('strips a leading BOM character', () => {
    expect(tokenize('\uFEFFDate,Amount', ',').records).toEqual([['Date', 'Amount']])
  })

  it('emits a record for a lone empty quoted field', () => {
    expect(tokenize('""', ',').records).toEqual([['']])
  })

  it('treats a quote in the middle of an unquoted field as a literal', () => {
    expect(tokenize('5" pipe,ab"c,x', ',').records).toEqual([['5" pipe', 'ab"c', 'x']])
  })

  it('opens a quoted field after spaces following the delimiter', () => {
    expect(tokenize('a, "b,c" ,d', ',').records).toEqual([['a', 'b,c ', 'd']])
  })

  it('keeps text after a closing quote as part of the field', () => {
    expect(tokenize('"abc"def,x', ',').records).toEqual([['abcdef', 'x']])
  })

  it('treats a second quoted section in one field as literal quotes', () => {
    expect(tokenize('"a" "b",c', ',').records).toEqual([['a "b"', 'c']])
  })

  describe('unterminated quotes', () => {
    it('reports the row, keeps the raw line as a one-cell record, and tokenizes the rest', () => {
      const result = tokenize('h1,h2\n1,"oops,2\n3,4\n5,6', ',')
      expect(result.errors).toEqual([{ row: 2, message: 'Row 2 has an opening quote with no closing quote.' }])
      expect(result.records).toEqual([['h1', 'h2'], ['1,"oops,2'], ['3', '4'], ['5', '6']])
    })

    it('handles an unterminated quote on the last line', () => {
      const result = tokenize('a,b\n1,"oops', ',')
      expect(result.errors).toHaveLength(1)
      expect(result.records).toEqual([['a', 'b'], ['1,"oops']])
    })

    it('resumes after a CRLF line break', () => {
      const result = tokenize('a,b\r\n1,"oops\r\n3,4\r\n', ',')
      expect(result.errors).toHaveLength(1)
      expect(result.records).toEqual([['a', 'b'], ['1,"oops'], ['3', '4']])
    })

    it('resumes after a bare CR line break', () => {
      expect(tokenize('1,"oops\r3,4', ',').records).toEqual([['1,"oops'], ['3', '4']])
    })

    it('counts a multi-line record as one row when numbering the error', () => {
      const result = tokenize('a,b\n"x\ny",1\nbad,"oops\n3,4', ',')
      expect(result.errors).toEqual([{ row: 3, message: 'Row 3 has an opening quote with no closing quote.' }])
      expect(result.records).toEqual([['a', 'b'], ['x\ny', '1'], ['bad,"oops'], ['3', '4']])
    })

    it('numbers the error by the position of the record after blank lines', () => {
      const result = tokenize('a,b\n\n\n1,"oops\n3,4', ',')
      expect(result.errors.map(e => e.row)).toEqual([4])
    })
  })

  describe('maxRecords', () => {
    it('stops after the requested number of records', () => {
      expect(tokenizeRecords('a\nb\nc\nd', ',', 2).records).toEqual([['a'], ['b']])
    })

    it('does not report an unterminated quote that lies beyond the limit', () => {
      const result = tokenizeRecords('a,b\n"never closed', ',', 1)
      expect(result).toEqual({ records: [['a', 'b']], errors: [] })
    })
  })

  it('tokenizes 50,000 records quickly', () => {
    const text = Array.from({ length: 50_000 }, (_, i) => `2026-01-01,"Shop ${i}, Inc",-1.00`).join('\n')
    const started = Date.now()
    expect(tokenize(text, ',').records).toHaveLength(50_000)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
