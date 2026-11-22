import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeSeries } from '../../../test/reviewFixtures'
import NetWorthChart from './NetWorthChart'

const SUMMARY = 'Net worth rose from $400,000 in December 2024 to $460,000 in December 2025.'

describe('NetWorthChart', () => {
  it('is an image named by its text summary', () => {
    render(<NetWorthChart series={makeSeries(2025, { 6: 430000, 12: 460000 })} summary={SUMMARY} />)

    expect(screen.getByRole('img', { name: SUMMARY })).toBeInTheDocument()
  })

  it('renders nothing when no month has a balance', () => {
    const { container } = render(<NetWorthChart series={makeSeries(2025)} summary={SUMMARY} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('plots one point per month with data, without interpolating across gaps', () => {
    const { container } = render(
      <NetWorthChart series={makeSeries(2025, { 1: 100, 2: 110, 6: 120, 12: 130 })} summary={SUMMARY} />,
    )

    expect(container.querySelectorAll('circle')).toHaveLength(4)
    expect(container.querySelectorAll('polyline')).toHaveLength(3)
  })

  it('draws incomplete months as hollow points and complete months as filled ones', () => {
    const { container } = render(
      <NetWorthChart series={makeSeries(2025, { 11: 100, 12: 120 }, [12])} summary={SUMMARY} />,
    )

    const points = [...container.querySelectorAll('circle')]
    expect(points.map(p => p.classList.contains('ar-chart__point--hollow'))).toEqual([false, true])
  })

  it('labels all twelve months and dollar values on the axes', () => {
    const { container } = render(
      <NetWorthChart series={makeSeries(2025, { 1: 400000, 12: 460000 })} summary={SUMMARY} />,
    )

    const labels = [...container.querySelectorAll('text')].map(t => t.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Jan', 'Jun', 'Dec', '$400K', '$460K']))
  })

  it('marks every month label that is not a quarter start as thinnable on narrow screens', () => {
    const { container } = render(<NetWorthChart series={makeSeries(2025, { 1: 1, 12: 2 })} summary={SUMMARY} />)

    expect(container.querySelectorAll('.ar-chart__axis--minor')).toHaveLength(8)
  })

  it('draws a zero line for a net worth that crosses zero', () => {
    const { container } = render(<NetWorthChart series={makeSeries(2025, { 1: -20000, 12: 5000 })} summary={SUMMARY} />)

    expect(container.querySelector('.ar-chart__zero')).toBeInTheDocument()
  })

  it('labels negative axis values with a minus sign', () => {
    const { container } = render(
      <NetWorthChart series={makeSeries(2025, { 1: -20000, 12: -5000 })} summary={SUMMARY} />,
    )

    expect([...container.querySelectorAll('text')].some(t => t.textContent === '-$20K')).toBe(true)
  })
})
