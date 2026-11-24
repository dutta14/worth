import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReviewDelta, { ReviewPriorYear } from './ReviewDelta'

const renderDelta = (n: number | null, kind: 'usd' | 'percent' | 'points') =>
  render(<ReviewDelta n={n} kind={kind} />).container.firstElementChild as HTMLElement

describe('ReviewDelta', () => {
  it('shows an up glyph hidden from assistive technology, with Up as screen reader text', () => {
    const delta = renderDelta(1500, 'usd')

    expect(delta).toHaveClass('ar-delta--positive')
    expect(delta).toHaveTextContent('Up $1,500')
    expect(screen.getByText('↗')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Up')).toHaveClass('sr-only')
  })

  it('shows a down glyph with Down as screen reader text', () => {
    const delta = renderDelta(-1500, 'usd')

    expect(delta).toHaveClass('ar-delta--negative')
    expect(delta).toHaveTextContent('Down $1,500')
    expect(screen.getByText('↘')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Down')).toHaveClass('sr-only')
  })

  it('says No change, without a glyph or direction, when the value rounds to zero', () => {
    const delta = renderDelta(0.4, 'usd')

    expect(delta).toHaveTextContent(/^No change$/)
    expect(delta).not.toHaveClass('ar-delta--positive')
    expect(delta).not.toHaveClass('ar-delta--negative')
    expect(screen.queryByText('↗')).not.toBeInTheDocument()
  })

  it('treats a tiny negative percent as No change rather than a fall', () => {
    expect(renderDelta(-0.04, 'percent')).toHaveTextContent(/^No change$/)
  })

  it('says Not available for null', () => {
    const delta = renderDelta(null, 'percent')

    expect(delta).toHaveTextContent(/^Not available$/)
    expect(delta).not.toHaveClass('ar-delta--positive')
    expect(delta).not.toHaveClass('ar-delta--negative')
  })

  it.each([
    [2400, 'usd', 'Up $2,400'],
    [-12.34, 'percent', 'Down 12.3%'],
    [3.5, 'points', 'Up 3.5 points'],
    [-1, 'points', 'Down 1.0 point'],
  ] as const)('formats %s as %s', (n, kind, expected) => {
    expect(renderDelta(n, kind)).toHaveTextContent(expected)
  })
})

describe('ReviewPriorYear', () => {
  it('compares the current value with the prior year', () => {
    const { container } = render(<ReviewPriorYear year={2024} current={5} prior={8} kind="points" />)

    expect(container).toHaveTextContent('vs. 2024: ↘Down 3.0 points')
  })

  it.each([
    [null, 5],
    [5, null],
    [5, undefined],
  ])('renders nothing when current is %s and prior is %s', (current, prior) => {
    const { container } = render(<ReviewPriorYear year={2024} current={current} prior={prior} kind="usd" />)

    expect(container).toBeEmptyDOMElement()
  })
})
