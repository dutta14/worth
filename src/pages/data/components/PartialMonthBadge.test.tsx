import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PartialMonthBadge from './PartialMonthBadge'

describe('PartialMonthBadge', () => {
  it('shows the Partial month label', () => {
    render(<PartialMonthBadge monthLabel="October" missingCount={2} />)
    expect(screen.getByText('Partial month')).toBeVisible()
  })

  it('describes the missing accounts in plural form through aria-describedby', () => {
    render(<PartialMonthBadge monthLabel="October" missingCount={2} />)
    expect(screen.getByText('Partial month')).toHaveAccessibleDescription(
      '2 accounts have no balance for October. Net worth leaves them out.',
    )
  })

  it('uses singular grammar for one missing account', () => {
    render(<PartialMonthBadge monthLabel="October 2025" missingCount={1} />)
    expect(screen.getByText('Partial month')).toHaveAccessibleDescription(
      '1 account has no balance for October 2025. Net worth leaves it out.',
    )
  })

  it('repeats the description as a title for pointer users', () => {
    render(<PartialMonthBadge monthLabel="October" missingCount={3} />)
    expect(screen.getByText('Partial month')).toHaveAttribute(
      'title',
      '3 accounts have no balance for October. Net worth leaves them out.',
    )
  })

  it('keeps the description out of the visible page', () => {
    render(<PartialMonthBadge monthLabel="October" missingCount={2} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(/have no balance for October/)).not.toBeVisible()
  })

  it('gives each badge its own description id', () => {
    render(
      <>
        <PartialMonthBadge monthLabel="October" missingCount={1} />
        <PartialMonthBadge monthLabel="November" missingCount={2} />
      </>,
    )
    const [first, second] = screen.getAllByText('Partial month')
    expect(first.getAttribute('aria-describedby')).not.toBe(second.getAttribute('aria-describedby'))
  })
})
