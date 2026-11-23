import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import BudgetHeader from './BudgetHeader'
import { BudgetViewMode, TimePeriod } from '../types'

function defaultProps(overrides: Partial<React.ComponentProps<typeof BudgetHeader>> = {}) {
  return {
    selectedYear: 2025,
    viewMode: 'spreadsheet' as BudgetViewMode,
    timePeriod: 'month' as TimePeriod,
    onPrevYear: vi.fn(),
    onNextYear: vi.fn(),
    onSetTimePeriod: vi.fn(),
    ...overrides,
  }
}

function renderHeader(overrides: Partial<React.ComponentProps<typeof BudgetHeader>> = {}) {
  const props = defaultProps(overrides)
  const result = render(<BudgetHeader {...props} />)
  return { props, ...result }
}

describe('BudgetHeader', () => {
  it('renders the Cashflow title', () => {
    renderHeader()
    expect(screen.getByRole('heading', { name: 'Cashflow' })).toBeInTheDocument()
  })

  it('displays the selected year', () => {
    renderHeader({ selectedYear: 2024 })
    expect(screen.getByText('2024')).toBeInTheDocument()
  })

  it('calls onPrevYear when clicking the previous year button', async () => {
    const user = userEvent.setup()
    const { props } = renderHeader()

    await user.click(screen.getByTitle('Previous year'))
    expect(props.onPrevYear).toHaveBeenCalledOnce()
  })

  it('calls onNextYear when clicking the next year button', async () => {
    const user = userEvent.setup()
    const { props } = renderHeader()

    await user.click(screen.getByTitle('Next year'))
    expect(props.onNextYear).toHaveBeenCalledOnce()
  })

  it('does not render first-level section tabs, which live in the sidebar', () => {
    renderHeader()
    for (const name of ['Overview', 'Spreadsheet', 'Groups', 'Transactions']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('does not render spreadsheet sub-view buttons in the header', () => {
    renderHeader()
    expect(screen.queryByRole('button', { name: 'Aggregated' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Detailed' })).not.toBeInTheDocument()
  })

  it('renders the time period selector buttons', () => {
    renderHeader()
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('Q')).toBeInTheDocument()
    expect(screen.getByText('H')).toBeInTheDocument()
  })

  it('calls onSetTimePeriod with the correct period when clicking a period button', async () => {
    const user = userEvent.setup()
    const { props } = renderHeader()

    await user.click(screen.getByText('Q'))
    expect(props.onSetTimePeriod).toHaveBeenCalledWith('quarter')

    await user.click(screen.getByText('H'))
    expect(props.onSetTimePeriod).toHaveBeenCalledWith('half')

    await user.click(screen.getByText('M'))
    expect(props.onSetTimePeriod).toHaveBeenCalledWith('month')
  })

  it('hides period buttons in groups mode', () => {
    renderHeader({ viewMode: 'groups' })

    expect(screen.queryByText('M')).not.toBeInTheDocument()
    expect(screen.queryByText('Q')).not.toBeInTheDocument()
    expect(screen.queryByText('H')).not.toBeInTheDocument()
  })

  it('marks the active half-year period button in cashflow mode', () => {
    renderHeader({ viewMode: 'cashflow', timePeriod: 'half' })

    expect(screen.getByText('H')).toHaveClass('active')
    expect(screen.getByText('M')).not.toHaveClass('active')
    expect(screen.getByText('Q')).not.toHaveClass('active')
  })
})
