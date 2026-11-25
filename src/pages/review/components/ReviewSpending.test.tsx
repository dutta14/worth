import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeReview } from '../../../test/reviewFixtures'
import type { SpendingReview } from '../types'
import ReviewSpending from './ReviewSpending'

type TooltipPayload = ReadonlyArray<{ payload: { name: string; amount: number; share: number } }>
let hovered: TooltipPayload | undefined

// jsdom cannot drive Recharts' hover, so the tooltip renderer is invoked directly with a chosen slice.
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    Tooltip: ({ content }: { content: (props: { active: boolean; payload?: TooltipPayload }) => ReactNode }) => (
      <div data-testid="tooltip">{content({ active: hovered !== undefined, payload: hovered })}</div>
    ),
  }
})

const spending = (overrides: Partial<SpendingReview> = {}): SpendingReview => ({
  ...(makeReview().spending as SpendingReview),
  ...overrides,
})
const renderSection = (s: SpendingReview) => render(<ReviewSpending year={2025} spending={s} />)

describe('ReviewSpending', () => {
  beforeEach(() => {
    hovered = undefined
  })

  it('lists the top groups with amount and share in a real table', () => {
    renderSection(spending())

    expect(screen.getByRole('region', { name: 'Top spending groups' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Spending by group, 2025' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(h => h.textContent),
    ).toEqual(['Group', 'Spent', 'Share'])
    expect(within(table).getByRole('row', { name: /^Housing/ })).toHaveTextContent('$30,00038.5%')
    expect(within(table).getByRole('row', { name: /^Food/ })).toHaveTextContent('$15,00019.2%')
    expect(within(table).getByRole('row', { name: /^Health/ })).toHaveTextContent('$6,0007.7%')
  })

  it('adds an "All other groups" row with the count when more than five groups have spend', () => {
    renderSection(spending())

    expect(screen.getByRole('row', { name: /^All other groups \(2\)/ })).toHaveTextContent('$10,00012.8%')
  })

  it('has no "other" row when five groups or fewer have spend', () => {
    renderSection(spending({ other: null }))

    expect(screen.queryByRole('row', { name: /All other groups/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(6)
  })

  it('draws a donut named by the spending summary, with one slice per row', () => {
    const { container } = renderSection(spending())

    const donut = screen.getByRole('img', { name: /^Spending by group, 2025\./ })
    expect(donut).toHaveAccessibleName(/Housing: \$30,000, 38\.5%.*All other groups \(2\): \$10,000, 12\.8%/)
    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(6)
  })

  it('shows the hovered group, spent and share in a tooltip', () => {
    hovered = [{ payload: { name: 'Housing', amount: 30000, share: 38.46 } }]
    renderSection(spending())

    expect(screen.getByTestId('tooltip')).toHaveTextContent('Housing$30,00038.5%')
  })

  it('shows no tooltip when no slice is hovered', () => {
    renderSection(spending())

    expect(screen.getByTestId('tooltip')).toBeEmptyDOMElement()
  })

  it('hides the color swatches in the table from assistive technology', () => {
    const { container } = renderSection(spending())

    const swatches = [...container.querySelectorAll('.ar-spending__swatch')]
    expect(swatches).toHaveLength(6)
    expect(swatches.every(el => el.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('draws a single slice for a single group', () => {
    const { container } = renderSection(
      spending({ top: [{ id: 'x', name: 'Odd', amount: 1, share: 100 }], other: null }),
    )

    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(1)
  })

  it('wraps a very long group name in its row header without truncating it', () => {
    const name = 'A very long group name '.repeat(8).trim()
    renderSection(spending({ top: [{ id: 'long', name, amount: 100, share: 100 }], other: null }))

    expect(screen.getByRole('rowheader', { name })).toHaveTextContent(name)
  })

  it('says so when no group has net spending', () => {
    renderSection(spending({ top: [], other: null, refundOnlyTotal: 300 }))

    expect(screen.getByText('No net spending recorded for 2025')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
