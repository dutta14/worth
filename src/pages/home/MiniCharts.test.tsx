import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Children, isValidElement, type ReactNode } from 'react'
import MiniCharts from './MiniCharts'
import { makeAccount, makeBalanceEntry } from '../../test/factories'
import type { Account, BalanceEntry } from '../data/types'

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

const renderCharts = (overrides: Partial<React.ComponentProps<typeof MiniCharts>> = {}) =>
  render(
    <MiniCharts
      accounts={accounts}
      balances={balances}
      balanceMap={buildMap(balances)}
      allMonths={['2024-03', '2024-02', '2024-01']}
      onNavigate={vi.fn()}
      {...overrides}
    />,
  )

const plottedMonths = () => screen.getByTestId('chart').getAttribute('data-months')
const yDomain = () => screen.getByTestId('y-domain').getAttribute('data-domain')
const caption = /is not plotted until all accounts have a balance\./

describe('MiniCharts', () => {
  it('plots every month in ascending order when no month is omitted', () => {
    renderCharts()

    expect(plottedMonths()).toBe('2024-01,2024-02,2024-03')
    expect(screen.queryByText(caption)).not.toBeInTheDocument()
  })

  it('plots the same months when omitMonth is null', () => {
    renderCharts({ omitMonth: null })

    expect(plottedMonths()).toBe('2024-01,2024-02,2024-03')
    expect(screen.queryByText(caption)).not.toBeInTheDocument()
  })

  it('omits the partial month and shows the caption', () => {
    renderCharts({ omitMonth: '2024-03' })

    expect(plottedMonths()).toBe('2024-01,2024-02')
    expect(screen.getByText(/March 20\d\d is not plotted until all accounts have a balance\./)).toBeInTheDocument()
  })

  it('keeps the partial month in the y-domain when it is plotted', () => {
    renderCharts()

    expect(Number(yDomain()?.split(',')[0])).toBeLessThan(2100)
  })

  it('leaves the y-domain to the months that are plotted', () => {
    renderCharts({ omitMonth: '2024-03' })

    expect(yDomain()).toBe('5965,6735')
  })

  it.each(['FI vs GW', 'A/L'])('omits the partial month on the %s chart too', async name => {
    const user = userEvent.setup()
    renderCharts({ omitMonth: '2024-03' })

    await user.click(screen.getByRole('button', { name }))

    expect(plottedMonths()).toBe('2024-01,2024-02')
    expect(screen.getByText(caption)).toBeInTheDocument()
  })

  it('omits no month and shows no caption when the date range excludes the partial month', async () => {
    const user = userEvent.setup()
    renderCharts({ omitMonth: '2024-03', allMonths: ['2024-03', '2024-02', '2024-01', '2023-12'] })

    await user.click(screen.getByRole('button', { name: 'Year-End' }))

    expect(plottedMonths()).toBe('2023-12')
    expect(screen.queryByText(caption)).not.toBeInTheDocument()
  })

  it('shows the caption without a chart when the only month is omitted', () => {
    renderCharts({ omitMonth: '2024-03', allMonths: ['2024-03'] })

    expect(plottedMonths()).toBe('')
    expect(screen.getByText(caption)).toBeInTheDocument()
  })

  it('shows the empty state and no caption when there are no balances', () => {
    renderCharts({ balances: [], balanceMap: new Map(), allMonths: [], omitMonth: '2024-03' })

    expect(
      screen.getByText('Charts will appear once you have balance data across multiple months.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(caption)).not.toBeInTheDocument()
  })

  it('calls onNavigate from the View Charts link', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderCharts({ onNavigate })

    await user.click(screen.getByRole('button', { name: 'View Charts →' }))

    expect(onNavigate).toHaveBeenCalledOnce()
  })
})
