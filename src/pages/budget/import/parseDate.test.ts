import { afterEach, describe, it, expect, vi } from 'vitest'
import { DATE_FORMATS, detectDateFormats, looksLikeDate, maxPlausibleYear, parseDate } from './parseDate'
import type { DateFormat } from './types'

const MAX_YEAR = 2027

describe('parseDate', () => {
  it.each<[DateFormat, string, string]>([
    ['YYYY-MM-DD', '2026-03-04', '2026-03-04'],
    ['YYYY-MM-DD', '2026-3-4', '2026-03-04'],
    ['YYYY/MM/DD', '2026/03/04', '2026-03-04'],
    ['MM/DD/YYYY', '03/04/2026', '2026-03-04'],
    ['MM/DD/YYYY', '3/4/2026', '2026-03-04'],
    ['DD/MM/YYYY', '03/04/2026', '2026-04-03'],
    ['DD/MM/YYYY', '25/12/2026', '2026-12-25'],
    ['MM-DD-YYYY', '03-04-2026', '2026-03-04'],
    ['DD-MM-YYYY', '03-04-2026', '2026-04-03'],
    ['DD.MM.YYYY', '03.04.2026', '2026-04-03'],
    ['DD.MM.YYYY', '31.10.2026', '2026-10-31'],
    ['MM/DD/YY', '03/04/26', '2026-03-04'],
    ['DD/MM/YY', '03/04/26', '2026-04-03'],
    ['MM/DD/YY', '12/31/99', '1999-12-31'],
    ['MM/DD/YY', '01/02/05', '2005-01-02'],
    ['D MMM YYYY', '5 Jan 2026', '2026-01-05'],
    ['D MMM YYYY', '05-Jan-2026', '2026-01-05'],
    ['D MMM YYYY', '5 January 2026', '2026-01-05'],
    ['D MMM YYYY', '5 Sept. 2026', '2026-09-05'],
    ['D MMM YYYY', '5 sep 2026', '2026-09-05'],
    ['MMM D, YYYY', 'Jan 5, 2026', '2026-01-05'],
    ['MMM D, YYYY', 'May 1 2025', '2025-05-01'],
    ['MMM D, YYYY', 'December 31, 2026', '2026-12-31'],
    ['MMM D, YYYY', 'Mar 3rd, 2026', '2026-03-03'],
    ['YYYYMMDD', '20260304', '2026-03-04'],
  ])('%s parses %j as %s', (format, text, expected) => {
    expect(parseDate(text, format, { maxYear: MAX_YEAR })).toBe(expected)
  })

  it('covers all twelve supported formats', () => {
    expect(DATE_FORMATS).toHaveLength(12)
  })

  it.each([
    ['2026-03-04 10:30:00'],
    ['2026-03-04T10:30:00'],
    ['2026-03-04T10:30:00Z'],
    ['2026-03-04T10:30:00.123+05:30'],
    ['2026-03-04T10:30:00-0500'],
    ['2026-03-04 10:30'],
    ['2026-03-04 3:45 PM'],
    ['2026-03-04 3:45pm'],
    ['  2026-03-04  '],
  ])('ignores a time suffix on %j', text => {
    expect(parseDate(text, 'YYYY-MM-DD', { maxYear: MAX_YEAR })).toBe('2026-03-04')
  })

  it('ignores a time suffix on slash and named formats', () => {
    expect(parseDate('03/04/2026 14:05', 'MM/DD/YYYY', { maxYear: MAX_YEAR })).toBe('2026-03-04')
    expect(parseDate('Jan 5, 2026 9:00 AM', 'MMM D, YYYY', { maxYear: MAX_YEAR })).toBe('2026-01-05')
  })

  describe('strict calendar validation', () => {
    it.each([
      ['2026-02-30'],
      ['2026-02-29'],
      ['2026-04-31'],
      ['2026-06-31'],
      ['2026-13-01'],
      ['2026-00-10'],
      ['2026-01-00'],
      ['2026-01-32'],
    ])('rejects %j', text => {
      expect(parseDate(text, 'YYYY-MM-DD', { maxYear: MAX_YEAR })).toBeNull()
    })

    it('accepts leap days only in leap years', () => {
      expect(parseDate('2024-02-29', 'YYYY-MM-DD', { maxYear: MAX_YEAR })).toBe('2024-02-29')
      expect(parseDate('2000-02-29', 'YYYY-MM-DD', { maxYear: MAX_YEAR })).toBe('2000-02-29')
      expect(parseDate('2100-02-29', 'YYYY-MM-DD', { maxYear: 2100 })).toBeNull()
      expect(parseDate('2025-02-29', 'YYYY-MM-DD', { maxYear: MAX_YEAR })).toBeNull()
    })

    it('accepts the last day of every month', () => {
      const lastDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      lastDays.forEach((day, i) => {
        const month = String(i + 1).padStart(2, '0')
        expect(parseDate(`2026-${month}-${day}`, 'YYYY-MM-DD', { maxYear: MAX_YEAR })).toBe(`2026-${month}-${day}`)
        expect(parseDate(`2026-${month}-${day + 1}`, 'YYYY-MM-DD', { maxYear: MAX_YEAR })).toBeNull()
      })
    })

    it('rejects a day above 12 as a month', () => {
      expect(parseDate('13/01/2026', 'MM/DD/YYYY', { maxYear: MAX_YEAR })).toBeNull()
      expect(parseDate('01/13/2026', 'DD/MM/YYYY', { maxYear: MAX_YEAR })).toBeNull()
    })

    it('rejects unknown and too-short month names', () => {
      expect(parseDate('5 Foo 2026', 'D MMM YYYY', { maxYear: MAX_YEAR })).toBeNull()
      expect(parseDate('5 Ja 2026', 'D MMM YYYY', { maxYear: MAX_YEAR })).toBeNull()
      expect(parseDate('Foo 5, 2026', 'MMM D, YYYY', { maxYear: MAX_YEAR })).toBeNull()
    })
  })

  describe('year bounds', () => {
    it('accepts 1990 and the max year', () => {
      expect(parseDate('1990-01-01', 'YYYY-MM-DD', { maxYear: 2027 })).toBe('1990-01-01')
      expect(parseDate('2027-12-31', 'YYYY-MM-DD', { maxYear: 2027 })).toBe('2027-12-31')
    })

    it('rejects years before 1990 and after the max year', () => {
      expect(parseDate('1989-12-31', 'YYYY-MM-DD', { maxYear: 2027 })).toBeNull()
      expect(parseDate('2028-01-01', 'YYYY-MM-DD', { maxYear: 2027 })).toBeNull()
      expect(parseDate('0026-01-01', 'YYYY-MM-DD', { maxYear: 2027 })).toBeNull()
    })

    it('defaults the max year to next year', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
      try {
        expect(maxPlausibleYear()).toBe(2027)
        expect(parseDate('2027-01-01', 'YYYY-MM-DD')).toBe('2027-01-01')
        expect(parseDate('2028-01-01', 'YYYY-MM-DD')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('reads the current year in UTC, not the local zone, at a year boundary', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-12-31T23:30:00Z'))
      try {
        expect(maxPlausibleYear()).toBe(2027)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('rejects text of the wrong shape', () => {
    it.each([
      ['YYYY-MM-DD', '03/04/2026'],
      ['MM/DD/YYYY', '2026-03-04'],
      ['MM/DD/YYYY', '03/04/26'],
      ['MM/DD/YY', '03/04/2026'],
      ['DD.MM.YYYY', '03/04/2026'],
      ['YYYYMMDD', '2026-03-04'],
      ['YYYYMMDD', '2026030'],
      ['YYYY-MM-DD', ''],
      ['YYYY-MM-DD', 'not a date'],
      ['YYYY-MM-DD', '10:30:00'],
      ['D MMM YYYY', 'Jan 5, 2026'],
      ['MMM D, YYYY', '5 Jan 2026'],
    ] as const)('%s rejects %j', (format, text) => {
      expect(parseDate(text, format, { maxYear: MAX_YEAR })).toBeNull()
    })

    it('rejects very long text without scanning it', () => {
      const long = `2026-03-04${' '.repeat(100_000)}x`
      expect(parseDate(long, 'YYYY-MM-DD', { maxYear: MAX_YEAR })).toBeNull()
    })
  })
})

describe('looksLikeDate', () => {
  it.each(['2026-03-04', '03/04/2026', '3.4.2026', '03/04/26', '5 Jan 2026', 'Jan 5, 2026', '20260304', '2026-02-30'])(
    'recognizes the shape of %j',
    text => {
      expect(looksLikeDate(text)).toBe(true)
    },
  )

  it.each(['Date', 'Total', '', '1,234.50', 'Closing balance 01/31/2026', '12:30'])('does not recognize %j', text => {
    expect(looksLikeDate(text)).toBe(false)
  })
})

describe('detectDateFormats', () => {
  const detect = (samples: string[]) => detectDateFormats(samples, { maxYear: MAX_YEAR })

  it('returns one format for an unambiguous ISO sample', () => {
    expect(detect(['2026-03-04', '2026-03-05'])).toEqual(['YYYY-MM-DD'])
  })

  it('returns both orders for an ambiguous day/month sample', () => {
    expect(detect(['03/04/2026'])).toEqual(['MM/DD/YYYY', 'DD/MM/YYYY'])
  })

  it('stays ambiguous when every sample has both parts at or below 12', () => {
    expect(detect(['03/04/2026', '05/06/2026', '07/08/2026'])).toEqual(['MM/DD/YYYY', 'DD/MM/YYYY'])
  })

  it('resolves to DD/MM when any sample has a day above 12 in the first slot', () => {
    expect(detect(['03/04/2026', '25/04/2026'])).toEqual(['DD/MM/YYYY'])
  })

  it('resolves to MM/DD when any sample has a day above 12 in the second slot', () => {
    expect(detect(['03/04/2026', '04/25/2026'])).toEqual(['MM/DD/YYYY'])
  })

  it('keeps two-digit years ambiguous between the two orders', () => {
    expect(detect(['03/04/26'])).toEqual(['MM/DD/YY', 'DD/MM/YY'])
  })

  it('tells dash and dot formats apart from slash formats', () => {
    expect(detect(['03-04-2026'])).toEqual(['MM-DD-YYYY', 'DD-MM-YYYY'])
    expect(detect(['03.04.2026'])).toEqual(['DD.MM.YYYY'])
  })

  it('ignores blank samples and samples that fit no format', () => {
    expect(detect(['', '  ', 'Total', '2026-03-04'])).toEqual(['YYYY-MM-DD'])
  })

  it('treats a sample with an impossible calendar date as junk, not as a vote against a format', () => {
    expect(detect(['2026-02-30', '2026-03-04'])).toEqual(['YYYY-MM-DD'])
  })

  it('returns nothing when no sample parses', () => {
    expect(detect([])).toEqual([])
    expect(detect(['hello', ''])).toEqual([])
    expect(detect(['2026-02-30'])).toEqual([])
  })

  it('returns nothing when the samples use incompatible formats', () => {
    expect(detect(['2026-03-04', '25.12.2026'])).toEqual([])
  })

  it('detects named-month formats', () => {
    expect(detect(['5 Jan 2026', '12 Feb 2026'])).toEqual(['D MMM YYYY'])
    expect(detect(['Jan 5, 2026'])).toEqual(['MMM D, YYYY'])
  })

  it('treats an eight-digit number as YYYYMMDD', () => {
    expect(detect(['20260304'])).toEqual(['YYYYMMDD'])
  })

  it('defaults the max year from the clock when no option is given', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    try {
      expect(detectDateFormats(['2027-01-01'])).toEqual(['YYYY-MM-DD'])
      expect(detectDateFormats(['2028-01-01'])).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('timezone independence', () => {
  const originalTZ = process.env.TZ
  const cases: [string, DateFormat, string][] = [
    ['2026-01-01', 'YYYY-MM-DD', '2026-01-01'],
    ['2026-12-31', 'YYYY-MM-DD', '2026-12-31'],
    ['2026-03-08', 'YYYY-MM-DD', '2026-03-08'],
    ['2026-11-01', 'YYYY-MM-DD', '2026-11-01'],
    ['2024-02-29', 'YYYY-MM-DD', '2024-02-29'],
    ['05/01/2026', 'MM/DD/YYYY', '2026-05-01'],
    ['01/05/2026', 'DD/MM/YYYY', '2026-05-01'],
    ['May 1 2025', 'MMM D, YYYY', '2025-05-01'],
    ['1 Jan 2026', 'D MMM YYYY', '2026-01-01'],
    ['31.12.2026', 'DD.MM.YYYY', '2026-12-31'],
    ['2026-01-01T00:00:00Z', 'YYYY-MM-DD', '2026-01-01'],
  ]

  afterEach(() => {
    process.env.TZ = originalTZ
  })

  it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Los_Angeles', 'Asia/Kolkata', 'Australia/Lord_Howe'])(
    'gives the same dates in %s, where new Date(y, m, d).toISOString() would shift',
    zone => {
      process.env.TZ = zone
      // Prove the zone took effect: the legacy conversion must be off by a day in the extreme zones.
      const legacy = new Date(2026, 4, 1).toISOString().slice(0, 10)
      if (zone === 'Pacific/Kiritimati' || zone === 'Asia/Kolkata') expect(legacy).toBe('2026-04-30')
      for (const [text, format, expected] of cases) {
        expect(parseDate(text, format, { maxYear: MAX_YEAR })).toBe(expected)
      }
    },
  )

  it('never constructs a Date to parse a value', () => {
    const RealDate = Date
    const guard = vi.fn(() => {
      throw new Error('Date must not be used while parsing')
    })
    vi.stubGlobal('Date', guard)
    try {
      for (const [text, format, expected] of cases) {
        expect(parseDate(text, format, { maxYear: MAX_YEAR })).toBe(expected)
      }
      expect(detectDateFormats(['03/04/2026', '25/04/2026'], { maxYear: MAX_YEAR })).toEqual(['DD/MM/YYYY'])
      expect(looksLikeDate('03/04/2026')).toBe(true)
      expect(guard).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(Date).toBe(RealDate)
  })
})
