import { describe, expect, it } from 'vitest'
import { makeReview } from '../../../test/reviewFixtures'
import type { AnnualReview, ReviewNote } from '../types'
import { describeNote, describeNoteCount } from './noteText'

const text = (note: ReviewNote, review: AnnualReview = makeReview()) => describeNote(note, review).text
const withNearestStart = (start: string): AnnualReview => {
  const base = makeReview()
  return makeReview({
    netWorth: { ...base.netWorth, start: { month: start, total: 50000, status: 'nearest', missing: [] } },
  })
}

describe('describeNote', () => {
  it('names the month and every missing account, with a link to the spreadsheet', () => {
    const note: ReviewNote = {
      code: 'anchor-incomplete',
      which: 'end',
      month: '2025-12',
      accounts: [
        { id: 2, name: '401k' },
        { id: 3, name: 'Roth IRA' },
      ],
    }
    expect(describeNote(note, makeReview())).toEqual({
      text: 'December 2025 is missing a balance for 401k and Roth IRA. Add it in the spreadsheet to see the change for this year.',
      link: { label: 'Open the spreadsheet', to: '/net-worth/dashboard/spreadsheet' },
    })
  })

  it('says when balances start inside the review year', () => {
    expect(text({ code: 'anchor-nearest', which: 'start', month: '2025-03' }, withNearestStart('2025-03'))).toBe(
      'Your balances start in Mar 2025, so the change covers Mar 2025 to Dec 2025.',
    )
  })

  it('says the starting December is missing when the start falls back to an earlier month', () => {
    expect(text({ code: 'anchor-nearest', which: 'start', month: '2024-11' }, withNearestStart('2024-11'))).toBe(
      'There are no balances for December 2024. The change starts from Nov 2024.',
    )
  })

  it('says the end December is missing and where the change runs to', () => {
    expect(text({ code: 'anchor-nearest', which: 'end', month: '2025-10' })).toBe(
      'There are no balances for December 2025. The change runs to Oct 2025.',
    )
  })

  it('says the year is in progress through a month name', () => {
    expect(text({ code: 'in-progress', throughMonth: '2025-10' })).toBe(
      '2025 is still in progress. This review covers January to October.',
    )
  })

  it('words the single-month and negative-start notes', () => {
    expect(text({ code: 'single-month' })).toBe(
      'Only one month of balances is recorded, so there is no change to show.',
    )
    expect(text({ code: 'negative-start' })).toBe(
      'Net worth was negative at the start of the year, so the percent is relative to the size of that figure.',
    )
  })

  it('lists the months with missing transactions and links to Cashflow', () => {
    expect(
      describeNote(
        { code: 'budget-partial', gapMonths: ['2025-03', '2025-04', '2025-09'], covered: 9, expected: 12 },
        makeReview(),
      ),
    ).toEqual({
      text: 'Transactions are missing for Mar 2025, Apr 2025, and Sep 2025. Income and expenses cover 9 of 12 months.',
      link: { label: 'Open Cashflow', to: '/budget' },
    })
  })

  it('counts unreadable files with the right plural', () => {
    expect(text({ code: 'unreadable', months: ['2025-02'] })).toBe(
      '1 transaction file could not be read and is left out: Feb 2025.',
    )
    expect(text({ code: 'unreadable', months: ['2025-02', '2025-03'] })).toBe(
      '2 transaction files could not be read and are left out: Feb 2025 and Mar 2025.',
    )
  })

  it('links the manual source note to Growth', () => {
    const { text: t, link } = describeNote({ code: 'source-manual' }, makeReview())
    expect(t).toBe(
      'Income and savings come from the yearly log in Growth. Add transactions in Cashflow for a breakdown by group.',
    )
    expect(link).toEqual({ label: 'Open Growth', to: '/net-worth/growth/savings' })
  })

  describe('mismatch', () => {
    const base = { manualIncome: 120000, manualSavings: 42000, budgetIncome: 120000, budgetSavings: 42000 }
    const review = (mismatch: Partial<NonNullable<AnnualReview['cashflow']['mismatch']>>) =>
      makeReview({
        cashflow: {
          ...makeReview().cashflow,
          mismatch: { ...base, incomeDiffers: false, savingsDiffers: false, ...mismatch },
        },
      })

    it('shows the income pair when income went past the threshold', () => {
      const r = review({ manualIncome: 118000, manualSavings: 40000, incomeDiffers: true, savingsDiffers: false })
      expect(describeNote({ code: 'mismatch' }, r)).toEqual({
        text: 'Your Growth log shows $118,000 of income and your transactions add up to $120,000. This review uses your transactions.',
        link: { label: 'Open Growth', to: '/net-worth/growth/savings' },
      })
    })

    it('shows the savings pair, not a trivial income gap, when only savings went past the threshold', () => {
      const r = review({ manualIncome: 120030, manualSavings: 30000, savingsDiffers: true })
      expect(text({ code: 'mismatch' }, r)).toBe(
        'Your Growth log shows $30,000 of savings and your transactions add up to $42,000. This review uses your transactions.',
      )
    })

    it('follows the spec and shows the income pair when both went past their thresholds', () => {
      const r = review({ manualIncome: 118000, manualSavings: 30000, incomeDiffers: true, savingsDiffers: true })
      expect(text({ code: 'mismatch' }, r)).toContain('$118,000 of income')
    })

    it('still says which figures are used when no pair is flagged or there is no mismatch data', () => {
      expect(text({ code: 'mismatch' }, review({}))).toBe('This review uses your transactions.')
      expect(text({ code: 'mismatch' })).toBe('This review uses your transactions.')
    })
  })

  it('words the income-zero, refund and uncategorized notes', () => {
    expect(text({ code: 'income-zero' })).toBe('Savings rate is not available because no income is recorded for 2025.')
    expect(text({ code: 'refund-groups', amount: 300 })).toBe(
      'Refunds in groups with no net spending reduced expenses by $300.',
    )
    expect(describeNote({ code: 'uncategorized', share: 24.5 }, makeReview())).toEqual({
      text: '24.5% of spending is in Uncategorized. You can sort it in Cashflow, Groups.',
      link: { label: 'Open Groups', to: '/budget/groups' },
    })
  })
})

describe('describeNoteCount', () => {
  it('uses the singular for one note', () => {
    expect(describeNoteCount(1)).toBe('1 note about this data follows.')
  })

  it('uses the plural otherwise', () => {
    expect(describeNoteCount(3)).toBe('3 notes about this data follow.')
  })
})
