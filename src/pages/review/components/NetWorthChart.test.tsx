import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSeries } from '../../../test/reviewFixtures'
import NetWorthChart from './NetWorthChart'

let hoveredLabel: string | undefined

// jsdom cannot drive Recharts' hover, so the tooltip renderer is invoked directly with a chosen label.
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 600, height: 240 })
        : null,
    Tooltip: ({ content }: { content: (props: { active: boolean; label?: string }) => ReactNode }) => (
      <div data-testid="tooltip">{content({ active: hoveredLabel !== undefined, label: hoveredLabel })}</div>
    ),
  }
})

const SUMMARY = 'Net worth rose from $400,000 in December 2024 to $460,000 in December 2025.'
const SERIES = makeSeries(2025, { 1: 100000, 2: 110000, 3: 99000, 4: 99000, 7: 120000 })

const tooltipAfterHovering = (label: string) => {
  hoveredLabel = label
  render(<NetWorthChart series={SERIES} summary={SUMMARY} />)
  return screen.getByTestId('tooltip')
}

describe('NetWorthChart', () => {
  beforeEach(() => {
    hoveredLabel = undefined
  })

  it('is a group named by its text summary', () => {
    render(<NetWorthChart series={makeSeries(2025, { 6: 430000, 12: 460000 })} summary={SUMMARY} />)

    expect(screen.getByRole('group', { name: SUMMARY })).toBeInTheDocument()
  })

  it('draws one line without dots for sparse data, bridging the gaps', () => {
    const { container } = render(
      <NetWorthChart series={makeSeries(2025, { 1: 100, 2: 110, 6: 120, 12: 130 })} summary={SUMMARY} />,
    )

    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(1)
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(0)
  })

  it('shows nothing when no month is hovered', () => {
    expect(tooltipAfterHovering('')).toBeEmptyDOMElement()
  })

  it('shows the month, net worth and a green rise against the previous month', () => {
    const tooltip = tooltipAfterHovering('Feb')

    expect(tooltip).toHaveTextContent('Feb 2025')
    expect(tooltip).toHaveTextContent('$110,000')
    expect(tooltip.querySelector('.ar-tooltip__change--up')).toHaveTextContent('+$10,000 (+10.0%)')
  })

  it('shows a red fall against the previous month', () => {
    const tooltip = tooltipAfterHovering('Mar')

    expect(tooltip.querySelector('.ar-tooltip__change--down')).toHaveTextContent('-$11,000 (-10.0%)')
  })

  it('says No change, with no up or down styling, when the change rounds to zero', () => {
    const tooltip = tooltipAfterHovering('Apr')
    const change = tooltip.querySelector('.ar-tooltip__change')

    expect(change).toHaveTextContent('No change')
    expect(change).not.toHaveClass('ar-tooltip__change--up')
    expect(change).not.toHaveClass('ar-tooltip__change--down')
  })

  it('shows no change for the first month', () => {
    const tooltip = tooltipAfterHovering('Jan')

    expect(tooltip).toHaveTextContent('$100,000')
    expect(tooltip.querySelector('.ar-tooltip__change')).toBeNull()
  })

  it('shows no change when the previous month has no balance', () => {
    const tooltip = tooltipAfterHovering('Jul')

    expect(tooltip).toHaveTextContent('$120,000')
    expect(tooltip.querySelector('.ar-tooltip__change')).toBeNull()
  })

  it('shows no tooltip for a month without a balance', () => {
    expect(tooltipAfterHovering('Jun')).toBeEmptyDOMElement()
  })
})
