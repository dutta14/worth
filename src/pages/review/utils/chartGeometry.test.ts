import { describe, expect, it } from 'vitest'
import { makeSeries } from '../../../test/reviewFixtures'
import { buildChartModel, chartLayout, DEFAULT_CHART_WIDTH, MIN_CHART_WIDTH, niceTicks } from './chartGeometry'

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
    expect(first.x).toBe(model.layout.left)
    expect(last.x).toBe(model.layout.width - model.layout.right)
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
      expect(tick.y).toBeGreaterThanOrEqual(model.layout.top - 0.001)
      expect(tick.y).toBeLessThanOrEqual(model.layout.height - model.layout.bottom + 0.001)
    }
  })

  it('labels every gridline with a value that reads back as exactly that gridline (1.0M to 2.0M)', () => {
    const model = buildChartModel(makeSeries(2025, { 1: 1_000_000, 12: 2_000_000 }))!

    expect(model.ticks.map(t => [t.value, t.label])).toEqual([
      [1_000_000, '$1M'],
      [1_250_000, '$1.25M'],
      [1_500_000, '$1.5M'],
      [1_750_000, '$1.75M'],
      [2_000_000, '$2M'],
    ])
  })

  it.each([
    [1_000_000, 1_020_000],
    [1_200_000, 2_200_000],
    [380_000, 460_000],
    [-20_000, 15_000],
    [-3_400_000, -2_900_000],
    [0, 7],
    [5_000, 5_000],
  ])('has tick labels that parse back to their gridline value for %s to %s', (low, high) => {
    const model = buildChartModel(makeSeries(2025, { 1: low, 12: high }))!

    for (const tick of model.ticks) {
      const [, sign, number, suffix] = /^(-?)\$([\d.,]+)([KM]?)$/.exec(tick.label)!
      const unit = suffix === 'M' ? 1e6 : suffix === 'K' ? 1e3 : 1
      expect(Number(`${sign}${number.replace(/,/g, '')}`) * unit).toBeCloseTo(tick.value, 6)
    }
  })

  it('keeps the viewBox size equal to the measured width so text is not scaled', () => {
    expect(buildChartModel(makeSeries(2025, { 1: 1, 12: 2 }), 1000)!.layout.width).toBe(1000)
    expect(buildChartModel(makeSeries(2025, { 1: 1, 12: 2 }))!.layout.width).toBe(DEFAULT_CHART_WIDTH)
  })

  it('never goes below the minimum width', () => {
    expect(chartLayout(100, ['$1K']).width).toBe(MIN_CHART_WIDTH)
  })

  it('makes room on the left for the widest tick label', () => {
    expect(chartLayout(640, ['$1.75M']).left).toBeGreaterThan(chartLayout(640, ['$1K']).left)
  })

  it('keeps the chart height between 160 and 240', () => {
    expect(chartLayout(240, ['$1K']).height).toBe(160)
    expect(chartLayout(1200, ['$1K']).height).toBe(240)
  })

  it('labels all twelve months when there is room and every third month when there is not', () => {
    const series = makeSeries(2025, { 1: 1, 12: 2 })

    expect(buildChartModel(series, 640)!.monthLabels.map(m => m.label)).toHaveLength(12)
    expect(buildChartModel(series, 320)!.monthLabels.map(m => m.label)).toEqual(['Jan', 'Apr', 'Jul', 'Oct'])
  })

  it('keeps month labels at least 40px apart at every width from 320 to 1280', () => {
    for (const width of [320, 360, 480, 768, 1024, 1280]) {
      const xs = buildChartModel(makeSeries(2025, { 1: 1, 12: 2 }), width)!.monthLabels.map(m => m.x)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(40)
    }
  })
})
