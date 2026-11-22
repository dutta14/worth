import type { MonthPoint } from '../types'
import { formatAxisLabels } from './format'

/** Width used before the container has been measured, and where nothing can be measured. */
export const DEFAULT_CHART_WIDTH = 640
export const MIN_CHART_WIDTH = 240

const MARGIN = { right: 16, top: 12, bottom: 28 }
/** Rough width of one axis character at the axis font size (12px). */
const AXIS_CHAR_WIDTH = 7
/** Space one month label needs; months are thinned to every third when the plot is too tight. */
const MONTH_LABEL_WIDTH = 40

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface ChartPoint {
  month: string
  total: number
  complete: boolean
  x: number
  y: number
}
export interface ChartTick {
  value: number
  label: string
  y: number
}
export interface ChartMonthLabel {
  label: string
  x: number
}
export interface ChartLayout {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
}
export interface ChartModel {
  layout: ChartLayout
  ticks: ChartTick[]
  monthLabels: ChartMonthLabel[]
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

/** Pixel layout for a container width; the viewBox equals the rendered size, so text keeps its real size. */
export function chartLayout(width: number, tickLabels: string[]): ChartLayout {
  const w = Math.max(MIN_CHART_WIDTH, Math.round(width))
  const widest = Math.max(...tickLabels.map(l => l.length))
  return {
    width: w,
    height: Math.round(Math.min(240, Math.max(160, w * 0.35))),
    left: Math.max(40, 12 + widest * AXIS_CHAR_WIDTH),
    right: MARGIN.right,
    top: MARGIN.top,
    bottom: MARGIN.bottom,
  }
}

/** Pure geometry for the 12-month line; null when no month has a total. */
export function buildChartModel(series: MonthPoint[], width = DEFAULT_CHART_WIDTH): ChartModel | null {
  const totals = series.flatMap(p => (p.total === null ? [] : [p.total]))
  if (totals.length === 0) return null

  const values = niceTicks(Math.min(...totals), Math.max(...totals))
  const labels = formatAxisLabels(values)
  const layout = chartLayout(width, labels)
  const domainMin = values[0]
  const domainMax = values[values.length - 1]
  const plotW = layout.width - layout.left - layout.right
  const plotH = layout.height - layout.top - layout.bottom
  const xAt = (i: number) => layout.left + (series.length > 1 ? (i / (series.length - 1)) * plotW : plotW / 2)
  const yAt = (v: number) => layout.top + (1 - (v - domainMin) / (domainMax - domainMin)) * plotH

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

  const thin = plotW / (MONTH_LABELS.length - 1) < MONTH_LABEL_WIDTH
  return {
    layout,
    ticks: values.map((value, i) => ({ value, label: labels[i], y: yAt(value) })),
    monthLabels: MONTH_LABELS.flatMap((label, i) => (thin && i % 3 !== 0 ? [] : [{ label, x: xAt(i) }])),
    segments,
    points,
    zeroY: domainMin < 0 && domainMax > 0 ? yAt(0) : null,
  }
}
