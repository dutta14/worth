import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeSeries } from '../../../test/reviewFixtures'
import NetWorthTable from './NetWorthTable'

const series = makeSeries(2025, { 1: 100000, 2: -5000, 3: 120000 }, [3])

describe('NetWorthTable', () => {
  it('captions the table with the year and has Month, Net worth and Status headers', () => {
    render(<NetWorthTable id="t" year={2025} series={series} expanded />)

    const table = screen.getByRole('table', { name: 'Net worth at the end of each month, 2025' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(h => h.textContent),
    ).toEqual(['Month', 'Net worth', 'Status'])
  })

  it('has one row per month plus the header row', () => {
    render(<NetWorthTable id="t" year={2025} series={series} expanded />)

    expect(screen.getAllByRole('row')).toHaveLength(13)
  })

  it('shows complete, incomplete and no-data months with their values', () => {
    render(<NetWorthTable id="t" year={2025} series={series} expanded />)

    const row = (month: string) => screen.getByRole('row', { name: new RegExp(`^${month}`) })
    expect(row('Jan 2025')).toHaveTextContent('$100,000Complete')
    expect(row('Feb 2025')).toHaveTextContent('-$5,000Complete')
    expect(row('Mar 2025')).toHaveTextContent('$120,000Incomplete')
    expect(row('Apr 2025')).toHaveTextContent('Not availableNo data')
  })

  it('is visually hidden but still in the accessibility tree while collapsed', () => {
    render(<NetWorthTable id="t" year={2025} series={series} expanded={false} />)

    expect(screen.getByRole('table')).toHaveClass('sr-only')
  })

  it('is visible when expanded', () => {
    render(<NetWorthTable id="t" year={2025} series={series} expanded />)

    expect(screen.getByRole('table')).not.toHaveClass('sr-only')
  })
})
