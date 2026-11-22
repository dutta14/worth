import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { makeReview } from '../../../test/reviewFixtures'
import type { ReviewNote } from '../types'
import ReviewNotes from './ReviewNotes'

const renderNotes = (notes: ReviewNote[]) =>
  render(
    <MemoryRouter>
      <ReviewNotes review={makeReview({ notes })} />
    </MemoryRouter>,
  )

describe('ReviewNotes', () => {
  it('renders nothing when there are no notes', () => {
    const { container } = renderNotes([])

    expect(container).toBeEmptyDOMElement()
  })

  it('lists every note under a labelled "Things to know" section, in order', () => {
    renderNotes([{ code: 'single-month' }, { code: 'income-zero' }])

    const section = screen.getByRole('region', { name: 'Things to know' })
    const items = within(section).getAllByRole('listitem')
    expect(items.map(i => i.textContent)).toEqual([
      'Only one month of balances is recorded, so there is no change to show.',
      'Savings rate is not available because no income is recorded for 2025.',
    ])
  })

  it('tells screen readers how many notes follow', () => {
    renderNotes([{ code: 'single-month' }, { code: 'income-zero' }])

    expect(screen.getByText('2 notes about this data follow.')).toHaveClass('sr-only')
  })

  it('uses the singular lead-in for a single note', () => {
    renderNotes([{ code: 'single-month' }])

    expect(screen.getByText('1 note about this data follows.')).toBeInTheDocument()
  })

  it('renders a link for notes that point somewhere', () => {
    renderNotes([{ code: 'source-manual' }])

    expect(screen.getByRole('link', { name: 'Open Growth' })).toHaveAttribute('href', '/net-worth/growth/savings')
  })

  it('renders no link for notes that do not need one', () => {
    renderNotes([{ code: 'negative-start' }])

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('hides the decorative icon from assistive technology', () => {
    renderNotes([{ code: 'single-month' }])

    expect(document.querySelector('.ar-note__icon')).toHaveAttribute('aria-hidden', 'true')
  })
})
