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
  it('shows each goal with its year-end progress and change from the start of the year', () => {
    renderSection()

    expect(screen.getByRole('region', { name: 'Goal progress at year end' })).toBeInTheDocument()
    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('Retire at 55: 19.0% at the end of 2025; up 4.0 points from the start of the year')
    expect(within(item).getByText('FI balance $380,000 of $2,000,000 target')).toBeInTheDocument()
  })

  it('footnotes that progress is measured against today’s targets', () => {
    renderSection()

    expect(screen.getByText('Progress is measured against each goal as it is set today.')).toBeInTheDocument()
  })

  it('reads Not available for a goal whose anchors are missing, with no balance line', () => {
    const goal = { ...makeReview().goals[0], startBalance: null, endBalance: null, startPct: null, endPct: null }
    renderSection(makeReview({ goals: [goal] }))

    expect(screen.getByRole('listitem')).toHaveTextContent('Retire at 55: Not available')
    expect(screen.queryByText(/FI balance/)).not.toBeInTheDocument()
  })

  it('lists several goals in order', () => {
    const [first] = makeReview().goals
    renderSection(
      makeReview({ goals: [first, { ...first, goalId: 13, name: 'Buy a home', endPct: 50, startPct: 60 }] }),
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[1]).toHaveTextContent(
      'Buy a home: 50.0% at the end of 2025; down 10.0 points from the start of the year',
    )
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
})
