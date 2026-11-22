import { describe, it, expect } from 'vitest'
import { parseAmountToCents } from './parseAmount'

describe('parseAmountToCents with a period decimal', () => {
  it.each([
    ['50', 5000],
    ['50.00', 5000],
    ['12.5', 1250],
    ['0.07', 7],
    ['.50', 50],
    ['007.50', 750],
    ['1234.56', 123456],
    ['1,234.56', 123456],
    ['1,234,567.89', 123456789],
    ['-45.00', -4500],
    ['+75.00', 7500],
    ['12.50-', -1250],
    ['12.50+', 1250],
    ['(1,234.50)', -123450],
    ['($1,234.50)', -123450],
    ['$(1,234.50)', -123450],
    ['(1,234.50) USD', -123450],
    ['$1,234.50', 123450],
    ['$2,000.00', 200000],
    ['-$5.00', -500],
    ['$-5.00', -500],
    ['- $ 5.00', -500],
    ['€12.00', 1200],
    ['£3.10', 310],
    ['¥500', 50000],
    ['₹99.99', 9999],
    ['-GBP 45.00', -4500],
    ['GBP -45.00', -4500],
    ['USD 12', 1200],
    ['45.00 EUR', 4500],
    ['45.00- eur', -4500],
    ['\u2212 5.25', -525],
    ['  7.00  ', 700],
    ['\u00A01\u00A0234.50\u00A0', 123450],
    ["1'234.50", 123450],
    ['1\u2019234.50', 123450],
    ['1 234.50', 123450],
    ['1\u00A0234.50', 123450],
    ['12.500', 1250],
    ['12.5000', 1250],
    ['9007199254740.99', 900719925474099],
  ])('parses %j as %d cents', (text, cents) => {
    expect(parseAmountToCents(text, '.')).toBe(cents)
  })

  it('returns exactly 0, never negative zero', () => {
    expect(Object.is(parseAmountToCents('-0.00', '.'), 0)).toBe(true)
    expect(Object.is(parseAmountToCents('(0)', '.'), 0)).toBe(true)
  })

  it('is exact where floating point is not', () => {
    expect(parseAmountToCents('0.1', '.')).toBe(10)
    expect(parseAmountToCents('1.15', '.')).toBe(115)
    expect(parseAmountToCents('4.35', '.')).toBe(435)
    expect(parseAmountToCents('1234567.89', '.')).toBe(123456789)
  })

  it.each([
    '',
    '   ',
    '$',
    '-',
    '()',
    'abc',
    '12abc',
    'N/A',
    '1.2.3',
    '1,23',
    '1,2345',
    '12,34,56',
    '1 2 3',
    '1,234 567',
    '--5',
    '-5-',
    '+-5',
    '(-5)',
    '(5)-',
    '5.',
    '12.345',
    '1.5e3',
    'Infinity',
    'NaN',
    '12.50 DR',
    '0x10',
    '10000000000000',
    '1,234.5.6',
    `5${' '.repeat(100)}`,
    '1'.repeat(65),
  ])('rejects %j', text => {
    expect(parseAmountToCents(text, '.')).toBeNull()
  })
})

describe('parseAmountToCents with a comma decimal', () => {
  it.each([
    ['1.234,56', 123456],
    ['1,5', 150],
    ['0,07', 7],
    [',50', 50],
    ['1234,56', 123456],
    ['-1.234,56', -123456],
    ['1.234.567,89', 123456789],
    ['1 234,56', 123456],
    ['1\u00A0234,56', 123456],
    ["1'234,56", 123456],
    ['(1.234,56)', -123456],
    ['1.234,56-', -123456],
    ['€ 1.234,56', 123456],
    ['1.234,56 €', 123456],
    ['-45,00 EUR', -4500],
    ['1.234', 123400],
    ['12', 1200],
    ['12,500', 1250],
  ])('parses %j as %d cents', (text, cents) => {
    expect(parseAmountToCents(text, ',')).toBe(cents)
  })

  it.each(['1,234,56', '1.2345', '1.234,5.6', '1,2,3', '12,345'])('rejects %j', text => {
    expect(parseAmountToCents(text, ',')).toBeNull()
  })

  it('does not treat a comma-decimal value as thousands when the decimal is a period', () => {
    expect(parseAmountToCents('1,5', '.')).toBeNull()
    expect(parseAmountToCents('1.234,56', '.')).toBeNull()
  })
})
