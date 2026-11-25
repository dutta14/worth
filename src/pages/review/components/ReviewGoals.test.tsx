import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { makeReview } from '../../../test/reviewFixtures'
import type { AnnualReview } from '../types'
import ReviewGoals from './ReviewGoals'

const renderSection = (review: AnnualReview = makeReview(), hasGoals = true) =>
  render(
    <MemoryRouter>
      <ReviewGoals review={review} hasGoals={hasGoals} />
    </MemoryRouter>,
  )

describe('ReviewGoals', () => {
  it('shows each goal with its FI target and year-end progress and change, without naming the December baseline', () => {
    renderSection()

    expect(screen.getByRole('region', { name: 'Goal progress at year end' })).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /Retire at 55/ })
    expect(row).toHaveTextContent('Retire at 55$2,000,00019.0%↗Up 4.0 points')
    expect(within(row).getByText('↗')).toHaveAttribute('aria-hidden', 'true')
    expect(within(row).getByText('Up')).toHaveClass('sr-only')
    expect(screen.queryByText(/start of the year/)).not.toBeInTheDocument()
  })

  it('shows the FI and GW balances once, however many goals there are', () => {
    const [first] = makeReview().goals
    renderSection(makeReview({ goals: [first, { ...first, goalId: 13, name: 'Buy a home' }] }))

    expect(screen.getAllByText('FI balance')).toHaveLength(1)
    expect(screen.getAllByText('GW balance')).toHaveLength(1)
    expect(screen.getByText('FI balance').closest('div')).toHaveTextContent('FI balance$380,000at the end of 2025')
    expect(screen.getByText('GW balance').closest('div')).toHaveTextContent('GW balance$80,000at the end of 2025')
  })

  it('adds GW target and progress columns when a goal has a GW target', () => {
    const [first] = makeReview().goals
    const goal = { ...first, gwTarget: 100_000, startGwPct: 50, endGwPct: 80 }
    renderSection(makeReview({ goals: [goal] }))

    expect(screen.getByRole('columnheader', { name: 'GW target' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'GW progress' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Retire at 55/ })).toHaveTextContent('$100,00080.0%↗Up 30.0 points')
  })

  it('shows a dash for a goal without a GW target when another goal has one', () => {
    const [first] = makeReview().goals
    const withGw = { ...first, gwTarget: 100_000, startGwPct: 50, endGwPct: 80 }
    renderSection(makeReview({ goals: [withGw, { ...first, goalId: 13, name: 'Buy a home' }] }))

    const row = screen.getByRole('row', { name: /Buy a home/ })
    expect(row).toHaveTextContent('Buy a home$2,000,00019.0%↗Up 4.0 points––')
  })

  it('leaves out the GW columns when no goal has a GW target', () => {
    renderSection()

    expect(screen.queryByRole('columnheader', { name: 'GW target' })).not.toBeInTheDocument()
  })

  it('names a non-December baseline month in the footnote', () => {
    const base = makeReview()
    renderSection(makeReview({ netWorth: { ...base.netWorth, start: { ...base.netWorth.start, month: '2025-03' } } }))

    expect(screen.getByText(/change is measured from Mar 2025/)).toBeInTheDocument()
  })

  it('says the change is not available when the start progress is missing', () => {
    const goal = { ...makeReview().goals[0], startPct: null }
    renderSection(makeReview({ goals: [goal] }))

    expect(screen.getByRole('row', { name: /Retire at 55/ })).toHaveTextContent('19.0%Change not available')
  })

  it('footnotes that progress is measured against today’s targets', () => {
    renderSection()

    expect(screen.getByText('Progress is measured against each goal as it is set today.')).toBeInTheDocument()
  })

  it('reads Not available for a goal whose anchors are missing, including both balances', () => {
    const goal = {
      ...makeReview().goals[0],
      startBalance: null,
      endBalance: null,
      endGwBalance: null,
      startPct: null,
      endPct: null,
    }
    renderSection(makeReview({ goals: [goal] }))

    expect(screen.getByRole('row', { name: /Retire at 55/ })).toHaveTextContent('Retire at 55$2,000,000Not available')
    expect(screen.getByText('FI balance').closest('div')).toHaveTextContent('Not available')
    expect(screen.getByText('GW balance').closest('div')).toHaveTextContent('Not available')
  })

  it('lists several goals in order', () => {
    const [first] = makeReview().goals
    renderSection(
      makeReview({ goals: [first, { ...first, goalId: 13, name: 'Buy a home', endPct: 50, startPct: 60 }] }),
    )

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('Buy a home$2,000,00050.0%↘Down 10.0 points')
  })

  it('says no goals existed when the user has goals but none by the end of the year', () => {
    renderSection(makeReview({ goals: [] }), true)

    expect(screen.getByText('You had no goals set by the end of 2025.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('invites the user to set a goal when they have none, with a link to Planning', () => {
    renderSection(makeReview({ goals: [] }), false)

    expect(screen.getByText(/You have not set a goal yet\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Planning' })).toHaveAttribute('href', '/goal/plans')
    expect(screen.queryByText(/measured against/)).not.toBeInTheDocument()
  })

  it('says progress is not shown, not "no goals", when goals existed but have no target today', () => {
    renderSection(makeReview({ goals: [], skippedGoals: 2 }))

    expect(
      screen.getByText('2 goals existed by the end of 2025 but have no target today, so progress is not shown.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/You had no goals/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not set a goal yet/)).not.toBeInTheDocument()
  })

  it('uses singular wording for one skipped goal', () => {
    renderSection(makeReview({ goals: [], skippedGoals: 1 }), false)

    expect(
      screen.getByText('1 goal existed by the end of 2025 but has no target today, so progress is not shown.'),
    ).toBeInTheDocument()
  })

  it('adds the skipped-goal sentence under the list when some goals are listed', () => {
    renderSection(makeReview({ skippedGoals: 1 }))

    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1)
    expect(
      screen.getByText('1 goal existed by the end of 2025 but has no target today, so progress is not shown.'),
    ).toBeInTheDocument()
  })

  it('adds nothing about skipped goals when none were skipped', () => {
    renderSection()

    expect(screen.queryByText(/no target today/)).not.toBeInTheDocument()
  })
})
