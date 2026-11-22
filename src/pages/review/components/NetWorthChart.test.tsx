import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSeries } from '../../../test/reviewFixtures'
import NetWorthChart from './NetWorthChart'

const SUMMARY = 'Net worth rose from $400,000 in December 2024 to $460,000 in December 2025.'

describe('NetWorthChart', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is an image named by its text summary', () => {
    render(<NetWorthChart series={makeSeries(2025, { 6: 430000, 12: 460000 })} summary={SUMMARY} />)

    expect(screen.getByRole('img', { name: SUMMARY })).toBeInTheDocument()
  })

  it('draws nothing when no month has a balance', () => {
    render(<NetWorthChart series={makeSeries(2025)} summary={SUMMARY} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
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

  it('uses the default width where nothing can be measured, with a viewBox equal to the svg size', () => {
    render(<NetWorthChart series={makeSeries(2025, { 1: 1, 12: 2 })} summary={SUMMARY} />)

    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('width', '640')
    expect(svg.getAttribute('viewBox')).toBe(`0 0 640 ${svg.getAttribute('height')}`)
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

  describe('sizing to its container', () => {
    const stubWidth = (width: number) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
    const labelsOf = (container: HTMLElement) => [...container.querySelectorAll('text')].map(t => t.textContent)

    it('draws at the measured width so the text keeps its real size', () => {
      stubWidth(360)
      render(<NetWorthChart series={makeSeries(2025, { 1: 400000, 12: 460000 })} summary={SUMMARY} />)

      expect(screen.getByRole('img')).toHaveAttribute('width', '360')
      expect(screen.getByRole('img').getAttribute('viewBox')).toMatch(/^0 0 360 /)
    })

    it('thins the month labels to every third on a narrow container', () => {
      stubWidth(320)
      const { container } = render(
        <NetWorthChart series={makeSeries(2025, { 1: 400000, 12: 460000 })} summary={SUMMARY} />,
      )

      const months = labelsOf(container).filter(l => /^[A-Z][a-z]{2}$/.test(l ?? ''))
      expect(months).toEqual(['Jan', 'Apr', 'Jul', 'Oct'])
    })

    it('shows all twelve month labels on a wide container', () => {
      stubWidth(1000)
      const { container } = render(
        <NetWorthChart series={makeSeries(2025, { 1: 400000, 12: 460000 })} summary={SUMMARY} />,
      )

      expect(labelsOf(container).filter(l => /^[A-Z][a-z]{2}$/.test(l ?? ''))).toHaveLength(12)
    })

    it('redraws when the container is resized', () => {
      stubWidth(1000)
      let notify: () => void = () => {}
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            notify = callback
          }
          observe() {}
          disconnect() {}
        },
      )
      render(<NetWorthChart series={makeSeries(2025, { 1: 400000, 12: 460000 })} summary={SUMMARY} />)
      expect(screen.getByRole('img')).toHaveAttribute('width', '1000')

      stubWidth(500)
      act(() => notify())

      expect(screen.getByRole('img')).toHaveAttribute('width', '500')
    })

    it('stops observing when unmounted', () => {
      stubWidth(500)
      const disconnect = vi.fn()
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect = disconnect
        },
      )
      const { unmount } = render(<NetWorthChart series={makeSeries(2025, { 1: 1, 12: 2 })} summary={SUMMARY} />)

      unmount()

      expect(disconnect).toHaveBeenCalled()
    })
  })
})
