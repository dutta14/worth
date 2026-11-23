import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckInCard from './CheckInCard'
import { getCheckInState, type CheckInState } from '../data/monthStatus'
import { makeAccount, makeBalanceEntry } from '../../test/factories'
import type { Account, BalanceEntry } from '../data/types'

vi.mock('../../styles/CheckInCard.css', () => ({}))

// 2026-11-08 local noon: current month 2026-11, last month 2026-10
const TODAY = new Date(2026, 10, 8, 12)

const accounts = (count: number, names: string[] = []): Account[] =>
  Array.from({ length: count }, (_, i) => makeAccount({ id: i + 1, name: names[i] ?? `Account ${i + 1}` }))

const monthEntries = (month: string, accountIds: number[]): BalanceEntry[] =>
  accountIds.map(accountId =>
    makeBalanceEntry({ id: Number(`${month.replace('-', '')}${accountId}`), accountId, month }),
  )

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

const stateFor = (accts: Account[], balances: BalanceEntry[], now: Date = TODAY): CheckInState =>
  getCheckInState(accts, balances, now)

interface Handlers {
  onStart: Mock<(month: string) => void>
  onNavigate: Mock<(path: string) => void>
  onSnooze: Mock<() => void>
}

const renderCard = (state: CheckInState, today: Date = TODAY) => {
  const handlers: Handlers = { onStart: vi.fn(), onNavigate: vi.fn(), onSnooze: vi.fn() }
  const utils = render(<CheckInCard state={state} today={today} {...handlers} />)
  const rerenderWith = (next: CheckInState) => utils.rerender(<CheckInCard state={next} today={today} {...handlers} />)
  return { ...utils, ...handlers, rerenderWith }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CheckInCard, partial month', () => {
  const nine = accounts(9, ['Checking', 'Savings', 'Brokerage', 'Roth IRA', 'HSA', '401k', 'Car', 'Mortgage', 'Cash'])
  const partial = () => stateFor(nine, monthEntries('2026-10', range(7)))

  it('names the count of missing accounts and the month in a labelled region', () => {
    renderCard(partial())
    const region = screen.getByRole('region', { name: '2 accounts missing for October' })
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent('2 accounts missing for October')
  })

  it('lists the missing accounts by name in a labelled list', () => {
    renderCard(partial())
    const list = screen.getByRole('list', { name: 'Accounts missing for October' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map(li => li.textContent),
    ).toEqual(['Mortgage', 'Cash'])
  })

  it('uses the singular form for one missing account', () => {
    renderCard(stateFor(accounts(2), monthEntries('2026-10', [1])))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('1 account missing for October')
  })

  it('shows how long ago the month ended and what net worth leaves out', () => {
    renderCard(partial())
    expect(screen.getByText('October ended 8 days ago.')).toBeInTheDocument()
    expect(screen.getByText('Net worth for October leaves these out until you add them.')).toBeInTheDocument()
  })

  it('uses the singular day form', () => {
    const now = new Date(2026, 10, 1, 12)
    renderCard(stateFor(nine, monthEntries('2026-10', range(7)), now), now)
    expect(screen.getByText('October ended 1 day ago.')).toBeInTheDocument()
  })

  it('omits the "ended" line while the month has not ended yet', () => {
    const now = new Date(2026, 9, 15, 12)
    renderCard(stateFor(nine, monthEntries('2026-10', range(7)), now), now)
    expect(screen.queryByText(/ended/)).not.toBeInTheDocument()
  })

  it('passes the reporting month to onStart from the Finish CTA', async () => {
    const user = userEvent.setup()
    const { onStart } = renderCard(partial())
    await user.click(screen.getByRole('button', { name: 'Finish October' }))
    expect(onStart).toHaveBeenCalledExactlyOnceWith('2026-10')
  })

  it('calls onSnooze from the snooze button', async () => {
    const user = userEvent.setup()
    const { onSnooze } = renderCard(partial())
    await user.click(screen.getByRole('button', { name: 'Snooze for 7 days' }))
    expect(onSnooze).toHaveBeenCalledOnce()
  })

  it('navigates to the Accounts tab from the mark-inactive link', async () => {
    const user = userEvent.setup()
    const { onNavigate } = renderCard(partial())
    await user.click(screen.getByRole('button', { name: 'Account closed? Mark it inactive' }))
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/net-worth/dashboard/manage')
  })

  it('falls back to "Unnamed account" for an empty name', () => {
    const named = [makeAccount({ id: 1, name: '  ' }), makeAccount({ id: 2 })]
    renderCard(stateFor(named, monthEntries('2026-10', [2])))
    expect(screen.getByRole('listitem')).toHaveTextContent('Unnamed account')
  })

  it('lists at most 6 accounts and summarises the rest', () => {
    const many = accounts(10)
    renderCard(stateFor(many, monthEntries('2026-09', range(10)).concat(monthEntries('2026-10', [1]))))
    const list = screen.getByRole('list', { name: 'Accounts missing for October' })
    const items = within(list).getAllByRole('listitem')
    expect(items.map(li => li.textContent)).toEqual([
      'Account 2',
      'Account 3',
      'Account 4',
      'Account 5',
      'Account 6',
      'Account 7',
      'and 3 more',
    ])
  })

  it('shows the warning-tone stale line instead of the "ended" line after 35 days', () => {
    const now = new Date(2026, 11, 6, 12)
    renderCard(stateFor(nine, monthEntries('2026-10', range(7)), now), now)
    expect(screen.getByText('Last balances are from October, 36 days ago.')).toBeInTheDocument()
    expect(screen.queryByText(/ended/)).not.toBeInTheDocument()
    expect(screen.getByRole('region')).toHaveClass('checkin-card--stale')
  })

  it('is not stale exactly 35 days after the month ended', () => {
    const now = new Date(2026, 11, 5, 12)
    renderCard(stateFor(nine, monthEntries('2026-10', range(7)), now), now)
    expect(screen.getByText('October ended 35 days ago.')).toBeInTheDocument()
    expect(screen.getByRole('region')).not.toHaveClass('checkin-card--stale')
  })

  it('adds the year when the reporting month is not in the current year', () => {
    renderCard(stateFor(nine, monthEntries('2025-10', range(7))))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2 accounts missing for October 2025')
  })

  it('renders a future-month note alongside the partial state', () => {
    renderCard(stateFor(nine, [...monthEntries('2026-10', range(7)), ...monthEntries('2026-12', [1])]))
    expect(screen.getByText('Balances also exist for December, which is in the future.')).toBeInTheDocument()
  })
})

describe('CheckInCard, due', () => {
  const due = () => stateFor(accounts(3), monthEntries('2026-09', [1, 2, 3]))

  it('asks to record the month after the latest recorded month', () => {
    renderCard(due())
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('October balances are ready to record')
  })

  it('treats a due month more than 35 days old as stale', () => {
    renderCard(due())
    expect(screen.getByText('Last balances are from September, 39 days ago.')).toBeInTheDocument()
    expect(screen.getByRole('region')).toHaveClass('checkin-card--due', 'checkin-card--stale')
  })

  it('shows the plain "ended" line when not stale', () => {
    const now = new Date(2026, 9, 5, 12)
    renderCard(stateFor(accounts(3), monthEntries('2026-08', [1, 2, 3]), now), now)
    expect(screen.getByText('August ended 35 days ago.')).toBeInTheDocument()
  })

  it('starts the check-in for the target month from the CTA', async () => {
    const user = userEvent.setup()
    const { onStart } = renderCard(due())
    await user.click(screen.getByRole('button', { name: 'Start October check-in' }))
    expect(onStart).toHaveBeenCalledExactlyOnceWith('2026-10')
  })

  it('offers snooze but not the mark-inactive link or a missing list', () => {
    renderCard(due())
    expect(screen.getByRole('button', { name: 'Snooze for 7 days' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark it inactive/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('CheckInCard, up to date', () => {
  it('renders nothing when the latest month is complete', () => {
    renderCard(stateFor(accounts(3), monthEntries('2026-10', range(3))))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('CheckInCard, future only', () => {
  it('explains the dates and links to the spreadsheet', async () => {
    const user = userEvent.setup()
    const { onNavigate } = renderCard(stateFor(accounts(2), monthEntries('2026-12', [1, 2])))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Your latest balances are dated in the future')
    expect(screen.queryByRole('button', { name: /snooze/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review months' }))
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/net-worth/dashboard/spreadsheet')
  })
})

describe('CheckInCard, hidden', () => {
  it('renders nothing', () => {
    const { container } = renderCard(stateFor([], []))
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CheckInCard, status announcements', () => {
  const nine = accounts(9)

  it('is silent on first render', () => {
    renderCard(stateFor(nine, monthEntries('2026-10', range(7))))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('announces the new count when the missing count changes after mount', () => {
    const { rerenderWith } = renderCard(stateFor(nine, monthEntries('2026-10', range(7))))
    rerenderWith(stateFor(nine, monthEntries('2026-10', range(8))))
    expect(screen.getByRole('status')).toHaveTextContent('1 account missing for October.')
  })

  it('does not announce on a re-render with the same state', () => {
    const state = stateFor(nine, monthEntries('2026-10', range(7)))
    const { rerenderWith } = renderCard(state)
    rerenderWith({ ...state })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('does not announce when only the day count changes', () => {
    const state = stateFor(nine, monthEntries('2026-10', range(7)))
    const { rerenderWith } = renderCard(state)
    rerenderWith({ ...state, daysSinceMonthEnd: 9 })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

describe('CheckInCard, keyboard', () => {
  it('moves focus through the CTA, snooze, and mark-inactive link in DOM order and activates with Enter and Space', async () => {
    const user = userEvent.setup()
    const { onStart, onSnooze, onNavigate } = renderCard(stateFor(accounts(2), monthEntries('2026-10', [1])))

    await user.tab()
    expect(screen.getByRole('button', { name: 'Finish October' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onStart).toHaveBeenCalledWith('2026-10')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Snooze for 7 days' })).toHaveFocus()
    await user.keyboard(' ')
    expect(onSnooze).toHaveBeenCalledOnce()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Account closed? Mark it inactive' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onNavigate).toHaveBeenCalledWith('/net-worth/dashboard/manage')
  })

  it('keeps the missing-account list out of the tab order', async () => {
    const user = userEvent.setup()
    renderCard(stateFor(accounts(2), monthEntries('2026-10', [1])))
    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(document.body).toHaveFocus()
  })
})
