import { FC } from 'react'
import type { MonthPoint } from '../types'
import { buildChartModel, CHART, xOfMonthIndex } from '../utils/chartGeometry'
import { formatMoneyCompact } from '../utils/format'

interface NetWorthChartProps {
  series: MonthPoint[]
  /** Text alternative for the whole chart. */
  summary: string
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const NetWorthChart: FC<NetWorthChartProps> = ({ series, summary }) => {
  const model = buildChartModel(series)
  if (!model) return null
  const plotRight = CHART.width - CHART.right
  const baseline = CHART.height - CHART.bottom

  return (
    <svg
      className="ar-chart"
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label={summary}
      focusable="false"
    >
      {model.ticks.map(tick => (
        <g key={tick.value}>
          <line className="ar-chart__grid" x1={CHART.left} x2={plotRight} y1={tick.y} y2={tick.y} />
          <text className="ar-chart__axis" x={CHART.left - 8} y={tick.y} textAnchor="end" dominantBaseline="middle">
            {formatMoneyCompact(tick.value)}
          </text>
        </g>
      ))}
      {model.zeroY !== null && (
        <line className="ar-chart__zero" x1={CHART.left} x2={plotRight} y1={model.zeroY} y2={model.zeroY} />
      )}
      {MONTH_LABELS.map((label, i) => (
        <text
          key={label}
          className={`ar-chart__axis${i % 3 === 0 ? '' : ' ar-chart__axis--minor'}`}
          x={xOfMonthIndex(i)}
          y={baseline + 18}
          textAnchor="middle"
        >
          {label}
        </text>
      ))}
      {model.segments.map(run => (
        <polyline key={run[0].month} className="ar-chart__line" points={run.map(p => `${p.x},${p.y}`).join(' ')} />
      ))}
      {model.points.map(p => (
        <circle
          key={p.month}
          className={`ar-chart__point${p.complete ? '' : ' ar-chart__point--hollow'}`}
          cx={p.x}
          cy={p.y}
          r={3}
        />
      ))}
    </svg>
  )
}

export default NetWorthChart
