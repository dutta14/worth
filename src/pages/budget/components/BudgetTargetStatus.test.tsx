import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BudgetTargetStatus from './BudgetTargetStatus'
import type { TargetResult } from '../utils/budgetTargets'

const result = (overrides: Partial<TargetResult>): TargetResult => ({
  status: 'over',
  inProgress: false,
  deltaDollars: 120,
  targetDollars: 500,
  spendDollars: 620,
  monthsCounted: 12,
  monthsInPeriod: 12,
  ...overrides,
})

const iconOf = (container: HTMLElement) => container.querySelector('svg')

describe('BudgetTargetStatus', () => {
  it('renders nothing without a result', () => {
    const { container } = render(<BudgetTargetStatus result={null} variant="full" />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['over', { status: 'over' as const, deltaDollars: 120 }, '$120 over'],
    ['under', { status: 'under' as const, deltaDollars: 120 }, '$120 under'],
    ['left', { status: 'under' as const, deltaDollars: 200, inProgress: true }, '$200 left'],
    ['on target', { status: 'on-target' as const, deltaDollars: 0 }, 'On target'],
  ])('shows the %s verdict text with a decorative icon in the full variant', (_name, overrides, text) => {
    const { container } = render(<BudgetTargetStatus result={result(overrides)} variant="full" />)

    expect(screen.getByText(text)).toBeInTheDocument()
    const icon = iconOf(container)
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses a different icon shape for each status so color is never the only cue', () => {
    const shapes = (['over', 'under', 'on-target'] as const).map(status => {
      const { container, unmount } = render(<BudgetTargetStatus result={result({ status })} variant="full" />)
      const d = container.querySelector('path')?.getAttribute('d')
      unmount()
      return d
    })
    expect(new Set(shapes).size).toBe(3)
  })

  it('shows the month caption when fewer months than the period were counted', () => {
    render(<BudgetTargetStatus result={result({ monthsCounted: 4 })} variant="full" />)
    expect(screen.getByText('4 of 12 months')).toBeInTheDocument()
  })

  it('shows "1 of 12 months" for a single counted month', () => {
    render(<BudgetTargetStatus result={result({ monthsCounted: 1 })} variant="full" />)
    expect(screen.getByText('1 of 12 months')).toBeInTheDocument()
  })

  it('omits the caption when every month in the period counted', () => {
    render(<BudgetTargetStatus result={result({})} variant="full" />)
    expect(screen.queryByText(/of 12 months/)).not.toBeInTheDocument()
  })

  it('shows the over line with an icon in the period variant', () => {
    const { container } = render(
      <BudgetTargetStatus
        result={result({ deltaDollars: 210, monthsCounted: 3, monthsInPeriod: 3 })}
        variant="period"
      />,
    )
    expect(screen.getByText('$210 over')).toBeInTheDocument()
    expect(iconOf(container)).toHaveAttribute('aria-hidden', 'true')
  })

  it.each([
    ['under', { status: 'under' as const }],
    ['left', { status: 'under' as const, inProgress: true }],
    ['on target', { status: 'on-target' as const }],
  ])('renders nothing in the period variant when %s', (_name, overrides) => {
    const { container } = render(<BudgetTargetStatus result={result(overrides)} variant="period" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('never shows the caption in the period variant', () => {
    render(<BudgetTargetStatus result={result({ monthsCounted: 1, monthsInPeriod: 3 })} variant="period" />)
    expect(screen.queryByText(/of 3 months/)).not.toBeInTheDocument()
  })
})
