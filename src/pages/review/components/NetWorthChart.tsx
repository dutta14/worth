import { FC, RefObject, useLayoutEffect, useRef, useState } from 'react'
import type { MonthPoint } from '../types'
import { buildChartModel, DEFAULT_CHART_WIDTH } from '../utils/chartGeometry'

interface NetWorthChartProps {
  series: MonthPoint[]
  /** Text alternative for the whole chart. */
  summary: string
}

/** Width of the element, kept in sync with its size; the default where nothing can be measured (tests, old browsers). */
function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(DEFAULT_CHART_WIDTH)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

const NetWorthChart: FC<NetWorthChartProps> = ({ series, summary }) => {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const model = buildChartModel(series, width)

  return (
    <div ref={ref} className="ar-chart-wrap">
      {model && (
        <svg
          className="ar-chart"
          width={model.layout.width}
          height={model.layout.height}
          viewBox={`0 0 ${model.layout.width} ${model.layout.height}`}
          role="img"
          aria-label={summary}
          focusable="false"
        >
          {model.ticks.map(tick => (
            <g key={tick.value}>
              <line
                className="ar-chart__grid"
                x1={model.layout.left}
                x2={model.layout.width - model.layout.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text
                className="ar-chart__axis"
                x={model.layout.left - 8}
                y={tick.y}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick.label}
              </text>
            </g>
          ))}
          {model.zeroY !== null && (
            <line
              className="ar-chart__zero"
              x1={model.layout.left}
              x2={model.layout.width - model.layout.right}
              y1={model.zeroY}
              y2={model.zeroY}
            />
          )}
          {model.monthLabels.map(m => (
            <text
              key={m.label}
              className="ar-chart__axis"
              x={m.x}
              y={model.layout.height - model.layout.bottom + 18}
              textAnchor="middle"
            >
              {m.label}
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
      )}
    </div>
  )
}

export default NetWorthChart
