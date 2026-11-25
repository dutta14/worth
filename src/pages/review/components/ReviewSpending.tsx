import { FC } from 'react'
import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import { GROUP_COLORS } from '../../allocation/constants'
import type { SpendingReview } from '../types'
import { formatMoney, formatPercent } from '../utils/format'

interface ReviewSpendingProps {
  year: number
  spending: SpendingReview
}

const DONUT_SIZE = 220

interface TooltipProps {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: { name: string; amount: number; share: number } }>
}

const renderTooltip = ({ active, payload }: TooltipProps) => {
  const group = payload?.[0]?.payload
  if (!active || !group) return null
  return (
    <div className="ar-tooltip">
      <div className="ar-tooltip__label">{group.name}</div>
      <div className="ar-tooltip__row">
        <span className="ar-tooltip__value">{formatMoney(group.amount)}</span>
        <span className="ar-tooltip__share">{formatPercent(group.share)}</span>
      </div>
    </div>
  )
}

const ReviewSpending: FC<ReviewSpendingProps> = ({ year, spending }) => {
  const { top, other } = spending
  const groups = [
    ...top.map(group => ({ ...group, id: `group-${group.id}` })),
    ...(other
      ? [{ id: 'other', name: `All other groups (${other.count})`, amount: other.amount, share: other.share }]
      : []),
  ]
  const slices = groups.map((group, index) => ({ ...group, color: GROUP_COLORS[index % GROUP_COLORS.length] }))
  const summary = `Spending by group, ${year}. ${groups
    .map(group => `${group.name}: ${formatMoney(group.amount)}, ${formatPercent(group.share)}`)
    .join('; ')}.`

  return (
    <section className="ar-section" aria-labelledby="ar-sp-h">
      <h2 id="ar-sp-h" className="ar-section__title">
        Top spending groups
      </h2>
      {top.length === 0 ? (
        <p className="ar-empty-line">No net spending recorded for {year}</p>
      ) : (
        <div className="ar-spending">
          <div className="ar-donut" role="img" aria-label={summary}>
            <PieChart width={DONUT_SIZE} height={DONUT_SIZE}>
              <Tooltip content={renderTooltip} />
              <Pie
                data={slices}
                dataKey="amount"
                nameKey="name"
                innerRadius={DONUT_SIZE * 0.3}
                outerRadius={DONUT_SIZE * 0.45}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map(slice => (
                  <Cell key={slice.id} fill={slice.color} />
                ))}
              </Pie>
            </PieChart>
          </div>
          <table className="ar-table">
            <caption className="sr-only">Spending by group, {year}</caption>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col" className="ar-num">
                  Spent
                </th>
                <th scope="col" className="ar-num">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {slices.map(group => (
                <tr key={group.id}>
                  <th scope="row">
                    <span className="ar-spending__swatch" style={{ backgroundColor: group.color }} aria-hidden="true" />
                    {group.name}
                  </th>
                  <td className="ar-num">{formatMoney(group.amount)}</td>
                  <td className="ar-num">{formatPercent(group.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default ReviewSpending
