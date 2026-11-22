import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Children, isValidElement, type ReactNode } from 'react'
import BalanceCharts from './BalanceCharts'
import { makeAccount, makeBalanceEntry } from '../../test/factories'
import type { Account, BalanceEntry } from './types'

interface MockChartProps {
  data: { month: string }[]
  children?: ReactNode
}

vi.mock('recharts', () => {
  const YAxis = ({ domain }: { domain: [number, number] }) => (
    <div data-testid="y-domain" data-domain={domain.join(',')} />
  )
  // Render only the y-axis so the SVG-only children (defs, gradients) stay out of the jsdom tree.
  const Chart = ({ data, children }: MockChartProps) => (
    <div data-testid="chart" data-months={data.map(d => d.month).join(',')}>
      {Children.toArray(children).filter(child => isValidElement(child) && child.type === YAxis)}
    </div>
  )
  const Nothing = () => null
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ComposedChart: Chart,
    BarChart: Chart,
    YAxis,
    XAxis: Nothing,
    Line: Nothing,
    Area: Nothing,
    Bar: Nothing,
    Tooltip: Nothing,
    CartesianGrid: Nothing,
    ReferenceLine: Nothing,
    Legend: Nothing,
  }
})

const accounts: Account[] = [
  makeAccount({ id: 1, name: '401k', goalType: 'fi', type: 'retirement' }),
  makeAccount({ id: 2, name: 'Checking', goalType: 'gw', type: 'liquid' }),
]

const balances: BalanceEntry[] = [
  makeBalanceEntry({ id: 1, accountId: 1, month: '2024-01', balance: 5000 }),
  makeBalanceEntry({ id: 2, accountId: 2, month: '2024-01', balance: 1000 }),
  makeBalanceEntry({ id: 3, accountId: 1, month: '2024-02', balance: 5500 }),
  makeBalanceEntry({ id: 4, accountId: 2, month: '2024-02', balance: 1200 }),
  // March is partial: Checking has no balance, so the sum looks like a crash.
  makeBalanceEntry({ id: 5, accountId: 1, month: '2024-03', balance: 2000 }),
]

const buildMap = (entries: BalanceEntry[]) => new Map(entries.map(e => [`${e.accountId}:${e.month}`, e.balance]))

const renderCharts = (overrides: Partial<React.ComponentProps<typeof BalanceCharts>> = {}) =>
  render(
    <BalanceCharts
      accounts={accounts}
      balances={balances}
      balanceMap={buildMap(balances)}
      allMonths={['2024-03', '2024-02', '2024-01']}
      {...overrides}
    />,
  )

const plottedMonths = () => screen.getByTestId('chart').getAttribute('data-months')
const yDomain = () => screen.getByTestId('y-domain').getAttribute('data-domain')

describe('BalanceCharts plotted data with a partial month', () => {
  it('plots every month when none is omitted', () => {
    renderCharts()

    expect(plottedMonths()).toBe('2024-01,2024-02,2024-03')
    expect(Number(yDomain()?.split(',')[0])).toBeLessThan(2100)
  })

  it('omits the partial month and leaves the y-domain to the plotted months', () => {
    renderCharts({ omitMonth: '2024-03' })

    expect(plottedMonths()).toBe('2024-01,2024-02')
    expect(yDomain()).toBe('5965,6735')
  })

  it.each(['FI vs GW', 'Assets vs Liabilities'])('omits the partial month on the %s chart too', async name => {
    const user = userEvent.setup()
    renderCharts({ omitMonth: '2024-03' })

    await user.click(screen.getByRole('button', { name }))

    expect(plottedMonths()).toBe('2024-01,2024-02')
  })
})
