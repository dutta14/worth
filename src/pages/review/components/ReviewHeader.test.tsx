import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ReviewHeader from './ReviewHeader'

const base = { year: 2025, years: [2026, 2025, 2024], period: 'January to December 2025', disabled: false }

describe('ReviewHeader', () => {
  it('renders the title with the year as one heading name', () => {
    render(<ReviewHeader {...base} onYearChange={() => {}} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Annual Review 2025' })).toBeInTheDocument()
    expect(screen.getByText('January to December 2025')).toBeInTheDocument()
  })

  it('omits the period line when there is none', () => {
    render(<ReviewHeader {...base} period={null} onYearChange={() => {}} />)

    expect(screen.queryByText(/January/)).not.toBeInTheDocument()
  })

  it('adds the route year to the options when it is not in the list, keeping newest first', () => {
    render(<ReviewHeader {...base} year={2030} onYearChange={() => {}} />)

    const options = screen.getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['2030', '2026', '2025', '2024'])
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveValue('2030')
  })

  it('reports the chosen year as a number', async () => {
    const onYearChange = vi.fn()
    render(<ReviewHeader {...base} onYearChange={onYearChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '2024')

    expect(onYearChange).toHaveBeenCalledWith(2024)
  })

  it('disables the select while loading', () => {
    render(<ReviewHeader {...base} disabled onYearChange={() => {}} />)

    expect(screen.getByRole('combobox', { name: 'Year' })).toBeDisabled()
  })

  it('shows a disabled placeholder and a title with no year before a year is chosen', () => {
    render(<ReviewHeader {...base} year={null} onYearChange={() => {}} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Annual Review' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeDisabled()
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Select a year'])
  })
})
