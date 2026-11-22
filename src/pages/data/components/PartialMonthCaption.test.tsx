import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PartialMonthCaption from './PartialMonthCaption'

describe('PartialMonthCaption', () => {
  it('names the month that is not plotted', () => {
    render(<PartialMonthCaption monthLabel="October" />)
    expect(screen.getByText('October is not plotted until all accounts have a balance.')).toBeVisible()
  })

  it('includes the year when the label has one', () => {
    render(<PartialMonthCaption monthLabel="October 2025" />)
    expect(screen.getByText('October 2025 is not plotted until all accounts have a balance.')).toBeVisible()
  })
})
