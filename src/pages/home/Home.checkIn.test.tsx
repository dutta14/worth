import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'
import { makeAccount, makeBalanceEntry } from '../../test/factories'
import type { Account, BalanceEntry } from '../data/types'

vi.mock('../../styles/Home.css', () => ({}))
vi.mock('../../styles/CheckInCard.css', () => ({}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../contexts/GoalsContext', () => ({
  useGoals: () => ({ visibleGoals: [], gwGoals: [], profile: { name: '' } }),
}))

let mockData: { accounts: Account[]; balances: BalanceEntry[] } = { accounts: [], balances: [] }
vi.mock('../../contexts/DataContext', () => ({ useData: () => mockData }))

vi.mock('../budget/utils/budgetStorage', () => ({
  loadBudgetStore: vi.fn(() => Promise.resolve({ csvs: {} })),
}))

vi.mock('../../hooks/useTouchDrag', () => ({
  useTouchDrag: () => ({
    getTouchHandlers: () => ({ onTouchStart: vi.fn(), onTouchMove: vi.fn(), onTouchEnd: vi.fn() }),
    isDragging: false,
    isLongPressing: false,
    dragIdx: null,
    touchMoved: false,
  }),
}))

let netWorthRenders = 0
let netWorthProps: { partial?: unknown } = {}
let chartsProps: { omitMonth?: unknown } = {}
vi.mock('./NetWorthSummary', () => ({
  default: (props: { partial?: unknown }) => {
    netWorthRenders++
    netWorthProps = props
    return <div>Net Worth Card</div>
  },
}))
vi.mock('./MiniCharts', () => ({
  default: (props: { omitMonth?: unknown }) => {
    chartsProps = props
    return <div>Charts Card</div>
  },
}))
vi.mock('./GoalsPeek', () => ({ default: () => <div>Goals Card</div> }))
vi.mock('./AllocationBreakdown', () => ({ default: () => <div>Allocation Card</div> }))
vi.mock('./SpendingPeek', () => ({ default: () => <div>Spending Card</div> }))
vi.mock('./SetupProgress', () => ({ default: () => <section aria-label="Setup progress stub">Setup</section> }))

const TODAY = new Date(2026, 10, 8, 12)

const nine = Array.from({ length: 9 }, (_, i) => makeAccount({ id: i + 1, name: `Account ${i + 1}` }))
const entries = (month: string, count: number): BalanceEntry[] =>
  Array.from({ length: count }, (_, i) => makeBalanceEntry({ id: i + 1, accountId: i + 1, month, balance: 100 }))

const renderHome = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )

const stripHeading = () => screen.findByRole('heading', { level: 2, name: /missing for October/ })

beforeEach(() => {
  localStorage.clear()
  mockNavigate.mockClear()
  netWorthRenders = 0
  netWorthProps = {}
  chartsProps = {}
  mockData = { accounts: nine, balances: entries('2026-10', 7) }
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
  vi.setSystemTime(TODAY)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Home check-in strip', () => {
  it('shows the partial strip with the missing accounts', async () => {
    renderHome()
    await stripHeading()
    expect(screen.getByRole('heading', { level: 2, name: '2 accounts missing for October' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Accounts missing for October' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map(li => li.textContent),
    ).toEqual(['Account 8', 'Account 9'])
  })

  it('renders the strip after SetupProgress and before the card grid', async () => {
    renderHome()
    const strip = (await stripHeading()).closest('section') as HTMLElement
    const setup = screen.getByRole('region', { name: 'Setup progress stub' })
    const grid = screen.getByTestId('drag-slot-0').parentElement as HTMLElement
    expect(setup.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(strip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps five card slots, none containing the strip, and leaves home-card-order alone', async () => {
    renderHome()
    const strip = (await stripHeading()).closest('section') as HTMLElement
    const slots = screen.getAllByTestId(/^drag-slot-/)
    expect(slots).toHaveLength(5)
    expect(slots.some(slot => slot.contains(strip))).toBe(false)
    expect(strip.closest('[draggable="true"]')).toBeNull()
    expect(within(strip).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument()
    expect(localStorage.getItem('home-card-order')).toBeNull()
  })

  it('hands the target month to Details through router state from the CTA', async () => {
    const user = userEvent.setup()
    renderHome()
    await stripHeading()
    await user.click(screen.getByRole('button', { name: 'Finish October' }))
    expect(mockNavigate).toHaveBeenCalledExactlyOnceWith('/net-worth/dashboard/details', {
      state: { checkIn: { month: '2026-10' } },
    })
  })

  it('navigates to the Accounts tab from the mark-inactive link', async () => {
    const user = userEvent.setup()
    renderHome()
    await stripHeading()
    await user.click(screen.getByRole('button', { name: 'Account closed? Mark it inactive' }))
    expect(mockNavigate).toHaveBeenCalledExactlyOnceWith('/net-worth/dashboard/manage')
  })

  it('shows the calm complete strip when the latest month is complete', async () => {
    mockData = { accounts: nine, balances: entries('2026-10', 9) }
    renderHome()
    expect(await screen.findByRole('heading', { level: 2, name: 'October is complete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snooze/i })).not.toBeInTheDocument()
  })

  it('shows the due strip with the stale tone when the latest month is old', async () => {
    mockData = { accounts: nine, balances: entries('2026-09', 9) }
    renderHome()
    expect(await screen.findByRole('heading', { level: 2, name: 'October balances are ready to record' })).toBeVisible()
    expect(screen.getByRole('region', { name: /ready to record/ })).toHaveClass('checkin-card--stale')
    expect(screen.getByText('Last balances are from September, 39 days ago.')).toBeInTheDocument()
  })

  it.each([
    ['no accounts', { accounts: [], balances: [] }],
    ['no balances', { accounts: nine, balances: [] }],
    [
      'no active accounts',
      { accounts: nine.map(a => ({ ...a, status: 'inactive' as const })), balances: entries('2026-10', 9) },
    ],
  ])('renders no strip with %s', async (_name, data) => {
    mockData = data
    renderHome()
    await waitFor(() => expect(screen.getByTestId('drag-slot-0')).toBeInTheDocument())
    expect(
      screen.queryByRole('heading', { level: 2, name: /missing|complete|ready to record/ }),
    ).not.toBeInTheDocument()
  })

  it('makes the page heading a programmatic focus target', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('tabindex', '-1')
  })
})

describe('Home check-in strip, snooze', () => {
  it('hides the strip, stores the snooze, announces it, and moves focus to the page heading', async () => {
    const user = userEvent.setup()
    renderHome()
    await stripHeading()
    await user.click(screen.getByRole('button', { name: 'Snooze for 7 days' }))

    expect(screen.queryByRole('heading', { level: 2, name: /missing for October/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    expect(screen.getByText('Check-in snoozed for 7 days.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('checkin-snooze') ?? 'null')).toEqual({
      month: '2026-10',
      until: '2026-11-15',
    })
  })

  it('supports the keyboard flow: tab to the snooze button, press Enter, and land on the heading', async () => {
    const user = userEvent.setup()
    renderHome()
    await stripHeading()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Finish October' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Snooze for 7 days' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    await user.tab()
    expect(screen.getByTestId('drag-slot-0').contains(document.activeElement)).toBe(true)
  })

  it('stays hidden on a later render while the snooze is active for the same month', async () => {
    localStorage.setItem('checkin-snooze', JSON.stringify({ month: '2026-10', until: '2026-11-15' }))
    renderHome()
    await waitFor(() => expect(screen.getByTestId('drag-slot-0')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { level: 2, name: /missing for October/ })).not.toBeInTheDocument()
  })

  it('shows the strip again once the snooze date arrives', async () => {
    localStorage.setItem('checkin-snooze', JSON.stringify({ month: '2026-10', until: '2026-11-08' }))
    renderHome()
    await stripHeading()
  })

  it('shows the strip again when a newer month was recorded after the snooze', async () => {
    localStorage.setItem('checkin-snooze', JSON.stringify({ month: '2026-09', until: '2026-11-15' }))
    renderHome()
    await stripHeading()
  })

  it('does not hide the complete strip because of an old snooze for the same month', async () => {
    localStorage.setItem('checkin-snooze', JSON.stringify({ month: '2026-10', until: '2026-11-15' }))
    mockData = { accounts: nine, balances: entries('2026-10', 9) }
    renderHome()
    expect(await screen.findByRole('heading', { level: 2, name: 'October is complete' })).toBeInTheDocument()
  })

  it('still hides, announces, and moves focus when the snooze cannot be persisted', async () => {
    const user = userEvent.setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHome()
    await stripHeading()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    await user.click(screen.getByRole('button', { name: 'Snooze for 7 days' }))

    expect(screen.queryByRole('heading', { level: 2, name: /missing for October/ })).not.toBeInTheDocument()
    expect(screen.getByText('Check-in snoozed for 7 days.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    expect(warn).toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(localStorage.getItem('checkin-snooze')).toBeNull()
  })

  it('ignores an invalid stored snooze', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('checkin-snooze', '{"month":5}')
    renderHome()
    await stripHeading()
  })
})

describe('Home check-in strip, day rollover and re-renders', () => {
  it('does not re-render Home on window focus or visibility change when the day is unchanged', async () => {
    renderHome()
    await stripHeading()
    const before = netWorthRenders
    act(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(netWorthRenders).toBe(before)
  })

  it('shows an ended snooze again when the tab regains focus on a new day', async () => {
    localStorage.setItem('checkin-snooze', JSON.stringify({ month: '2026-10', until: '2026-11-09' }))
    renderHome()
    await waitFor(() => expect(screen.getByTestId('drag-slot-0')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { level: 2, name: /missing for October/ })).not.toBeInTheDocument()

    act(() => {
      vi.setSystemTime(new Date(2026, 10, 9, 0, 5))
      window.dispatchEvent(new Event('focus'))
    })
    await stripHeading()
  })
})

describe('Home partial month', () => {
  it('passes the partial month to the Net Worth card and omits it from the charts', async () => {
    renderHome()
    await stripHeading()

    expect(netWorthProps.partial).toEqual({ month: '2026-10', missingCount: 2 })
    expect(chartsProps.omitMonth).toBe('2026-10')
  })

  it('passes no partial month once the latest month is complete', async () => {
    mockData = { accounts: nine, balances: entries('2026-10', 9) }
    renderHome()
    await waitFor(() => expect(screen.getByText('Net Worth Card')).toBeInTheDocument())

    expect(netWorthProps.partial).toBeNull()
    expect(chartsProps.omitMonth).toBeUndefined()
  })

  it('keeps passing the partial month while the strip is snoozed', async () => {
    const user = userEvent.setup()
    renderHome()
    await stripHeading()

    await user.click(screen.getByRole('button', { name: 'Snooze for 7 days' }))

    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(netWorthProps.partial).toEqual({ month: '2026-10', missingCount: 2 })
    expect(chartsProps.omitMonth).toBe('2026-10')
  })

  it('evaluates only the latest month, not older gaps', async () => {
    mockData = { accounts: nine, balances: [...entries('2026-09', 5), ...entries('2026-10', 9)] }
    renderHome()
    await waitFor(() => expect(screen.getByText('Net Worth Card')).toBeInTheDocument())

    expect(netWorthProps.partial).toBeNull()
  })
})
