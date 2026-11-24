import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { makeReview } from '../../../test/reviewFixtures'
import type { AnnualReview, CashflowReview } from '../types'
import ReviewCashflow from './ReviewCashflow'

const cashflow = (overrides: Partial<CashflowReview> = {}): CashflowReview => ({
  ...makeReview().cashflow,
  ...overrides,
})
const renderSection = (review: AnnualReview) =>
  render(
    <MemoryRouter>
      <ReviewCashflow review={review} />
    </MemoryRouter>,
  )
const stat = (label: string) => screen.getByText(label).closest('div') as HTMLElement

describe('ReviewCashflow', () => {
  it('shows income, expenses, savings and savings rate', () => {
    renderSection(makeReview())

    expect(screen.getByRole('region', { name: 'Income and savings' })).toBeInTheDocument()
    expect(within(stat('Income')).getByText('$120,000')).toBeInTheDocument()
    expect(within(stat('Expenses')).getByText('$78,000')).toBeInTheDocument()
    expect(within(stat('Savings')).getByText('$42,000')).toBeInTheDocument()
    expect(within(stat('Savings rate')).getByText('35.0%')).toBeInTheDocument()
  })

  it('shows negative savings and a negative rate as negative values in neutral words', () => {
    renderSection(
      makeReview({ cashflow: cashflow({ income: 60000, expenses: 66000, savings: -6000, savingsRate: -10 }) }),
    )

    expect(within(stat('Savings')).getByText('-$6,000')).toBeInTheDocument()
    expect(within(stat('Savings rate')).getByText('-10.0%')).toBeInTheDocument()
    expect(screen.queryByText(/overspen|deficit|loss/i)).not.toBeInTheDocument()
  })

  it('shows Not available, never 0%, for the savings rate when income is zero', () => {
    renderSection(makeReview({ cashflow: cashflow({ income: 0, expenses: 5000, savings: -5000, savingsRate: null }) }))

    expect(within(stat('Savings rate')).getByText('Not available')).toBeInTheDocument()
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  })

  it('shows the logged income for a manual year, with unknown figures Not available', () => {
    renderSection(
      makeReview({
        cashflow: cashflow({
          source: 'manual',
          income: 90000,
          expenses: null,
          savings: null,
          savingsRate: null,
          monthsCovered: [],
        }),
      }),
    )

    expect(within(stat('Income')).getByText('$90,000')).toBeInTheDocument()
    expect(within(stat('Expenses')).getByText('Not available')).toBeInTheDocument()
    expect(within(stat('Savings')).getByText('Not available')).toBeInTheDocument()
  })

  it('shows what exists for a partly covered year', () => {
    renderSection(
      makeReview({ cashflow: cashflow({ source: 'budget-partial', income: 50000, expenses: 30000, savings: 20000 }) }),
    )

    expect(within(stat('Income')).getByText('$50,000')).toBeInTheDocument()
  })

  it('says there is no income or expense data, with a Cashflow link, when the source is none', () => {
    renderSection(
      makeReview({
        cashflow: cashflow({ source: 'none', income: null, expenses: null, savings: null, savingsRate: null }),
      }),
    )

    expect(screen.getByText(/No income or expense data for 2025/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Cashflow' })).toHaveAttribute('href', '/budget')
    expect(screen.queryByText('Income')).not.toBeInTheDocument()
  })

  describe('prior-year lines', () => {
    const prior = { netWorthChange: null, income: 115000, expenses: 80000, savingsRate: 37.1 }

    it('compares income and expenses in dollars and the savings rate in points', () => {
      renderSection(makeReview({ prior }))

      expect(stat('Income')).toHaveTextContent('vs. 2024: ↗Up $5,000')
      expect(stat('Expenses')).toHaveTextContent('vs. 2024: ↘Down $2,000')
      expect(stat('Savings rate')).toHaveTextContent('vs. 2024: ↘Down 2.1 points')
    })

    it('hides the glyph from assistive technology and keeps the direction word for screen readers', () => {
      renderSection(makeReview({ prior }))

      const glyph = within(stat('Income')).getByText('↗')
      expect(glyph).toHaveAttribute('aria-hidden', 'true')
      expect(within(stat('Income')).getByText('Up')).toHaveClass('sr-only')
    })

    it('says No change, without a glyph, when the rounded difference is zero', () => {
      renderSection(makeReview({ prior: { ...prior, income: 120000 } }))

      expect(stat('Income')).toHaveTextContent('vs. 2024: No change')
      expect(within(stat('Income')).queryByText(/[↗↘]/)).not.toBeInTheDocument()
    })

    it('drops the income and expenses comparisons for a year in progress but keeps the savings rate', () => {
      renderSection(makeReview({ status: 'in-progress', prior }))

      expect(within(stat('Income')).queryByText(/vs\./)).not.toBeInTheDocument()
      expect(within(stat('Expenses')).queryByText(/vs\./)).not.toBeInTheDocument()
      expect(stat('Savings rate')).toHaveTextContent('vs. 2024: ↘Down 2.1 points')
    })

    it('leaves out a comparison whose prior figure is unavailable', () => {
      renderSection(makeReview({ prior: { ...prior, savingsRate: null } }))

      expect(within(stat('Savings rate')).queryByText(/vs\./)).not.toBeInTheDocument()
      expect(stat('Income')).toHaveTextContent('vs. 2024: ↗Up $5,000')
    })

    it('shows no comparison when there is no prior year', () => {
      renderSection(makeReview({ prior: null }))

      expect(screen.queryByText(/^vs\. /)).not.toBeInTheDocument()
    })
  })
})
