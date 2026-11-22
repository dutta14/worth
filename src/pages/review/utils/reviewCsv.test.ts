import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeReview, makeSeries } from '../../../test/reviewFixtures'
import { parseCSV } from '../../../utils/csvUtils'
import type { AnnualReview, NetWorthReview } from '../types'
import { buildReviewCsv, CSV_HEADER, downloadReviewCsv, reviewCsvFilename } from './reviewCsv'

const GENERATED = '2026-11-08'

const W1_CSV = `section,item,label,value,unit,share_percent,note
report,year,Year,2025,year,,
report,status,Review status,complete,text,,
report,generated,Generated on,2026-11-08,date,,
networth,start_month,Starting month,2024-12,month,,exact
networth,start,Starting net worth,400000.00,usd,,
networth,end_month,Ending month,2025-12,month,,exact
networth,end,Ending net worth,460000.00,usd,,
networth,change,Net worth change,60000.00,usd,,
networth,change_percent,Net worth change percent,15.00,percent,,
cashflow,source,Cashflow source,budget,text,,12 of 12 months
cashflow,income,Income,120000.00,usd,,
cashflow,expenses,Expenses,78000.00,usd,,
cashflow,savings,Savings,42000.00,usd,,
cashflow,savings_rate,Savings rate,35.00,percent,,
spending,group_1,Housing,30000.00,usd,38.46,
spending,group_2,Food,15000.00,usd,19.23,
spending,group_3,Transport,9000.00,usd,11.54,
spending,group_4,Travel,8000.00,usd,10.26,
spending,group_5,Health,6000.00,usd,7.69,
spending,other,All other groups,10000.00,usd,12.82,2 groups
goals,goal_12_start,Retire at 55,15.00,percent,,FI balance 300000.00 usd of 2000000.00 usd target
goals,goal_12_end,Retire at 55,19.00,percent,,FI balance 380000.00 usd of 2000000.00 usd target
`

const netWorth = (overrides: Partial<NetWorthReview>): AnnualReview['netWorth'] => ({
  ...makeReview().netWorth,
  ...overrides,
})

const rowsOf = (review: AnnualReview) => parseCSV(buildReviewCsv(review, GENERATED))
const rowFor = (review: AnnualReview, item: string) => rowsOf(review).find(r => r[1] === item)

describe('buildReviewCsv', () => {
  it('produces exactly the sample layout for a clean year (W1)', () => {
    expect(buildReviewCsv(makeReview(), GENERATED)).toBe(W1_CSV)
  })

  it('starts with the fixed header, uses LF, and ends with one trailing newline', () => {
    const csv = buildReviewCsv(makeReview(), GENERATED)

    expect(csv.split('\n')[0]).toBe(CSV_HEADER.join(','))
    expect(csv).not.toContain('\r')
    expect(csv.endsWith('\n')).toBe(true)
    expect(csv.endsWith('\n\n')).toBe(false)
  })

  it('gives every row exactly seven cells', () => {
    const review = makeReview({ notes: [{ code: 'single-month' }] })

    for (const row of rowsOf(review)) expect(row).toHaveLength(7)
  })

  it('writes in_progress for a year in progress', () => {
    expect(rowFor(makeReview({ status: 'in-progress' }), 'status')?.[3]).toBe('in_progress')
  })

  it('leaves the change blank with a reason when the percent is not available (W3)', () => {
    const review = makeReview({
      netWorth: netWorth({
        start: { month: '2024-12', total: 0, status: 'exact', missing: [] },
        end: { month: '2025-12', total: 8000, status: 'exact', missing: [] },
        change: 8000,
        changePct: null,
      }),
    })

    expect(rowFor(review, 'start')?.[3]).toBe('0.00')
    expect(rowFor(review, 'change')?.slice(3, 7)).toEqual(['8000.00', 'usd', '', ''])
    expect(rowFor(review, 'change_percent')?.slice(3, 7)).toEqual([
      '',
      'percent',
      '',
      'Percent change not available, starting net worth is 0',
    ])
  })

  it('leaves an incomplete end blank and names the missing account (W7)', () => {
    const review = makeReview({
      netWorth: netWorth({
        end: { month: '2025-12', total: 30000, status: 'incomplete', missing: [{ id: 2, name: '401k' }] },
        change: null,
        changePct: null,
      }),
    })

    expect(rowFor(review, 'end_month')?.slice(3, 7)).toEqual(['2025-12', 'month', '', 'incomplete, missing 401k'])
    expect(rowFor(review, 'end')?.slice(3, 7)).toEqual(['', 'usd', '', 'incomplete, missing 401k; no total'])
    expect(rowFor(review, 'change')?.[6]).toBe('Ending net worth is not available')
    expect(rowFor(review, 'change_percent')?.[6]).toBe('Ending net worth is not available')
  })

  it('names the anchor status for a nearest month', () => {
    const review = makeReview({
      netWorth: netWorth({ start: { month: '2025-03', total: 50000, status: 'nearest', missing: [] } }),
    })

    expect(rowFor(review, 'start_month')?.slice(3, 7)).toEqual(['2025-03', 'month', '', 'nearest'])
    expect(rowFor(review, 'start')?.[3]).toBe('50000.00')
  })

  it('reports empty month cells and reasons when both anchors are missing', () => {
    const review = makeReview({
      status: 'empty',
      netWorth: netWorth({
        start: { month: null, total: null, status: 'missing', missing: [] },
        end: { month: null, total: null, status: 'missing', missing: [] },
        change: null,
        changePct: null,
        series: makeSeries(2025),
      }),
    })

    expect(rowFor(review, 'status')?.[3]).toBe('empty')
    expect(rowFor(review, 'start_month')?.slice(3, 7)).toEqual(['', 'month', '', 'missing'])
    expect(rowFor(review, 'start')?.[6]).toBe('missing; no total')
    expect(rowFor(review, 'change')?.[6]).toBe('Starting and ending net worth are not available')
  })

  it('explains an unavailable change when only the start is unusable, and when both are in the same month', () => {
    const noStart = makeReview({
      netWorth: netWorth({
        start: { month: null, total: null, status: 'missing', missing: [] },
        change: null,
        changePct: null,
      }),
    })
    const sameMonth = makeReview({ netWorth: netWorth({ change: null, changePct: null }) })

    expect(rowFor(noStart, 'change')?.[6]).toBe('Starting net worth is not available')
    expect(rowFor(sameMonth, 'change')?.[6]).toBe('Only one month of balances is recorded')
  })

  it('shows a negative savings rate and negative savings as negative numbers (W9)', () => {
    const review = makeReview({
      cashflow: { ...makeReview().cashflow, income: 60000, expenses: 66000, savings: -6000, savingsRate: -10 },
    })

    expect(rowFor(review, 'savings')?.[3]).toBe('-6000.00')
    expect(rowFor(review, 'savings_rate')?.[3]).toBe('-10.00')
  })

  it('never writes -0.00', () => {
    const review = makeReview({ cashflow: { ...makeReview().cashflow, savings: -0.001, savingsRate: -0 } })

    expect(rowFor(review, 'savings')?.[3]).toBe('0.00')
    expect(rowFor(review, 'savings_rate')?.[3]).toBe('0.00')
  })

  it('leaves the savings rate blank with the reason when there is no income (W8)', () => {
    const review = makeReview({
      cashflow: { ...makeReview().cashflow, income: 0, expenses: 5000, savings: -5000, savingsRate: null },
    })

    expect(rowFor(review, 'savings_rate')?.slice(3, 7)).toEqual(['', 'percent', '', 'No income recorded'])
  })

  it('describes a manual source, leaves unrecorded figures blank, and omits spending (W10)', () => {
    const review = makeReview({
      cashflow: {
        source: 'manual',
        income: 90000,
        expenses: null,
        savings: null,
        savingsRate: null,
        monthsCovered: [],
        gapMonths: [],
        unreadableMonths: [],
        mismatch: null,
      },
      spending: null,
    })

    expect(rowFor(review, 'source')?.slice(3, 7)).toEqual(['manual', 'text', '', 'Yearly log in Growth'])
    expect(rowFor(review, 'expenses')?.slice(3, 7)).toEqual(['', 'usd', '', 'Not recorded'])
    expect(rowFor(review, 'savings_rate')?.[6]).toBe('Not recorded')
    expect(rowsOf(review).some(r => r[0] === 'spending')).toBe(false)
  })

  it('counts covered months for a partial budget year', () => {
    const review = makeReview({
      cashflow: {
        ...makeReview().cashflow,
        source: 'budget-partial',
        monthsCovered: ['2025-01', '2025-02', '2025-03'],
        gapMonths: ['2025-04'],
      },
    })

    expect(rowFor(review, 'source')?.[6]).toBe('3 of 4 months')
  })

  it('says there is no income or expense data when the source is none', () => {
    const review = makeReview({
      cashflow: {
        ...makeReview().cashflow,
        source: 'none',
        income: null,
        expenses: null,
        savings: null,
        savingsRate: null,
        monthsCovered: [],
      },
      spending: null,
    })

    expect(rowFor(review, 'source')?.[6]).toBe('No income or expense data')
    expect(rowFor(review, 'income')?.[6]).toBe('No income or expense data')
    expect(rowFor(review, 'savings_rate')?.[6]).toBe('No income or expense data')
  })

  it('omits the other row when there is no remainder and singularizes one group', () => {
    const base = makeReview().spending!
    const none = makeReview({ spending: { ...base, other: null } })
    const one = makeReview({ spending: { ...base, other: { count: 1, amount: 5000, share: 6.41 } } })

    expect(rowFor(none, 'other')).toBeUndefined()
    expect(rowFor(one, 'other')?.[6]).toBe('1 group')
  })

  it('writes unavailable goal values as blank cells with a reason', () => {
    const review = makeReview({
      goals: [
        {
          goalId: 7,
          name: 'House',
          target: 500000,
          startBalance: null,
          endBalance: 100000,
          startPct: null,
          endPct: 20,
        },
        { goalId: 8, name: 'Car', target: 30000, startBalance: null, endBalance: null, startPct: null, endPct: null },
      ],
    })

    expect(rowFor(review, 'goal_7_start')?.slice(3, 7)).toEqual(['', 'percent', '', 'Not available'])
    expect(rowFor(review, 'goal_7_end')?.slice(3, 7)).toEqual([
      '20.00',
      'percent',
      '',
      'FI balance 100000.00 usd of 500000.00 usd target',
    ])
    expect(rowFor(review, 'goal_8_end')?.slice(3, 7)).toEqual(['', 'percent', '', 'Not available'])
  })

  it('writes the same note sentences the page shows, numbered in order', () => {
    const review = makeReview({
      notes: [{ code: 'single-month' }, { code: 'income-zero' }],
    })

    expect(rowFor(review, 'note_1')).toEqual([
      'notes',
      'note_1',
      'Note',
      'Only one month of balances is recorded, so there is no change to show.',
      'text',
      '',
      '',
    ])
    expect(rowFor(review, 'note_2')?.[3]).toBe('Savings rate is not available because no income is recorded for 2025.')
  })

  describe('quoting and formula safety', () => {
    const withGroup = (name: string) =>
      makeReview({
        spending: {
          top: [{ id: 'g', name, amount: 10, share: 100 }],
          other: null,
          refundOnlyTotal: 0,
          uncategorizedShare: null,
        },
      })

    it('quotes commas, quotes and newlines and round-trips through parseCSV', () => {
      const name = 'Dining, "out"\nand about'
      const csv = buildReviewCsv(withGroup(name), GENERATED)

      expect(csv).toContain('"Dining, ""out""\nand about"')
      expect(parseCSV(csv).find(r => r[1] === 'group_1')?.[2]).toBe(name)
    })

    it.each(['=SUM(A1)', '+cmd', '-cmd', '@home', '\tTabbed', '\rReturn', '-5 off'])(
      'prefixes a single quote to the text cell %j',
      name => {
        expect(rowFor(withGroup(name), 'group_1')?.[2]).toBe(`'${name}`)
      },
    )

    it.each(['-5', '+5', '1.5', '-.5', 'Housing', 'a=b'])('leaves %j unchanged', name => {
      expect(rowFor(withGroup(name), 'group_1')?.[2]).toBe(name)
    })

    it('protects note and label cells too', () => {
      const review = makeReview({
        goals: [
          { goalId: 3, name: '=HYPERLINK("x")', target: 100, startBalance: 1, endBalance: 2, startPct: 1, endPct: 2 },
        ],
      })

      expect(rowFor(review, 'goal_3_end')?.[2]).toBe(`'=HYPERLINK("x")`)
    })
  })
})

describe('reviewCsvFilename', () => {
  it('names the file by year', () => {
    expect(reviewCsvFilename(2025)).toBe('worth-annual-review-2025.csv')
  })
})

describe('downloadReviewCsv', () => {
  afterEach(() => vi.restoreAllMocks())

  it('saves a UTF-8 CSV blob under the review filename and releases the object URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:csv')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadReviewCsv('a,b\n', 2025)

    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
    expect(blob.type).toBe('text/csv;charset=utf-8;')
    expect(await blob.text()).toBe('a,b\n')
    const anchor = click.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('worth-annual-review-2025.csv')
    expect(anchor.getAttribute('href')).toBe('blob:csv')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
  })
})
