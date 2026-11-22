import { describe, it, expect } from 'vitest'
import { plural } from './plural'

describe('plural', () => {
  it('uses the singular form for exactly one', () => {
    expect(plural(1, 'row', 'rows')).toBe('row')
  })

  it('uses the plural form for zero', () => {
    expect(plural(0, 'row', 'rows')).toBe('rows')
  })

  it('uses the plural form for counts above one', () => {
    expect(plural(2, 'category', 'categories')).toBe('categories')
    expect(plural(50000, 'row', 'rows')).toBe('rows')
  })

  it('uses the plural form for negative and fractional counts', () => {
    expect(plural(-1, 'row', 'rows')).toBe('rows')
    expect(plural(1.5, 'row', 'rows')).toBe('rows')
  })
})
