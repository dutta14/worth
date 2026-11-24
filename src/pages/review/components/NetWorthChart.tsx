import { FC, useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthPoint } from '../types'
import {
  formatAxisLabels,
  formatMoney,
  formatMonthName,
  formatMonthShort,
  formatPercent,
  NO_CHANGE,
} from '../utils/format'

interface NetWorthChartProps {
  series: MonthPoint[]
  /** Text alternative for the whole chart. */
  summary: string
}

interface ChartDatum {
  label: string
  month: string
  total: number | null
}

interface TooltipProps {
  active?: boolean
  label?: string | number
}

const LINE_COLOR = 'var(--chart-nw-line, #0f766e)'
const AXIS_TICK = { fontSize: 10, fill: 'var(--color-text-muted)' }

/** "+$1,234 (+1.2%)", or null when the rounded change is zero. */
function formatChange(total: number, previous: number): { text: string; direction: 'up' | 'down' } | null {
  const diff = total - previous
  const money = formatMoney(Math.abs(diff))
  if (money === formatMoney(0)) return null
  const sign = diff > 0 ? '+' : '-'
  const pct = previous === 0 ? '' : ` (${sign}${formatPercent((Math.abs(diff) / Math.abs(previous)) * 100)})`
  return { text: `${sign}${money}${pct}`, direction: diff > 0 ? 'up' : 'down' }
}

const NetWorthChart: FC<NetWorthChartProps> = ({ series, summary }) => {
  const data = useMemo<ChartDatum[]>(
    () => series.map(p => ({ label: formatMonthName(p.month).slice(0, 3), month: p.month, total: p.total })),
    [series],
  )

  const renderTooltip = ({ active, label }: TooltipProps) => {
    const index = data.findIndex(d => d.label === label)
    const point = data[index]
    if (!active || !point || point.total === null) return null
    const previous = index > 0 ? data[index - 1].total : null
    const change = previous === null ? null : formatChange(point.total, previous)
    return (
      <div className="ar-tooltip">
        <div className="ar-tooltip__label">{formatMonthShort(point.month)}</div>
        <div className="ar-tooltip__row">
          <span className="ar-tooltip__value">{formatMoney(point.total)}</span>
          {previous !== null && (
            <span className={`ar-tooltip__change${change ? ` ar-tooltip__change--${change.direction}` : ''}`}>
              {change ? change.text : NO_CHANGE}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ar-chart-wrap" role="group" aria-label={summary}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 10, right: 24, bottom: 0, left: 10 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => formatAxisLabels([value])[0]}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width="auto"
          />
          <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeDasharray="4 3" />
          <Tooltip content={renderTooltip} />
          <Line
            type="monotone"
            dataKey="total"
            stroke={LINE_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: LINE_COLOR }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default NetWorthChart
