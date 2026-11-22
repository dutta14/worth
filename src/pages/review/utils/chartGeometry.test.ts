import { describe, expect, it } from 'vitest'
import { makeSeries } from '../../../test/reviewFixtures'
import { buildChartModel, CHART, niceTicks, xOfMonthIndex } from './chartGeometry'

describe('niceTicks', () => {
  it('returns round values covering the range', () => {
    expect(niceTicks(400000, 460000)).toEqual([400000, 420000, 440000, 460000])
  })

  it('covers a range that crosses zero', () => {
    const ticks = niceTicks(-20000, 15000)
    expect(ticks[0]).toBeLessThanOrEqual(-20000)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(15000)
    expect(ticks).toContain(0)
  })

  it('widens a flat range so a single value still has a scale', () => {
    const ticks = niceTicks(5000, 5000)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks[0]).toBeLessThan(5000)
    expect(ticks[ticks.length - 1]).toBeGreaterThan(5000)
  })

  it('widens a flat zero range', () => {
    const ticks = niceTicks(0, 0)
    expect(ticks[0]).toBeLessThan(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThan(0)
  })
})

describe('buildChartModel', () => {
  it('returns null when no month has a total', () => {
    expect(buildChartModel(makeSeries(2025))).toBeNull()
  })

  it('maps larger totals higher on the chart and later months further right', () => {
    const model = buildChartModel(makeSeries(2025, { 1: 100, 12: 200 }))!
    const [first, last] = model.points
    expect(last.y).toBeLessThan(first.y)
    expect(last.x).toBeGreaterThan(first.x)
    expect(first.x).toBe(xOfMonthIndex(0))
    expect(last.x).toBe(xOfMonthIndex(11))
    expect(last.x).toBeLessThanOrEqual(CHART.width - CHART.right)
  })

  it('breaks the line at months without data instead of interpolating', () => {
    const model = buildChartModel(makeSeries(2025, { 1: 100, 2: 110, 5: 120, 6: 130, 12: 150 }))!
    expect(model.segments.map(s => s.map(p => p.month))).toEqual([
      ['2025-01', '2025-02'],
      ['2025-05', '2025-06'],
      ['2025-12'],
    ])
  })

  it('keeps incomplete months as points flagged incomplete', () => {
    const model = buildChartModel(makeSeries(2025, { 11: 100, 12: 120 }, [12]))!
    expect(model.points.map(p => p.complete)).toEqual([true, false])
  })

  it('draws a zero line only when the range spans zero', () => {
    expect(buildChartModel(makeSeries(2025, { 1: -100, 12: 100 }))!.zeroY).not.toBeNull()
    expect(buildChartModel(makeSeries(2025, { 1: 100, 12: 200 }))!.zeroY).toBeNull()
    expect(buildChartModel(makeSeries(2025, { 1: -300, 12: -100 }))!.zeroY).toBeNull()
  })

  it('places ticks inside the plot area', () => {
    const model = buildChartModel(makeSeries(2025, { 1: -20000, 12: -5000 }))!
    for (const tick of model.ticks) {
      expect(tick.y).toBeGreaterThanOrEqual(CHART.top - 0.001)
      expect(tick.y).toBeLessThanOrEqual(CHART.height - CHART.bottom + 0.001)
    }
  })
})
