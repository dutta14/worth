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
  it('shows each goal with its year-end progress and change, without naming the December baseline', () => {
    renderSection()

    expect(screen.getByRole('region', { name: 'Goal progress at year end' })).toBeInTheDocument()
    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('Retire at 55: 19.0% at the end of 2025; ↗Up 4.0 points')
    expect(item).not.toHaveTextContent('start of the year')
    expect(within(item).getByText('↗')).toHaveAttribute('aria-hidden', 'true')
    expect(within(item).getByText('Up')).toHaveClass('sr-only')
  })

  it('shows both the FI balance against its target and the GW balance', () => {
    renderSection()

    const item = screen.getByRole('listitem')
    expect(within(item).getByText('FI balance').closest('div')).toHaveTextContent(
      'FI balance$380,000of $2,000,000 target',
    )
    expect(within(item).getByText('GW balance').closest('div')).toHaveTextContent('GW balance$80,000')
  })

  it('names a non-December baseline month', () => {
    const base = makeReview()
    renderSection(makeReview({ netWorth: { ...base.netWorth, start: { ...base.netWorth.start, month: '2025-03' } } }))

    expect(screen.getByRole('listitem')).toHaveTextContent('↗Up 4.0 points from Mar 2025')
  })

  it('says the change is not available when the start progress is missing', () => {
    const goal = { ...makeReview().goals[0], startPct: null }
    renderSection(makeReview({ goals: [goal] }))

    expect(screen.getByRole('listitem')).toHaveTextContent(
      'Retire at 55: 19.0% at the end of 2025; Change is not available',
    )
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

    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('Retire at 55: Not available')
    expect(within(item).getByText('FI balance').closest('div')).toHaveTextContent('Not available')
    expect(within(item).getByText('GW balance').closest('div')).toHaveTextContent('Not available')
  })

  it('lists several goals in order', () => {
    const [first] = makeReview().goals
    renderSection(
      makeReview({ goals: [first, { ...first, goalId: 13, name: 'Buy a home', endPct: 50, startPct: 60 }] }),
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[1]).toHaveTextContent('Buy a home: 50.0% at the end of 2025; ↘Down 10.0 points')
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

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(
      screen.getByText('1 goal existed by the end of 2025 but has no target today, so progress is not shown.'),
    ).toBeInTheDocument()
  })

  it('adds nothing about skipped goals when none were skipped', () => {
    renderSection()

    expect(screen.queryByText(/no target today/)).not.toBeInTheDocument()
  })
})
