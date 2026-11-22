import { FC } from 'react'
import type { MonthPoint } from '../types'
import { formatMoney, formatMonthShort } from '../utils/format'

interface NetWorthTableProps {
  id: string
  year: number
  series: MonthPoint[]
  /** Visible on screen; otherwise only assistive technology can reach it. */
  expanded: boolean
}

const statusOf = (p: MonthPoint) => (p.total === null ? 'No data' : p.complete ? 'Complete' : 'Incomplete')

const NetWorthTable: FC<NetWorthTableProps> = ({ id, year, series, expanded }) => (
  <table id={id} className={expanded ? 'ar-table' : 'ar-table sr-only'}>
    <caption>Net worth at the end of each month, {year}</caption>
    <thead>
      <tr>
        <th scope="col">Month</th>
        <th scope="col" className="ar-num">
          Net worth
        </th>
        <th scope="col">Status</th>
      </tr>
    </thead>
    <tbody>
      {series.map(p => (
        <tr key={p.month}>
          <th scope="row">{formatMonthShort(p.month)}</th>
          <td className="ar-num">{formatMoney(p.total)}</td>
          <td>{statusOf(p)}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

export default NetWorthTable
