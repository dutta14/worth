import { describe, it, expect } from 'vitest'
import {
  formatDelta,
  formatIsoDate,
  formatList,
  formatMoney,
  formatAxisLabels,
  formatMonthLong,
  formatMonthName,
  formatMonthShort,
  formatPercent,
  pluralize,
} from './format'

describe('formatMoney', () => {
  it('formats whole dollars with a leading minus for negatives', () => {
    expect(formatMoney(1234.4)).toBe('$1,234')
    expect(formatMoney(-1234)).toBe('-$1,234')
    expect(formatMoney(0)).toBe('$0')
  })

  it('never shows a negative zero', () => {
    expect(formatMoney(-0.4)).toBe('$0')
  })

  it('returns Not available for null', () => {
    expect(formatMoney(null)).toBe('Not available')
  })
})

describe('formatPercent', () => {
  it('uses one decimal and a percent sign', () => {
    expect(formatPercent(15)).toBe('15.0%')
    expect(formatPercent(38.46)).toBe('38.5%')
    expect(formatPercent(-2.14)).toBe('-2.1%')
    expect(formatPercent(1234.56)).toBe('1,234.6%')
  })

  it('never shows a negative zero', () => {
    expect(formatPercent(-0.04)).toBe('0.0%')
  })

  it('returns Not available for null', () => {
    expect(formatPercent(null)).toBe('Not available')
  })
})

describe('formatDelta', () => {
  it('words money changes as Up and Down', () => {
    expect(formatDelta(60000, 'usd')).toBe('Up $60,000')
    expect(formatDelta(-3200, 'usd')).toBe('Down $3,200')
  })

  it('words percent and point changes with one decimal', () => {
    expect(formatDelta(15, 'percent')).toBe('Up 15.0%')
    expect(formatDelta(-2.14, 'percent')).toBe('Down 2.1%')
    expect(formatDelta(4, 'points')).toBe('Up 4.0 points')
    expect(formatDelta(-2.1, 'points')).toBe('Down 2.1 points')
  })

  it('uses the singular only for exactly 1.0 point', () => {
    expect(formatDelta(1, 'points')).toBe('Up 1.0 point')
    expect(formatDelta(1.04, 'points')).toBe('Up 1.0 point')
    expect(formatDelta(1.06, 'points')).toBe('Up 1.1 points')
  })

  it('says No change when the rounded value is 0', () => {
    expect(formatDelta(0, 'usd')).toBe('No change')
    expect(formatDelta(0.4, 'usd')).toBe('No change')
    expect(formatDelta(-0.04, 'points')).toBe('No change')
    expect(formatDelta(0.049, 'percent')).toBe('No change')
  })

  it('returns Not available for null', () => {
    expect(formatDelta(null, 'usd')).toBe('Not available')
  })
})

describe('formatList', () => {
  it('joins items the way a sentence would', () => {
    expect(formatList([])).toBe('')
    expect(formatList(['A'])).toBe('A')
    expect(formatList(['A', 'B'])).toBe('A and B')
    expect(formatList(['A', 'B', 'C'])).toBe('A, B, and C')
  })
})

describe('pluralize', () => {
  it('chooses singular only for exactly one', () => {
    expect(pluralize(1, 'month')).toBe('1 month')
    expect(pluralize(0, 'month')).toBe('0 months')
    expect(pluralize(2, 'account')).toBe('2 accounts')
    expect(pluralize(2, 'category', 'categories')).toBe('2 categories')
  })
})

describe('month names', () => {
  it('formats short and long months', () => {
    expect(formatMonthShort('2024-12')).toBe('Dec 2024')
    expect(formatMonthLong('2024-12')).toBe('December 2024')
    expect(formatMonthLong('2025-01')).toBe('January 2025')
  })
})

describe('formatMonthName', () => {
  it('returns the month name without the year', () => {
    expect(formatMonthName('2026-10')).toBe('October')
  })
})

describe('formatAxisLabels', () => {
  it('shortens axis values and keeps the sign', () => {
    expect(formatAxisLabels([400000, 460000])).toEqual(['$400K', '$460K'])
    expect(formatAxisLabels([-20000, 0, 20000])).toEqual(['-$20K', '$0', '$20K'])
  })

  it('adds only as many decimals as the set needs', () => {
    expect(formatAxisLabels([1_000_000, 1_500_000, 2_000_000])).toEqual(['$1M', '$1.5M', '$2M'])
    expect(formatAxisLabels([1_000_000, 1_250_000])).toEqual(['$1M', '$1.25M'])
    expect(formatAxisLabels([1_000_000, 1_005_000])).toEqual(['$1M', '$1.005M'])
  })

  it('labels small values in plain dollars', () => {
    expect(formatAxisLabels([0, 250, 500])).toEqual(['$0', '$250', '$500'])
  })

  it('shows negative zero as $0', () => {
    expect(formatAxisLabels([-0])).toEqual(['$0'])
  })
})

describe('formatIsoDate', () => {
  it('pads month and day and uses the local calendar date', () => {
    expect(formatIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatIsoDate(new Date(2026, 10, 8, 23, 59))).toBe('2026-11-08')
  })
})
