import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import ReviewEmpty from './ReviewEmpty'

const renderEmpty = (noDataAnywhere: boolean) =>
  render(
    <MemoryRouter>
      <ReviewEmpty year={2024} noDataAnywhere={noDataAnywhere} />
    </MemoryRouter>,
  )

describe('ReviewEmpty', () => {
  it('names the year when only that year is empty', () => {
    renderEmpty(false)

    expect(screen.getByRole('region', { name: 'Not enough data for 2024' })).toBeInTheDocument()
  })

  it('says there is nothing to review when no year has data', () => {
    renderEmpty(true)

    expect(screen.getByRole('region', { name: 'Nothing to review yet' })).toBeInTheDocument()
  })

  it('links to Wealth and Cashflow', () => {
    renderEmpty(false)

    expect(screen.getByRole('link', { name: 'Go to Wealth' })).toHaveAttribute('href', '/net-worth/dashboard')
    expect(screen.getByRole('link', { name: 'Go to Cashflow' })).toHaveAttribute('href', '/budget')
  })
})
