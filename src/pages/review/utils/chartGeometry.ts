import type { MonthPoint } from '../types'

export const CHART = { width: 640, height: 220, left: 64, right: 16, top: 12, bottom: 28 }

export interface ChartPoint {
  month: string
  total: number
  complete: boolean
  x: number
  y: number
}
export interface ChartTick {
  value: number
  y: number
}
export interface ChartModel {
  ticks: ChartTick[]
  /** Runs of consecutive months with data; a month without data ends a run so the line never bridges a gap. */
  segments: ChartPoint[][]
  points: ChartPoint[]
  /** Null when zero is outside the plotted range. */
  zeroY: number | null
}

/** Round tick values covering [min, max], about `target` intervals apart. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const lo = min === max ? min - Math.max(Math.abs(min) * 0.1, 1) : min
  const hi = min === max ? max + Math.max(Math.abs(max) * 0.1, 1) : max
  const rough = (hi - lo) / target
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = ([1, 2, 2.5, 5, 10].find(m => m * magnitude >= rough) ?? 10) * magnitude
  const first = Math.floor(lo / step + 1e-9)
  const last = Math.ceil(hi / step - 1e-9)
  return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)))
}

/** Pure geometry for the 12-month line; null when no month has a total. */
export function buildChartModel(series: MonthPoint[]): ChartModel | null {
  const totals = series.flatMap(p => (p.total === null ? [] : [p.total]))
  if (totals.length === 0) return null

  const values = niceTicks(Math.min(...totals), Math.max(...totals))
  const domainMin = values[0]
  const domainMax = values[values.length - 1]
  const plotW = CHART.width - CHART.left - CHART.right
  const plotH = CHART.height - CHART.top - CHART.bottom
  const xAt = (i: number) => CHART.left + (series.length > 1 ? (i / (series.length - 1)) * plotW : plotW / 2)
  const yAt = (v: number) => CHART.top + (1 - (v - domainMin) / (domainMax - domainMin)) * plotH

  const segments: ChartPoint[][] = []
  const points: ChartPoint[] = []
  let run: ChartPoint[] = []
  series.forEach((p, i) => {
    if (p.total === null) {
      if (run.length > 0) segments.push(run)
      run = []
      return
    }
    const point = { month: p.month, total: p.total, complete: p.complete, x: xAt(i), y: yAt(p.total) }
    points.push(point)
    run.push(point)
  })
  if (run.length > 0) segments.push(run)

  return {
    ticks: values.map(value => ({ value, y: yAt(value) })),
    segments,
    points,
    zeroY: domainMin < 0 && domainMax > 0 ? yAt(0) : null,
  }
}

export const xOfMonthIndex = (i: number, count = 12): number =>
  CHART.left + (i / (count - 1)) * (CHART.width - CHART.left - CHART.right)
