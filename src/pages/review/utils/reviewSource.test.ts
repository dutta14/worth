import { describe, it, expect } from 'vitest'
import type { MonthCSV } from '../../budget/types'
import { monthKeysOnly, parseReviewMonths } from './reviewSource'

const csv = (month: string, body: string): MonthCSV => ({ month, csv: body, uploadedAt: '' })
const GOOD = 'Date,Category,Amount\n2025-01-05,Rent,-1200\n'

describe('parseReviewMonths', () => {
  it('parses only the requested years', () => {
    const csvs = { '2023-12': csv('2023-12', GOOD), '2024-12': csv('2024-12', GOOD), '2025-01': csv('2025-01', GOOD) }

    const { transactionsByMonth, unreadableMonths } = parseReviewMonths(csvs, [2024, 2025])

    expect(Object.keys(transactionsByMonth)).toEqual(['2024-12', '2025-01'])
    expect(transactionsByMonth['2025-01']).toHaveLength(1)
    expect(unreadableMonths).toEqual([])
  })

  it('lists an unparseable month as unreadable instead of throwing', () => {
    const csvs = { '2025-02': csv('2025-02', 'not,a,budget\n1,2,3\n'), '2025-01': csv('2025-01', GOOD) }

    const { transactionsByMonth, unreadableMonths } = parseReviewMonths(csvs, [2025])

    expect(unreadableMonths).toEqual(['2025-02'])
    expect(Object.keys(transactionsByMonth)).toEqual(['2025-01'])
  })

  it('returns empty results when no year matches', () => {
    expect(parseReviewMonths({ '2020-01': csv('2020-01', GOOD) }, [2025])).toEqual({
      transactionsByMonth: {},
      unreadableMonths: [],
    })
  })
})

describe('monthKeysOnly', () => {
  it('maps every month key to an empty list without parsing', () => {
    expect(monthKeysOnly({ '2020-01': csv('2020-01', 'garbage'), '2021-05': csv('2021-05', GOOD) })).toEqual({
      '2020-01': [],
      '2021-05': [],
    })
  })
})
