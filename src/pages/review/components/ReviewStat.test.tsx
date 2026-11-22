import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReviewStat from './ReviewStat'

const renderStat = (props: Partial<Parameters<typeof ReviewStat>[0]> = {}) =>
  render(
    <dl>
      <ReviewStat label="Income" value="$120,000" {...props} />
    </dl>,
  )

describe('ReviewStat', () => {
  it('pairs the label term with its value', () => {
    renderStat()

    expect(screen.getByRole('term')).toHaveTextContent('Income')
    expect(screen.getByRole('definition')).toHaveTextContent('$120,000')
  })

  it('shows the sub line and the prior-year line when given', () => {
    renderStat({ sub: 'Money in', prior: 'vs. 2024: up $5,000' })

    expect(screen.getAllByRole('definition').map(d => d.textContent)).toEqual([
      '$120,000',
      'Money in',
      'vs. 2024: up $5,000',
    ])
  })

  it('omits empty sub and prior lines', () => {
    renderStat({ sub: null, prior: null })

    expect(screen.getAllByRole('definition')).toHaveLength(1)
  })
})
