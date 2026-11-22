import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeReview } from '../../../test/reviewFixtures'
import type { SpendingReview } from '../types'
import ReviewSpending from './ReviewSpending'

const spending = (overrides: Partial<SpendingReview> = {}): SpendingReview => ({
  ...(makeReview().spending as SpendingReview),
  ...overrides,
})
const renderSection = (s: SpendingReview) => render(<ReviewSpending year={2025} spending={s} />)

describe('ReviewSpending', () => {
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

  it('hides the inline bars from assistive technology and sizes them by share', () => {
    const { container } = renderSection(spending())

    const bars = [...container.querySelectorAll('.ar-bar')]
    expect(bars).toHaveLength(6)
    expect(bars.every(b => b.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect((bars[0].firstElementChild as HTMLElement).style.width).toBe('38.46%')
  })

  it('clamps a bar to the track', () => {
    const { container } = renderSection(
      spending({ top: [{ id: 'x', name: 'Odd', amount: 1, share: 140 }], other: null }),
    )

    expect((container.querySelector('.ar-bar__fill') as HTMLElement).style.width).toBe('100%')
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
  })
})
