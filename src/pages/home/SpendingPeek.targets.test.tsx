import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BudgetStore } from '../budget/types'
import type { BudgetTargetsFile } from '../budget/utils/budgetTargets'
import { TARGETS_PATH } from '../budget/utils/budgetTargetsStorage'
import { FlagContext } from '../../flags/FlagContext'
import { makeFlagContextValue } from '../../test/flagTestUtils'
import { MemoryFileStore } from '../../utils/memoryFileStore'
import SpendingPeek from './SpendingPeek'

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))

vi.mock('../budget/utils/budgetStorage', async importOriginal => ({
  ...(await importOriginal<typeof import('../budget/utils/budgetStorage')>()),
  loadBudgetStore: vi.fn(),
}))

vi.mock('../../styles/Home.css', () => ({}))

import { loadBudgetStore } from '../budget/utils/budgetStorage'

const mockedLoadBudgetStore = vi.mocked(loadBudgetStore)

const csv = (rows: Array<[string, string, number]>) =>
  `Date,Category,Amount\n${rows.map(([date, category, amount]) => `${date},${category},${amount}`).join('\n')}`

const makeStore = (overrides: Partial<BudgetStore> = {}): BudgetStore => ({
  csvs: {
    '2026-10': {
      month: '2026-10',
      csv: csv([
        ['2026-10-02', 'Restaurants', -620],
        ['2026-10-03', 'Restaurants', 100],
        ['2026-10-05', 'Rent', -1900],
        ['2026-10-06', 'Salary', 5000],
        ['2026-10-07', 'Transfers', -4000],
      ]),
      uploadedAt: '',
    },
    '2026-09': { month: '2026-09', csv: csv([['2026-09-02', 'Restaurants', -50]]), uploadedAt: '' },
  },
  configs: {},
  years: [2026],
  categoryGroups: [
    { id: 'dining', name: 'Dining', categories: ['Restaurants'] },
    { id: 'housing', name: 'Housing', categories: ['Rent'] },
    { id: 'travel', name: 'Travel', categories: ['Flights'] },
    { id: 'others', name: 'Others', categories: [] },
    { id: 'removed', name: 'Remove from Budget', categories: ['Transfers'] },
    { id: 'income-others', name: 'Income', categories: ['Salary'], type: 'income' },
  ],
  ...overrides,
})

const targetsFile = (monthly: Record<string, number>): BudgetTargetsFile => ({
  version: 1,
  groups: Object.fromEntries(
    Object.entries(monthly).map(([id, value]) => [id, { history: [{ from: null, monthly: value }] }]),
  ),
})

let fileStore: MemoryFileStore
const onNavigate = vi.fn()
const onOpenTargets = vi.fn()

const renderPeek = (flagOn: boolean, props: Partial<ComponentProps<typeof SpendingPeek>> = {}) =>
  render(
    <FlagContext.Provider value={makeFlagContextValue({ 'category-budget-targets': flagOn })}>
      <SpendingPeek
        fileStore={fileStore}
        hasBudgetData
        budgetDataLoaded
        onNavigate={onNavigate}
        onOpenTargets={onOpenTargets}
        {...props}
      />
    </FlagContext.Provider>,
  )

const findSubtitle = () => screen.findByText(/\d (last|this) month$/)

const findTargetsLine = () => document.querySelector('.spending-peek-targets')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 18))
  fileStore = new MemoryFileStore()
  mockedLoadBudgetStore.mockResolvedValue(makeStore())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SpendingPeek targets line, flag off', () => {
  it('never reads budget/targets.json', async () => {
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 500 }))
    const exists = vi.spyOn(fileStore, 'exists')
    const readJSON = vi.spyOn(fileStore, 'readJSON')
    const subscribe = vi.spyOn(fileStore, 'subscribe')

    renderPeek(false)
    await findSubtitle()

    expect(exists).not.toHaveBeenCalled()
    expect(readJSON).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(findTargetsLine()).toBeNull()
    expect(screen.queryByText(/target/i)).not.toBeInTheDocument()
  })

  it('renders the same DOM whether or not a targets file exists', async () => {
    const first = renderPeek(false)
    await findSubtitle()
    const without = first.container.innerHTML
    first.unmount()

    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 500 }))
    const second = renderPeek(false)
    await findSubtitle()

    expect(second.container.innerHTML).toBe(without)
  })
})

describe('SpendingPeek targets line, flag on', () => {
  it('shows nothing and leaves the DOM unchanged when no targets exist', async () => {
    const off = renderPeek(false)
    await findSubtitle()
    const baseline = off.container.innerHTML
    off.unmount()

    const on = renderPeek(true)
    await findSubtitle()
    await waitFor(() => expect(on.container.innerHTML).toBe(baseline))
    expect(findTargetsLine()).toBeNull()
  })

  it('shows one line for a single group over target, following Budget semantics for refunds', async () => {
    // Dining is -620 with a +100 refund: net $520, so $20 over a $500 target. The chart total counts refunds as spend.
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 500 }))
    renderPeek(true)

    expect(await screen.findByText('October: Dining is over target')).toBeInTheDocument()
    expect(document.querySelectorAll('.spending-peek-targets')).toHaveLength(1)
  })

  it('shows a within-target line for a single group', async () => {
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 520 }))
    renderPeek(true)
    expect(await screen.findByText('October: Dining is within target')).toBeInTheDocument()
  })

  it('says both groups when two groups are within target', async () => {
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 600, housing: 2000 }))
    renderPeek(true)
    expect(await screen.findByText('October: within target in both groups')).toBeInTheDocument()
  })

  it('counts over groups when three groups have targets', async () => {
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 100, housing: 1000, travel: 300 }))
    renderPeek(true)
    expect(await screen.findByText('October: over target in 2 of 3 groups')).toBeInTheDocument()
  })

  it('says all groups when three groups are within target', async () => {
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 900, housing: 2500, travel: 300 }))
    renderPeek(true)
    expect(await screen.findByText('October: within target in all 3 groups')).toBeInTheDocument()
  })

  it('adds "so far" when the newest month is the current calendar month', async () => {
    vi.setSystemTime(new Date(2026, 9, 20))
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 900 }))
    renderPeek(true)
    expect(await screen.findByText('October so far: Dining is within target')).toBeInTheDocument()
  })

  it('does not count excluded groups: removed, income and groups without targets', async () => {
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 900, removed: 1, 'income-others': 1 }))
    renderPeek(true)
    expect(await screen.findByText('October: Dining is within target')).toBeInTheDocument()
  })

  describe('classifies categories like the Budget table, by sign over the anchor month year', () => {
    const rewardsStore = (extra: BudgetStore['csvs'] = {}): BudgetStore =>
      makeStore({
        csvs: {
          '2026-10': {
            month: '2026-10',
            csv: csv([
              ['2026-10-02', 'Restaurants', -400],
              ['2026-10-03', 'Dining Rewards', 100],
            ]),
            uploadedAt: '',
          },
          ...extra,
        },
        categoryGroups: [
          { id: 'dining', name: 'Dining', categories: ['Restaurants', 'Dining Rewards'] },
          { id: 'others', name: 'Others', categories: [] },
          { id: 'removed', name: 'Remove from Budget', categories: [] },
        ],
      })

    it('ignores a category that is positive all year', async () => {
      mockedLoadBudgetStore.mockResolvedValue(rewardsStore())
      await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 350 }))
      renderPeek(true)
      expect(await screen.findByText('October: Dining is over target')).toBeInTheDocument()
    })

    it('counts it once another month of the same year makes it a negative category', async () => {
      const march = { month: '2026-03', csv: csv([['2026-03-02', 'Dining Rewards', -5]]), uploadedAt: '' }
      mockedLoadBudgetStore.mockResolvedValue(rewardsStore({ '2026-03': march }))
      await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 350 }))
      renderPeek(true)
      expect(await screen.findByText('October: Dining is within target')).toBeInTheDocument()
    })

    it('does not let a negative month of a previous year change the classification', async () => {
      const last = { month: '2025-03', csv: csv([['2025-03-02', 'Dining Rewards', -5]]), uploadedAt: '' }
      mockedLoadBudgetStore.mockResolvedValue(rewardsStore({ '2025-03': last }))
      await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 350 }))
      renderPeek(true)
      expect(await screen.findByText('October: Dining is over target')).toBeInTheDocument()
    })
  })

  it('shows nothing when a target only starts after the anchor month', async () => {
    const targets: BudgetTargetsFile = {
      version: 1,
      groups: { dining: { history: [{ from: '2026-11', monthly: 500 }] } },
    }
    await fileStore.writeJSON(TARGETS_PATH, targets)
    renderPeek(true)
    await findSubtitle()
    await waitFor(() => expect(mockedLoadBudgetStore).toHaveBeenCalled())
    expect(findTargetsLine()).toBeNull()
  })

  it('calls onOpenTargets from the "See targets" button', async () => {
    const user = userEvent.setup()
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 500 }))
    renderPeek(true)

    await user.click(await screen.findByRole('button', { name: /^See targets/ }))
    expect(onOpenTargets).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('omits the link when no onOpenTargets handler is given', async () => {
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 500 }))
    renderPeek(true, { onOpenTargets: undefined })

    await screen.findByText('October: Dining is over target')
    expect(screen.queryByRole('button', { name: /See targets/ })).not.toBeInTheDocument()
  })

  it('hides the icon from assistive technology', async () => {
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 500 }))
    renderPeek(true)
    await screen.findByText('October: Dining is over target')
    expect(findTargetsLine()?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows no line and leaves the file untouched when the targets file is unreadable', async () => {
    const raw = { version: 2, groups: {} }
    await fileStore.writeJSON(TARGETS_PATH, raw)
    const write = vi.spyOn(fileStore, 'writeJSON')
    renderPeek(true)

    await findSubtitle()
    await waitFor(() => expect(mockedLoadBudgetStore).toHaveBeenCalled())
    expect(findTargetsLine()).toBeNull()
    expect(write).not.toHaveBeenCalled()
    expect(await fileStore.readJSON(TARGETS_PATH, null)).toEqual(raw)
  })

  it('does not throw when the file store cannot be read', async () => {
    renderPeek(true, { fileStore: {} as MemoryFileStore })
    expect(await findSubtitle()).toBeInTheDocument()
    expect(findTargetsLine()).toBeNull()
  })

  it('shows no line when the store has no transactions', async () => {
    mockedLoadBudgetStore.mockResolvedValue(makeStore({ csvs: {} }))
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 500 }))
    renderPeek(true)
    await screen.findByRole('button', { name: 'Add budget data →' })
    expect(findTargetsLine()).toBeNull()
  })

  it('shows no line without budget data and reads no targets', async () => {
    const exists = vi.spyOn(fileStore, 'exists')
    await fileStore.writeJSON(TARGETS_PATH, targetsFile({ dining: 500 }))
    renderPeek(true, { hasBudgetData: false })
    await screen.findByRole('button', { name: 'Add budget data →' })
    expect(findTargetsLine()).toBeNull()
    expect(exists).toHaveBeenCalled()
  })
})
