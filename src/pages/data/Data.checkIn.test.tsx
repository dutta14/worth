import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation, type InitialEntry } from 'react-router-dom'
import Data from './Data'
import type { Account, BalanceEntry } from './types'
import { makeAccount, makeBalanceEntry } from '../../test/factories'

const mockSetBalances = vi.fn()
let mockAccounts: Account[] = []
let mockBalances: BalanceEntry[] = []

vi.mock('../../contexts/GoalsContext', () => ({
  useGoals: () => ({ profile: { name: '', currency: 'USD', locale: 'en-US', dateFormat: 'MMM YYYY' } }),
}))
vi.mock('../../contexts/SettingsContext', () => ({ useSettings: () => ({ allowCsvImport: false }) }))
vi.mock('../../contexts/DataContext', () => ({
  useData: () => ({
    accounts: mockAccounts,
    balances: mockBalances,
    setAccounts: vi.fn(),
    setBalances: (...args: unknown[]) => mockSetBalances(...args),
  }),
}))

vi.mock('../allocation/Allocation', () => ({ default: () => <div>Allocation Tab</div> }))
vi.mock('../tools/components/SavingsGrowthTracker', () => ({ default: () => <div>Growth Tracker Tab</div> }))
vi.mock('recharts', async () => {
  const Orig = await vi.importActual<Record<string, unknown>>('recharts')
  return {
    ...Orig,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }
})

const DETAILS = '/net-worth/dashboard/details'
const accounts = [makeAccount({ id: 1, name: 'Checking' }), makeAccount({ id: 2, name: '401k', type: 'retirement' })]
const september = [
  makeBalanceEntry({ id: 1, accountId: 1, month: '2026-09', balance: 5000 }),
  makeBalanceEntry({ id: 2, accountId: 2, month: '2026-09', balance: 50000 }),
]
const partialOctober = [...september, makeBalanceEntry({ id: 3, accountId: 1, month: '2026-10', balance: 5100 })]

const LocationProbe = () => {
  const location = useLocation()
  return <span data-testid="router-state">{JSON.stringify(location.state)}</span>
}

const renderData = (entry: InitialEntry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/net-worth/*" element={<Data />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )

const request = (month: unknown, pathname = DETAILS) => ({ pathname, state: { checkIn: { month } } })
const routerState = () => screen.getByTestId('router-state').textContent

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 8, 12))
  mockSetBalances.mockClear()
  mockAccounts = accounts
  mockBalances = september
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Data page check-in hand-off', () => {
  it('opens Details in edit mode for the requested new month', async () => {
    renderData(request('2026-10'))

    expect(await screen.findByText('Entering balances for October 2026')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).toHaveValue('5000')
    expect(screen.getByRole('textbox', { name: '401k balance' })).toHaveValue('50000')
  })

  it('opens an existing partial month with the missing account blank', async () => {
    mockBalances = partialOctober
    renderData(request('2026-10'))

    expect(await screen.findByText('Adding the missing balances for October 2026')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).toHaveValue('5100')
    expect(screen.getByRole('textbox', { name: '401k balance' })).toHaveValue('')
  })

  it('clears the router state so a reload or Back does not reopen the form', async () => {
    renderData(request('2026-10'))

    await screen.findByText('Entering balances for October 2026')
    await waitFor(() => expect(routerState()).toBe('null'))
  })

  it('does not reopen the form once the user cancels', async () => {
    const user = userEvent.setup()
    renderData(request('2026-10'))

    await screen.findByText('Entering balances for October 2026')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Entering balances for October 2026')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add Entry' })).toBeVisible()
  })

  it('saves through the existing balance path and announces the result', async () => {
    const user = userEvent.setup()
    renderData(request('2026-10'))

    await screen.findByText('Entering balances for October 2026')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockSetBalances).toHaveBeenCalledWith([
      ...september,
      { id: 3, accountId: 1, month: '2026-10', balance: 5000 },
      { id: 4, accountId: 2, month: '2026-10', balance: 50000 },
    ])
    expect(screen.getByRole('status')).toHaveTextContent('Saved October 2026. All 2 accounts have a balance.')
  })

  it.each([
    ['a malformed month', '2026-13'],
    ['a month in the future', '2026-12'],
    ['a month that is already complete', '2026-09'],
    ['a non-string month', 202610],
  ])('ignores %s but still clears the state', async (_label, month) => {
    renderData(request(month))

    await waitFor(() => expect(routerState()).toBe('null'))
    expect(screen.getByRole('button', { name: '+ Add Entry' })).toBeVisible()
    expect(screen.queryByText(/Entering balances for|Adding the missing/)).not.toBeInTheDocument()
  })

  it('ignores router state that is not a check-in request', () => {
    renderData({ pathname: DETAILS, state: { something: 'else' } })

    expect(routerState()).toBe('{"something":"else"}')
    expect(screen.getByRole('button', { name: '+ Add Entry' })).toBeVisible()
  })

  it('leaves a request on another tab alone', () => {
    renderData(request('2026-10', '/net-worth/dashboard'))

    expect(routerState()).toBe('{"checkIn":{"month":"2026-10"}}')
    expect(screen.queryByText(/Entering balances for/)).not.toBeInTheDocument()
  })
})

describe('Data page Charts tab with a partial month', () => {
  const CHARTS = '/net-worth/dashboard'
  const caption = 'October is not plotted until all accounts have a balance.'

  it('captions the omitted partial latest month', () => {
    mockBalances = partialOctober
    renderData(CHARTS)

    expect(screen.getByText(caption)).toBeVisible()
  })

  it('shows no caption when the latest month is complete', () => {
    mockBalances = [...partialOctober, makeBalanceEntry({ id: 4, accountId: 2, month: '2026-10', balance: 50100 })]
    renderData(CHARTS)

    expect(screen.queryByText(caption)).not.toBeInTheDocument()
  })
})
