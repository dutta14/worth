import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BalanceDetails from './BalanceDetails'
import { makeAccount, makeBalanceEntry } from '../../test/factories'
import type { Profile } from '../../hooks/useProfile'
import type { Account, BalanceEntry } from './types'

let mockFlag = true
vi.mock('../../flags/useFlag', () => ({ useFlag: () => mockFlag }))

const profile: Profile = { name: 'Alex', avatarDataUrl: '', birthday: '' }

const accounts: Account[] = [
  makeAccount({ id: 1, name: 'Checking' }),
  makeAccount({ id: 2, name: 'Brokerage' }),
  makeAccount({ id: 3, name: 'Roth IRA' }),
  makeAccount({ id: 4, name: 'Old Savings', status: 'inactive' }),
]

const septemberToOctober: BalanceEntry[] = [
  makeBalanceEntry({ id: 1, accountId: 1, month: '2026-09', balance: 1000 }),
  makeBalanceEntry({ id: 2, accountId: 2, month: '2026-09', balance: 2000 }),
  makeBalanceEntry({ id: 3, accountId: 3, month: '2026-09', balance: 12400 }),
  makeBalanceEntry({ id: 4, accountId: 1, month: '2026-10', balance: 1100 }),
  makeBalanceEntry({ id: 5, accountId: 2, month: '2026-10', balance: 2100 }),
]
const completeSeptember = septemberToOctober.slice(0, 3)

const monthsOf = (balances: BalanceEntry[]) => [...new Set(balances.map(b => b.month))].sort().reverse()
const mapOf = (balances: BalanceEntry[]) => new Map(balances.map(b => [`${b.accountId}:${b.month}`, b.balance]))

interface HarnessProps {
  balances: BalanceEntry[]
  startCheckInMonth?: string | null
  onSaveMonth?: (month: string, values: Record<string, number>) => void
  onCheckInStarted?: () => void
  accountList?: Account[]
}

const Harness = ({
  balances,
  startCheckInMonth,
  onSaveMonth = vi.fn(),
  onCheckInStarted,
  accountList = accounts,
}: HarnessProps) => {
  const [start, setStart] = useState(startCheckInMonth ?? null)
  return (
    <BalanceDetails
      accounts={accountList}
      balances={balances}
      allMonths={monthsOf(balances)}
      balanceMap={mapOf(balances)}
      profile={profile}
      onSaveMonth={onSaveMonth}
      startCheckInMonth={start}
      onCheckInStarted={() => {
        onCheckInStarted?.()
        setStart(null)
      }}
    />
  )
}

const firstInputFocused = () =>
  waitFor(() => expect(document.activeElement).toBe(document.querySelector('.account-card__value-input')))

const RequestHarness = ({ balances }: { balances: BalanceEntry[] }) => {
  const [start, setStart] = useState<string | null>(null)
  return (
    <>
      <button type="button" onClick={() => setStart('2026-10')}>
        request
      </button>
      <BalanceDetails
        accounts={accounts}
        balances={balances}
        allMonths={monthsOf(balances)}
        balanceMap={mapOf(balances)}
        profile={profile}
        startCheckInMonth={start}
        onCheckInStarted={() => setStart(null)}
      />
    </>
  )
}

beforeEach(() => {
  mockFlag = true
})

describe('BalanceDetails check-in: partial month', () => {
  it('opens edit mode for the requested month and announces the partial banner', async () => {
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    expect(await screen.findByText('Adding the missing balances for October 2026')).toBeVisible()
    expect(screen.queryByText(/Amounts are copied from/)).not.toBeInTheDocument()
  })

  it('focuses the first account input', async () => {
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.account-card__value-input')))
  })

  it('prefills saved values and leaves missing accounts blank', async () => {
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    expect(await screen.findByRole('textbox', { name: 'Checking balance' })).toHaveValue('1100')
    expect(screen.getByRole('textbox', { name: 'Brokerage balance' })).toHaveValue('2100')
    expect(screen.getByRole('textbox', { name: 'Roth IRA balance' })).toHaveValue('')
    expect(screen.queryByRole('textbox', { name: 'Old Savings balance' })).not.toBeInTheDocument()
  })

  it('does not caption saved values as copied', async () => {
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    await screen.findByRole('textbox', { name: 'Checking balance' })
    expect(screen.queryByText(/Copied from/)).not.toBeInTheDocument()
  })

  it('flags the blank account with a note that includes the last recorded amount', async () => {
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    const roth = await screen.findByRole('textbox', { name: 'Roth IRA balance' })

    expect(roth).toHaveAccessibleDescription('No balance yet. Last recorded $12,400 in September 2026.')
    expect(roth).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).not.toHaveAccessibleDescription()
  })

  it('says there is no earlier balance for an account with no history', async () => {
    const withNew = [...accounts, makeAccount({ id: 5, name: 'New Brokerage' })]
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" accountList={withNew} />)

    expect(await screen.findByRole('textbox', { name: 'New Brokerage balance' })).toHaveAccessibleDescription(
      'No balance yet. No earlier balance.',
    )
  })

  it('counts blank accounts in the footer', async () => {
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    expect(await screen.findByText('1 account still blank. Blank accounts are not saved.')).toBeVisible()
  })

  it('updates the footer count and removes the note as the user types', async () => {
    const user = userEvent.setup()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    const roth = await screen.findByRole('textbox', { name: 'Roth IRA balance' })
    await firstInputFocused()
    await user.type(roth, '12,500')

    expect(roth).not.toHaveAccessibleDescription()
    expect(screen.getByText('Every account has a balance.')).toBeVisible()
    expect(screen.queryByText('No balance yet')).not.toBeInTheDocument()
  })

  it('treats zero as a balance', async () => {
    const user = userEvent.setup()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    const roth = await screen.findByRole('textbox', { name: 'Roth IRA balance' })
    await firstInputFocused()
    await user.type(roth, '0')

    expect(screen.getByText('Every account has a balance.')).toBeVisible()
  })

  it('does not count text that cannot be saved as a balance', async () => {
    const user = userEvent.setup()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    const roth = await screen.findByRole('textbox', { name: 'Roth IRA balance' })
    await firstInputFocused()
    await user.type(roth, 'abc')

    expect(screen.getByText('1 account still blank. Blank accounts are not saved.')).toBeVisible()
  })

  it('saves only filled values and announces how many accounts still have no balance', async () => {
    const user = userEvent.setup()
    const onSaveMonth = vi.fn()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" onSaveMonth={onSaveMonth} />)

    await screen.findByRole('textbox', { name: 'Roth IRA balance' })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSaveMonth).toHaveBeenCalledWith('2026-10', { '1': 1100, '2': 2100 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved October 2026. 1 account still has no balance.')
  })

  it('announces that every account has a balance after the missing one is filled', async () => {
    const user = userEvent.setup()
    const onSaveMonth = vi.fn()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" onSaveMonth={onSaveMonth} />)

    const roth = await screen.findByRole('textbox', { name: 'Roth IRA balance' })
    await firstInputFocused()
    await user.type(roth, '12500')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSaveMonth).toHaveBeenCalledWith('2026-10', { '1': 1100, '2': 2100, '3': 12500 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved October 2026. All 3 accounts have a balance.')
  })

  it('pluralizes the remaining count', async () => {
    const user = userEvent.setup()
    const balances = [...completeSeptember, makeBalanceEntry({ id: 9, accountId: 1, month: '2026-10', balance: 1100 })]
    render(<Harness balances={balances} startCheckInMonth="2026-10" />)

    await screen.findByRole('textbox', { name: 'Checking balance' })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status')).toHaveTextContent('Saved October 2026. 2 accounts still have no balance.')
  })

  it('clears the previous save announcement when a new entry starts', async () => {
    const user = userEvent.setup()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    await screen.findByRole('textbox', { name: 'Roth IRA balance' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement()

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('announces a single account with a balance in the singular', async () => {
    const user = userEvent.setup()
    const solo = [accounts[0], accounts[3]]
    const balances = [
      makeBalanceEntry({ id: 1, accountId: 1, month: '2026-09', balance: 1 }),
      makeBalanceEntry({ id: 2, accountId: 1, month: '2026-10', balance: 2 }),
    ]
    render(<Harness balances={balances} startCheckInMonth="2026-10" accountList={solo} />)

    await screen.findByRole('textbox', { name: 'Checking balance' })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status')).toHaveTextContent('Saved October 2026. Your account has a balance.')
  })
})

describe('BalanceDetails check-in: new month', () => {
  it('prefills every active account from the latest month with a banner sentence', async () => {
    render(<Harness balances={completeSeptember} startCheckInMonth="2026-10" />)

    expect(await screen.findByText('Entering balances for October 2026')).toBeVisible()
    expect(screen.getByText('Amounts are copied from September 2026. Update each one, then save.')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).toHaveValue('1000')
    expect(screen.getByRole('textbox', { name: 'Brokerage balance' })).toHaveValue('2000')
    expect(screen.getByRole('textbox', { name: 'Roth IRA balance' })).toHaveValue('12400')
  })

  it('captions each copied field and links the caption to its input', async () => {
    render(<Harness balances={completeSeptember} startCheckInMonth="2026-10" />)

    await screen.findByRole('textbox', { name: 'Checking balance' })

    expect(screen.getAllByText('Copied from September 2026')).toHaveLength(3)
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).toHaveAccessibleDescription(
      'Copied from September 2026',
    )
    expect(screen.getByText('Every account has a balance.')).toBeVisible()
  })

  it('clears the caption of a field once the user changes it', async () => {
    const user = userEvent.setup()
    render(<Harness balances={completeSeptember} startCheckInMonth="2026-10" />)

    const checking = await screen.findByRole('textbox', { name: 'Checking balance' })
    await firstInputFocused()
    await user.clear(checking)
    await user.type(checking, '1050')

    expect(screen.getAllByText('Copied from September 2026')).toHaveLength(2)
    expect(checking).not.toHaveAccessibleDescription()
  })

  it('flags a copied field that the user empties', async () => {
    const user = userEvent.setup()
    render(<Harness balances={completeSeptember} startCheckInMonth="2026-10" />)

    const checking = await screen.findByRole('textbox', { name: 'Checking balance' })
    await firstInputFocused()
    await user.clear(checking)

    expect(checking).toHaveAccessibleDescription('No balance yet. Last recorded $1,000 in September 2026.')
    expect(screen.getByText('1 account still blank. Blank accounts are not saved.')).toBeVisible()
  })

  it('saves the copied values unchanged with a keyboard-only flow', async () => {
    const user = userEvent.setup()
    const onSaveMonth = vi.fn()
    render(<Harness balances={completeSeptember} startCheckInMonth="2026-10" onSaveMonth={onSaveMonth} />)

    await firstInputFocused()
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(3)
    await user.tab()
    expect(inputs[1]).toHaveFocus()
    await user.tab()
    expect(inputs[2]).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onSaveMonth).toHaveBeenCalledWith('2026-10', { '1': 1000, '2': 2000, '3': 12400 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved October 2026. All 3 accounts have a balance.')
  })

  it('cancels with Escape and does not reopen the form', async () => {
    const user = userEvent.setup()
    const onCheckInStarted = vi.fn()
    render(<Harness balances={completeSeptember} startCheckInMonth="2026-10" onCheckInStarted={onCheckInStarted} />)

    await screen.findByRole('textbox', { name: 'Checking balance' })
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox', { name: 'Checking balance' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add Entry' })).toBeVisible()
    expect(onCheckInStarted).toHaveBeenCalledTimes(1)
  })

  it('starts blank with no copied sentence when there are no earlier balances', async () => {
    render(<Harness balances={[]} startCheckInMonth="2026-10" />)

    expect(await screen.findByText('Entering balances for October 2026')).toBeVisible()
    expect(screen.queryByText(/Amounts are copied from/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).toHaveValue('')
  })

  it('shows accounts that a Details filter had hidden', async () => {
    const user = userEvent.setup()
    render(<RequestHarness balances={completeSeptember} />)

    await user.click(screen.getByRole('button', { name: /Filters/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Joint' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.queryByText('Checking')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'request' }))

    expect(await screen.findByRole('textbox', { name: 'Checking balance' })).toBeVisible()
  })
})

describe('BalanceDetails check-in: guards', () => {
  it('does not restart while the user is already editing and still reports the request as handled', async () => {
    const user = userEvent.setup()
    const onCheckInStarted = vi.fn()
    const Wrapper = () => {
      const [start, setStart] = useState<string | null>(null)
      return (
        <>
          <button type="button" onClick={() => setStart('2026-10')}>
            request
          </button>
          <BalanceDetails
            accounts={accounts}
            balances={completeSeptember}
            allMonths={['2026-09']}
            balanceMap={mapOf(completeSeptember)}
            profile={profile}
            startCheckInMonth={start}
            onCheckInStarted={() => {
              onCheckInStarted()
              setStart(null)
            }}
          />
        </>
      )
    }
    render(<Wrapper />)

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Entering balances for October 2026')).toBeVisible()
    await user.clear(screen.getByRole('textbox', { name: 'Checking balance' }))
    await user.type(screen.getByRole('textbox', { name: 'Checking balance' }), '777')
    await user.click(screen.getByRole('button', { name: 'request' }))

    expect(onCheckInStarted).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).toHaveValue('777')
  })

  it('shows copied captions in the Add Entry flow too', async () => {
    const user = userEvent.setup()
    render(<Harness balances={completeSeptember} />)

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findAllByText('Copied from September 2026')).toHaveLength(3)
    expect(screen.getByText('Amounts are copied from September 2026. Update each one, then save.')).toBeVisible()
  })

  it('does not caption anything when Add Entry starts blank', async () => {
    const user = userEvent.setup()
    render(<Harness balances={completeSeptember} />)

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    await user.click(screen.getByLabelText('Start blank'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.queryByText(/Copied from/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Amounts are copied from/)).not.toBeInTheDocument()
    expect(screen.getByText('3 accounts still blank. Blank accounts are not saved.')).toBeVisible()
  })
})

describe('BalanceDetails with the monthly-check-in flag off', () => {
  beforeEach(() => {
    mockFlag = false
  })

  it('ignores a check-in request and leaves the request unconsumed', () => {
    const onCheckInStarted = vi.fn()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" onCheckInStarted={onCheckInStarted} />)

    expect(screen.getByRole('button', { name: '+ Add Entry' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Checking balance' })).not.toBeInTheDocument()
    expect(onCheckInStarted).not.toHaveBeenCalled()
  })

  it('keeps the plain edit mode: one-line banner, no captions, no status region, no footer summary', async () => {
    const user = userEvent.setup()
    const onSaveMonth = vi.fn()
    render(<Harness balances={completeSeptember} onSaveMonth={onSaveMonth} />)

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Entering balances for October 2026')).toBeVisible()
    expect(screen.queryByText(/copied from/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/still blank|Every account has a balance/)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).not.toHaveAttribute('aria-describedby')

    await user.clear(screen.getByRole('textbox', { name: 'Roth IRA balance' }))
    expect(screen.queryByText('No balance yet')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSaveMonth).toHaveBeenCalledWith('2026-10', { '1': 1000, '2': 2000 })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the footer buttons directly inside the footer', async () => {
    const user = userEvent.setup()
    render(<Harness balances={completeSeptember} />)

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.parentElement).toHaveClass('data-details-entry-footer')
    expect(within(save.parentElement as HTMLElement).getAllByRole('button')).toHaveLength(2)
  })
})

describe('BalanceDetails check-in: future-dated months', () => {
  const projection = [
    makeBalanceEntry({ id: 20, accountId: 1, month: '2027-01', balance: 9001 }),
    makeBalanceEntry({ id: 21, accountId: 2, month: '2027-01', balance: 9002 }),
    makeBalanceEntry({ id: 22, accountId: 3, month: '2027-01', balance: 9003 }),
  ]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 8, 12))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('copies a new month from the latest earlier month, not from a future-dated one', async () => {
    render(<Harness balances={[...completeSeptember, ...projection]} startCheckInMonth="2026-10" />)

    expect(await screen.findByRole('textbox', { name: 'Checking balance' })).toHaveValue('1000')
    expect(screen.getByRole('textbox', { name: 'Roth IRA balance' })).toHaveValue('12400')
    expect(screen.getAllByText('Copied from September 2026')).toHaveLength(3)
    expect(screen.getByText('Amounts are copied from September 2026. Update each one, then save.')).toBeVisible()
    expect(screen.queryByText(/January 2027/)).not.toBeInTheDocument()
  })

  it('saves the September values, never the future ones', async () => {
    const user = userEvent.setup()
    const onSaveMonth = vi.fn()
    render(
      <Harness
        balances={[...completeSeptember, ...projection]}
        startCheckInMonth="2026-10"
        onSaveMonth={onSaveMonth}
      />,
    )

    await screen.findByRole('textbox', { name: 'Checking balance' })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSaveMonth).toHaveBeenCalledWith('2026-10', { '1': 1000, '2': 2000, '3': 12400 })
  })

  it('recalls the last recorded amount from the same source month as the copied value', async () => {
    const user = userEvent.setup()
    render(<Harness balances={[...completeSeptember, ...projection]} startCheckInMonth="2026-10" />)

    const checking = await screen.findByRole('textbox', { name: 'Checking balance' })
    await firstInputFocused()
    await user.clear(checking)

    expect(checking).toHaveAccessibleDescription('No balance yet. Last recorded $1,000 in September 2026.')
  })

  it('leaves everything blank when only future-dated months exist', async () => {
    render(<Harness balances={projection} startCheckInMonth="2026-10" />)

    expect(await screen.findByRole('textbox', { name: 'Checking balance' })).toHaveValue('')
    expect(screen.queryByText(/Copied from/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Amounts are copied from/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Checking balance' })).toHaveAccessibleDescription(
      'No balance yet. No earlier balance.',
    )
  })

  it('copies from the month before a gap month rather than the latest month', async () => {
    const balances = [
      makeBalanceEntry({ id: 30, accountId: 1, month: '2026-08', balance: 800 }),
      makeBalanceEntry({ id: 31, accountId: 1, month: '2026-10', balance: 1100 }),
    ]
    render(<Harness balances={balances} startCheckInMonth="2026-09" accountList={[accounts[0]]} />)

    expect(await screen.findByRole('textbox', { name: 'Checking balance' })).toHaveValue('800')
    expect(screen.getByText('Copied from August 2026')).toBeVisible()
  })

  it('applies the same source rule to the Add Entry flow', async () => {
    const user = userEvent.setup()
    render(<Harness balances={[...completeSeptember, ...projection]} />)

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-10' } })
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('textbox', { name: 'Checking balance' })).toHaveValue('1000')
    expect(screen.getAllByText('Copied from September 2026')).toHaveLength(3)
  })

  it('keeps the existing copy source (latest month) with the flag off', async () => {
    mockFlag = false
    const user = userEvent.setup()
    render(<Harness balances={[...completeSeptember, ...projection]} />)

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-10' } })
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('textbox', { name: 'Checking balance' })).toHaveValue('9001')
  })
})

describe('BalanceDetails footer layout hook', () => {
  it.each([
    [true, true],
    [false, false],
  ])('with the flag %s the footer check-in modifier is %s', async (flag, hasModifier) => {
    mockFlag = flag
    const user = userEvent.setup()
    render(<Harness balances={completeSeptember} />)

    await user.click(screen.getByRole('button', { name: '+ Add Entry' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const footer = screen.getByRole('button', { name: 'Save' }).closest('.data-details-entry-footer')
    expect(footer?.classList.contains('data-details-entry-footer--check-in')).toBe(hasModifier)
  })
})

describe('BalanceDetails partial month', () => {
  const changeLineFor = (name: string) =>
    screen.getByText(name).closest('article')?.querySelector('.account-card__change') ?? null

  it('shows the Partial month badge beside Net worth when the latest month is partial', () => {
    render(<Harness balances={septemberToOctober} />)

    const summary = screen.getByLabelText('Net worth summary')
    expect(within(summary).getByText('Partial month')).toHaveAccessibleDescription(
      /^1 account has no balance for October( 2026)?\. Net worth leaves it out\.$/,
    )
  })

  it('shows no badge when the latest month is complete', () => {
    render(<Harness balances={completeSeptember} />)

    expect(screen.queryByText('Partial month')).not.toBeInTheDocument()
  })

  it('shows no badge for a historical month, even one with gaps', async () => {
    const user = userEvent.setup()
    const balances = [
      makeBalanceEntry({ id: 1, accountId: 1, month: '2026-08', balance: 900 }),
      ...septemberToOctober.slice(0, 3),
      makeBalanceEntry({ id: 9, accountId: 1, month: '2026-10', balance: 1100 }),
      makeBalanceEntry({ id: 10, accountId: 2, month: '2026-10', balance: 2100 }),
      makeBalanceEntry({ id: 11, accountId: 3, month: '2026-10', balance: 12500 }),
    ]
    render(<Harness balances={balances} />)
    expect(screen.queryByText('Partial month')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /October 2026|Oct 2026/ }))
    await user.click(await screen.findByRole('button', { name: /August|Aug/ }))

    expect(screen.queryByText('Partial month')).not.toBeInTheDocument()
  })

  it('hides the badge while the check-in form is open', async () => {
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)

    await screen.findByText('Adding the missing balances for October 2026')
    expect(screen.queryByText('Partial month')).not.toBeInTheDocument()
  })

  it('brings the badge back after the missing balance is saved and the form closes', async () => {
    const user = userEvent.setup()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)
    await screen.findByText('Adding the missing balances for October 2026')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Partial month')).toBeInTheDocument()
  })

  it('hides the change line for an account with no balance this month', () => {
    render(<Harness balances={septemberToOctober} />)

    expect(changeLineFor('Checking')).not.toBeNull()
    expect(changeLineFor('Roth IRA')).toBeNull()
  })

  it('hides the change line for a group with no balance this month', () => {
    const grouped = [
      makeAccount({ id: 1, name: 'Checking' }),
      makeAccount({ id: 2, name: 'Brokerage', group: 'Trusts' }),
      makeAccount({ id: 3, name: 'Roth IRA', group: 'Trusts' }),
    ]
    const balances = [
      makeBalanceEntry({ id: 1, accountId: 1, month: '2026-09', balance: 1000 }),
      makeBalanceEntry({ id: 2, accountId: 2, month: '2026-09', balance: 2000 }),
      makeBalanceEntry({ id: 3, accountId: 3, month: '2026-09', balance: 3000 }),
      makeBalanceEntry({ id: 4, accountId: 1, month: '2026-10', balance: 1100 }),
    ]
    render(<Harness balances={balances} accountList={grouped} />)

    const groupCard = screen.getByText('Trusts').closest('article') as HTMLElement
    expect(groupCard.querySelector('.account-group-card__meta .account-card__change')).toBeNull()
  })
})

describe('BalanceDetails partial month with the flag off', () => {
  beforeEach(() => {
    mockFlag = false
  })

  it('shows no badge', () => {
    render(<Harness balances={septemberToOctober} />)

    expect(screen.queryByText('Partial month')).not.toBeInTheDocument()
  })

  it('keeps the existing change line, which treats a missing balance as zero', () => {
    render(<Harness balances={septemberToOctober} />)

    const line = screen.getByText('Roth IRA').closest('article')?.querySelector('.account-card__change')
    expect(line).toHaveTextContent('↓ $12,400 (100.0%)')
  })
})

describe('BalanceDetails check-in: focus after leaving edit mode', () => {
  const addEntryButton = () => screen.getByRole('button', { name: '+ Add Entry' })

  it('moves focus to Add Entry after saving', async () => {
    const user = userEvent.setup()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)
    await firstInputFocused()

    await user.type(screen.getByLabelText('Roth IRA balance'), '12500')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(addEntryButton()).toHaveFocus())
  })

  it('moves focus to Add Entry after Cancel and after Escape', async () => {
    const user = userEvent.setup()
    render(<Harness balances={septemberToOctober} startCheckInMonth="2026-10" />)
    await firstInputFocused()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(addEntryButton()).toHaveFocus())
  })

  it('does not take focus on first render', () => {
    render(<Harness balances={septemberToOctober} />)

    expect(addEntryButton()).not.toHaveFocus()
  })

  it('leaves focus alone after saving with the flag off', async () => {
    mockFlag = false
    const user = userEvent.setup()
    render(<Harness balances={septemberToOctober} />)

    await user.click(addEntryButton())
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await firstInputFocused()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(addEntryButton()).not.toHaveFocus()
  })
})
