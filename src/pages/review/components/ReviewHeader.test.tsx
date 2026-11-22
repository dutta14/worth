import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ReviewHeader from './ReviewHeader'

const base = {
  year: 2025,
  years: [2026, 2025, 2024],
  period: 'January to December 2025',
  disabled: false,
  actionsDisabled: false,
}
const noop = { onYearChange: () => {}, onPrint: () => {}, onDownload: () => {} }

describe('ReviewHeader', () => {
  it('renders the title with the year as one heading name', () => {
    render(<ReviewHeader {...base} {...noop} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Annual Review 2025' })).toBeInTheDocument()
    expect(screen.getByText('January to December 2025')).toBeInTheDocument()
  })

  it('omits the period line when there is none', () => {
    render(<ReviewHeader {...base} period={null} {...noop} />)

    expect(screen.queryByText(/January/)).not.toBeInTheDocument()
  })

  it('adds the route year to the options when it is not in the list, keeping newest first', () => {
    render(<ReviewHeader {...base} year={2030} {...noop} />)

    const options = screen.getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['2030', '2026', '2025', '2024'])
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveValue('2030')
  })

  it('reports the chosen year as a number', async () => {
    const onYearChange = vi.fn()
    render(<ReviewHeader {...base} {...noop} onYearChange={onYearChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '2024')

    expect(onYearChange).toHaveBeenCalledWith(2024)
  })

  it('disables the select while loading', () => {
    render(<ReviewHeader {...base} disabled {...noop} />)

    expect(screen.getByRole('combobox', { name: 'Year' })).toBeDisabled()
  })

  it('shows a disabled placeholder and a title with no year before a year is chosen', () => {
    render(<ReviewHeader {...base} year={null} {...noop} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Annual Review' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeDisabled()
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Select a year'])
  })

  it('puts Print before Download CSV, after the year select, in the tab order', async () => {
    render(<ReviewHeader {...base} {...noop} />)

    await userEvent.tab()
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toHaveFocus()
  })

  it('calls the print and download handlers from their buttons', async () => {
    const onPrint = vi.fn()
    const onDownload = vi.fn()
    render(<ReviewHeader {...base} {...noop} onPrint={onPrint} onDownload={onDownload} />)

    await userEvent.click(screen.getByRole('button', { name: 'Print or save as PDF' }))
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))

    expect(onPrint).toHaveBeenCalledTimes(1)
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('disables both buttons but not the select when there is nothing to export', () => {
    render(<ReviewHeader {...base} {...noop} actionsDisabled />)

    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeEnabled()
  })
})
