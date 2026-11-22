import { describe, it, expect } from 'vitest'
import { sniffDelimiter } from './delimiter'

describe('sniffDelimiter', () => {
  it('detects a comma', () => {
    expect(sniffDelimiter('Date,Description,Amount\n2026-01-01,Shop,-5.00\n2026-01-02,Cafe,-3.00')).toBe(',')
  })

  it('detects a semicolon even when amounts use comma decimals', () => {
    const text = 'Datum;Text;Betrag\n01.01.2026;Laden;-5,00\n02.01.2026;Cafe;-3,50\n03.01.2026;Gehalt;2.000,00'
    expect(sniffDelimiter(text)).toBe(';')
  })

  it('detects a tab', () => {
    expect(sniffDelimiter('Date\tDescription\tAmount\n2026-01-01\tShop, Inc\t-5.00')).toBe('\t')
  })

  it('detects a pipe', () => {
    expect(sniffDelimiter('Date|Description|Amount\n2026-01-01|Shop|-5.00')).toBe('|')
  })

  it('ignores delimiters inside quoted fields', () => {
    const text = 'Date;Memo;Amount\n2026-01-01;"a, b, c, d";-5\n2026-01-02;"x, y, z";-6'
    expect(sniffDelimiter(text)).toBe(';')
  })

  it('is not thrown off by a one-cell preamble above the header', () => {
    const text = 'Account statement\nDate;Text;Amount\n01.01.2026;Shop;-5,00\n02.01.2026;Cafe;-3,00'
    expect(sniffDelimiter(text)).toBe(';')
  })

  it('works with CRLF line endings', () => {
    expect(sniffDelimiter('a;b;c\r\n1;2;3\r\n4;5;6\r\n')).toBe(';')
  })

  it('prefers the wider split when two delimiters agree equally', () => {
    expect(sniffDelimiter('a,b;c;d\n1,2;3;4')).toBe(';')
  })

  it('prefers the comma when delimiters tie completely', () => {
    expect(sniffDelimiter('a,b|c\n1,2|3')).toBe(',')
  })

  it('defaults to a comma for a single-column file', () => {
    expect(sniffDelimiter('Amount\n5\n6')).toBe(',')
  })

  it('defaults to a comma for empty or blank text', () => {
    expect(sniffDelimiter('')).toBe(',')
    expect(sniffDelimiter('\n\n  \n')).toBe(',')
  })

  it('only looks at the first 20 records', () => {
    const header = Array.from({ length: 20 }, () => 'a;b;c').join('\n')
    const noise = Array.from({ length: 200 }, () => 'x,y,z,w,v').join('\n')
    expect(sniffDelimiter(`${header}\n${noise}`)).toBe(';')
  })
})
