import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { makeReview, makeSeries } from '../../../test/reviewFixtures'
import type { AnnualReview, NetWorthReview } from '../types'
import ReviewNetWorth, { summarizeNetWorth } from './ReviewNetWorth'

const netWorth = (overrides: Partial<NetWorthReview> = {}): NetWorthReview => ({
  ...makeReview().netWorth,
  ...overrides,
})
const renderSection = (review: AnnualReview = makeReview()) =>
  render(
    <MemoryRouter>
      <ReviewNetWorth review={review} />
    </MemoryRouter>,
  )
const stat = (label: string) => screen.getByText(label).closest('div') as HTMLElement

describe('ReviewNetWorth', () => {
  it('shows the W1 headline: change, percent and both anchors', () => {
    renderSection()

    expect(screen.getByRole('region', { name: 'Net worth' })).toBeInTheDocument()
    expect(stat('Net worth change').querySelector('.ar-stat__value')).toHaveTextContent('Up $60,000')
    expect(within(stat('Net worth change')).getByText('15.0%')).toBeInTheDocument()
    expect(within(stat('Starting net worth')).getByText('$400,000')).toBeInTheDocument()
    expect(within(stat('Starting net worth')).getByText('Dec 2024')).toBeInTheDocument()
    expect(within(stat('Ending net worth')).getByText('$460,000')).toBeInTheDocument()
  })

  it('conveys a decrease with the word Down', () => {
    renderSection(
      makeReview({ netWorth: netWorth({ change: -3200, changePct: -0.8, end: { ...netWorth().end, total: 396800 } }) }),
    )

    const value = stat('Net worth change').querySelector('.ar-stat__value') as HTMLElement
    expect(value).toHaveTextContent('Down $3,200')
    expect(within(value).getByText('Down')).toHaveClass('sr-only')
    expect(within(stat('Net worth change')).getByText('-0.8%')).toBeInTheDocument()
  })

  it('says No change when the change rounds to zero', () => {
    renderSection(makeReview({ netWorth: netWorth({ change: 0, changePct: 0 }) }))

    expect(within(stat('Net worth change')).getByText('No change')).toBeInTheDocument()
  })

  it('says the percent is not available when the start is zero', () => {
    renderSection(
      makeReview({
        netWorth: netWorth({
          start: { month: '2024-12', total: 0, status: 'exact', missing: [] },
          change: 460000,
          changePct: null,
        }),
      }),
    )

    expect(stat('Net worth change').querySelector('.ar-stat__value')).toHaveTextContent('Up $460,000')
    expect(screen.getByText('Percent change not available')).toBeInTheDocument()
  })

  it('renders negative net worth as negative dollars', () => {
    renderSection(
      makeReview({
        netWorth: netWorth({
          start: { month: '2024-12', total: -20000, status: 'exact', missing: [] },
          end: { month: '2025-12', total: -5000, status: 'exact', missing: [] },
          change: 15000,
          changePct: 75,
          startNegative: true,
        }),
      }),
    )

    expect(within(stat('Starting net worth')).getByText('-$20,000')).toBeInTheDocument()
    expect(within(stat('Ending net worth')).getByText('-$5,000')).toBeInTheDocument()
    expect(stat('Net worth change').querySelector('.ar-stat__value')).toHaveTextContent('Up $15,000')
    expect(within(stat('Net worth change')).getByText('75.0%')).toBeInTheDocument()
  })

  it('shows Not available for the change when an anchor month is incomplete, and keeps the chart', () => {
    renderSection(
      makeReview({
        netWorth: netWorth({
          end: { month: '2025-12', total: 30000, status: 'incomplete', missing: [{ id: 2, name: '401k' }] },
          change: null,
          changePct: null,
          series: makeSeries(2025, { 11: 130000, 12: 30000 }, [12]),
        }),
      }),
    )

    expect(within(stat('Net worth change')).getByText('Not available')).toBeInTheDocument()
    expect(within(stat('Ending net worth')).getByText('Dec 2025, incomplete')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Net worth change is not available for 2025. 2 of 12 months have balances.' }),
    ).toBeInTheDocument()
  })

  it('names the real months of a nearest anchor', () => {
    renderSection(
      makeReview({
        netWorth: netWorth({
          start: { month: '2025-03', total: 50000, status: 'nearest', missing: [] },
          change: 12000,
          changePct: 24,
        }),
      }),
    )

    expect(within(stat('Starting net worth')).getByText('Mar 2025')).toBeInTheDocument()
    expect(within(stat('Net worth change')).getByText('24.0%')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /from \$50,000 in March 2025 to \$460,000 in December 2025/ }),
    ).toBeInTheDocument()
  })

  it('shows the prior-year comparison under the change when the prior year exists', () => {
    renderSection(makeReview({ prior: { netWorthChange: 55000, income: null, expenses: null, savingsRate: null } }))

    const prior = stat('Net worth change').querySelector('.ar-stat__prior') as HTMLElement
    expect(prior).toHaveTextContent('vs. 2024: ↗Up $5,000')
    expect(within(prior).getByText('Up')).toHaveClass('sr-only')
  })

  it('shows no net worth prior-year line for a year in progress, since a part year is not comparable', () => {
    renderSection(
      makeReview({
        status: 'in-progress',
        prior: { netWorthChange: 55000, income: null, expenses: null, savingsRate: null },
      }),
    )

    expect(screen.queryByText(/^vs\. /)).not.toBeInTheDocument()
  })

  it('shows no prior-year line without a prior year', () => {
    renderSection()

    expect(screen.queryByText(/^vs\. /)).not.toBeInTheDocument()
  })

  it('describes the chart in words', () => {
    renderSection()

    expect(
      screen.getByRole('group', {
        name: 'Net worth rose from $400,000 in December 2024 to $460,000 in December 2025.',
      }),
    ).toBeInTheDocument()
  })

  it('has no monthly values toggle or table', () => {
    renderSection()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  describe('a year without balances', () => {
    const noBalances = makeReview({
      netWorth: netWorth({
        start: { month: null, total: null, status: 'missing', missing: [] },
        end: { month: null, total: null, status: 'missing', missing: [] },
        change: null,
        changePct: null,
        series: makeSeries(2025),
      }),
    })

    it('reads Not available, says why, and links to Wealth instead of drawing a chart', () => {
      renderSection(noBalances)

      expect(within(stat('Net worth change')).getByText('Not available')).toBeInTheDocument()
      expect(screen.getByText(/No balances for 2025/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Go to Wealth' })).toHaveAttribute('href', '/net-worth/dashboard')
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })
})

describe('summarizeNetWorth', () => {
  it('says fell for a decrease', () => {
    const review = makeReview({ netWorth: netWorth({ change: -100, end: { ...netWorth().end, total: 399900 } }) })

    expect(summarizeNetWorth(review)).toBe(
      'Net worth fell from $400,000 in December 2024 to $399,900 in December 2025.',
    )
  })

  it('says unchanged when the change rounds to zero', () => {
    const review = makeReview({ netWorth: netWorth({ change: 0, end: { ...netWorth().end, total: 400000 } }) })

    expect(summarizeNetWorth(review)).toBe('Net worth was unchanged at $400,000 from December 2024 to December 2025.')
  })

  it('uses the real anchor months for an in-progress year', () => {
    const review = makeReview({
      netWorth: netWorth({ end: { month: '2025-10', total: 483000, status: 'nearest', missing: [] }, change: 83000 }),
    })

    expect(summarizeNetWorth(review)).toBe('Net worth rose from $400,000 in December 2024 to $483,000 in October 2025.')
  })
})
