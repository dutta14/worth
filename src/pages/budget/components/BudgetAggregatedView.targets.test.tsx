import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BudgetAggregatedView from './BudgetAggregatedView'
import type { BudgetTargetsConfig } from './BudgetAggregatedView'
import type { CategoryGroup, TimePeriod } from '../types'
import type { BudgetTargetsFile, TargetEntry } from '../utils/budgetTargets'

// "Today" in the worked examples (spec 4.7) is 2026-11-18.
const NOW = '2026-11'
const DINING: CategoryGroup[] = [{ id: 'dining', name: 'Dining', categories: ['Restaurants'] }]

const monthKeys = (year: number, months: number[]) => months.map(m => `${year}-${String(m).padStart(2, '0')}`)
const allMonths = (year: number) => monthKeys(year, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

const spendByMonth = (entries: Record<string, number>): Record<string, Record<string, number>> => ({
  Restaurants: Object.fromEntries(Object.entries(entries).map(([month, spend]) => [month, -spend])),
})

const evenSpend = (months: string[], each: number) => spendByMonth(Object.fromEntries(months.map(m => [m, each])))

const targetsFor = (...history: TargetEntry[]): BudgetTargetsFile => ({
  version: 1,
  groups: { dining: { label: 'Dining', history } },
})
const always = (monthly: number): TargetEntry => ({ from: null, monthly })

interface SetupOptions {
  year: number
  categorySums: Record<string, Record<string, number>>
  monthsWithData?: string[]
  targets?: BudgetTargetsFile
  timePeriod?: TimePeriod
  groups?: CategoryGroup[]
  config?: Partial<BudgetTargetsConfig>
  type?: 'expense' | 'income'
}

const setup = ({
  year,
  categorySums,
  monthsWithData,
  targets = { version: 1, groups: {} },
  timePeriod = 'month',
  groups = DINING,
  config,
  type = 'expense',
}: SetupOptions) => {
  const onSetTarget = vi.fn(async () => ({ ok: true }))
  const targetsConfig: BudgetTargetsConfig = {
    targets,
    monthsWithData: new Set(monthsWithData ?? Object.values(categorySums).flatMap(Object.keys)),
    nowMonthKey: NOW,
    readOnly: false,
    message: '',
    messageId: 0,
    onSetTarget,
    ...config,
  }
  const props = { year, type, categoryGroups: groups, categorySums, timePeriod, targetsConfig }
  const utils = render(<BudgetAggregatedView {...props} />)
  const rerender = (next: Partial<typeof props>) => utils.rerender(<BudgetAggregatedView {...props} {...next} />)
  return { ...utils, onSetTarget, rerender }
}

const diningRow = () => screen.getByRole('row', { name: /^Dining/ })
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell')
const vsCell = () => cellsOf(diningRow()).at(-1)!
const targetCell = () => cellsOf(diningRow()).at(-2)!

describe('BudgetAggregatedView with targets: columns', () => {
  const sums = evenSpend(['2025-03'], 400)

  it('adds Monthly target and Vs target column headers after Total on the Expenses tab', () => {
    setup({ year: 2025, categorySums: sums })
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(headers.slice(-3)).toEqual(['Total', 'Monthly target', 'Vs target'])
    expect(screen.getByRole('columnheader', { name: 'Monthly target' })).toHaveAttribute('scope', 'col')
    expect(screen.getByRole('columnheader', { name: 'Vs target' })).toHaveAttribute('scope', 'col')
  })

  it('renders none of the target elements when no config is passed', () => {
    const { container } = render(
      <BudgetAggregatedView
        year={2025}
        type="expense"
        categoryGroups={DINING}
        categorySums={sums}
        timePeriod="month"
      />,
    )
    expect(container.innerHTML).not.toContain('budget-target')
    expect(screen.queryByText('Monthly target')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /target/i })).not.toBeInTheDocument()
    expect(diningRow()).not.toHaveAttribute('title')
  })

  it('puts the full group name in a title on the name cell', () => {
    setup({ year: 2025, categorySums: sums })
    expect(cellsOf(diningRow())[0]).toHaveAttribute('title', 'Dining')
  })

  it('leaves Monthly target and Vs target empty in the Grand Total row', () => {
    setup({ year: 2025, categorySums: sums, targets: targetsFor(always(500)) })
    const cells = cellsOf(screen.getByText('Grand Total').closest('tr')!)
    expect(cells.at(-2)).toBeEmptyDOMElement()
    expect(cells.at(-1)).toBeEmptyDOMElement()
  })

  it('shows the note about monthly targets under the table', () => {
    setup({ year: 2025, categorySums: sums })
    expect(
      screen.getByText(
        'Targets are monthly. Changing one applies from this month on; earlier months keep the target that applied then.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the intro only while no group has a target', () => {
    const intro = 'Set a monthly target on any group to see how each month compares.'
    const { rerender } = setup({ year: 2025, categorySums: sums })
    expect(screen.getByText(intro)).toBeInTheDocument()

    rerender({ targetsConfig: { ...baseConfig(targetsFor(always(500))) } })
    expect(screen.queryByText(intro)).not.toBeInTheDocument()
  })

  it('re-announces an identical consecutive message by replacing the text node', () => {
    const { rerender } = setup({
      year: 2025,
      categorySums: sums,
      config: { message: "Couldn't save the target.", messageId: 1 },
    })
    const first = within(screen.getByRole('status')).getByText("Couldn't save the target.")

    rerender({
      targetsConfig: { ...baseConfig(targetsFor(always(500))), message: "Couldn't save the target.", messageId: 2 },
    })
    const second = within(screen.getByRole('status')).getByText("Couldn't save the target.")

    expect(second).not.toBe(first)
    expect(first).not.toBeInTheDocument()
  })

  it('keeps the same node while the announcement id is unchanged', () => {
    const { rerender } = setup({ year: 2025, categorySums: sums, config: { message: 'Same.', messageId: 3 } })
    const first = within(screen.getByRole('status')).getByText('Same.')
    rerender({ targetsConfig: { ...baseConfig(targetsFor(always(500))), message: 'Same.', messageId: 3 } })
    expect(within(screen.getByRole('status')).getByText('Same.')).toBe(first)
  })

  it('exposes the live message in a polite status region', () => {
    setup({ year: 2025, categorySums: sums, config: { message: 'Dining target set to $500 a month.' } })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Dining target set to $500 a month.')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })
})

const baseConfig = (targets: BudgetTargetsFile): BudgetTargetsConfig => ({
  targets,
  monthsWithData: new Set(['2025-03']),
  nowMonthKey: NOW,
  readOnly: false,
  message: '',
  messageId: 0,
  onSetTarget: vi.fn(async () => ({ ok: true })),
})

describe('BudgetAggregatedView with targets: rows without a target', () => {
  it('shows "Set target", an empty verdict and no indicator elements (example 4)', () => {
    const { container } = setup({ year: 2025, categorySums: evenSpend(['2025-03'], 400) })

    expect(within(targetCell()).getByRole('button', { name: 'Set monthly target for Dining' })).toHaveTextContent(
      'Set target',
    )
    expect(vsCell()).toBeEmptyDOMElement()
    expect(container.querySelector('.budget-target-status, .budget-target-delta, .budget-target-caption')).toBeNull()
    expect(within(diningRow()).queryByText(/over|under|left|On target/)).not.toBeInTheDocument()
  })

  it('renders no icon anywhere in the row', () => {
    setup({ year: 2025, categorySums: evenSpend(['2025-03'], 400) })
    expect(diningRow().querySelector('svg')).toBeNull()
  })
})

describe('BudgetAggregatedView with targets: worked examples (spec 4.7)', () => {
  it('1: shows "$120 under" for a completed year at $5,880 against $500 a month', () => {
    setup({ year: 2025, categorySums: evenSpend(allMonths(2025), 490), targets: targetsFor(always(500)) })
    expect(within(vsCell()).getByText('$120 under')).toBeInTheDocument()
    expect(within(vsCell()).queryByText(/of 12 months/)).not.toBeInTheDocument()
  })

  it('2: shows "$120 over" on the June period cell when June spend is $620', () => {
    setup({ year: 2026, categorySums: evenSpend(['2026-06'], 620), targets: targetsFor(always(500)) })
    const june = cellsOf(diningRow())[6]
    expect(within(june).getByText('$620')).toBeInTheDocument()
    expect(within(june).getByText('$120 over')).toBeInTheDocument()
  })

  it('2: also shows "$120 over" in the Vs target column when June is the only month with data', () => {
    setup({ year: 2026, categorySums: evenSpend(['2026-06'], 620), targets: targetsFor(always(500)) })
    expect(within(vsCell()).getByText('$120 over')).toBeInTheDocument()
    expect(within(vsCell()).getByText('1 of 12 months')).toBeInTheDocument()
  })

  it('3: shows "On target" at exactly $6,000', () => {
    setup({ year: 2025, categorySums: evenSpend(allMonths(2025), 500), targets: targetsFor(always(500)) })
    expect(within(vsCell()).getByText('On target')).toBeInTheDocument()
  })

  it('5a: shows "On target" for a zero target with nothing spent, and the button reads $0', () => {
    setup({ year: 2025, categorySums: evenSpend(allMonths(2025), 0), targets: targetsFor(always(0)) })
    expect(within(vsCell()).getByText('On target')).toBeInTheDocument()
    expect(within(targetCell()).getByRole('button', { name: 'Dining monthly target $0, edit' })).toBeInTheDocument()
  })

  it('5b: shows "$25 over" for a zero target with $25 spent', () => {
    const sums = spendByMonth({ ...Object.fromEntries(allMonths(2025).map(m => [m, 0])), '2025-01': 25 })
    setup({ year: 2025, categorySums: sums, targets: targetsFor(always(0)) })
    expect(within(vsCell()).getByText('$25 over')).toBeInTheDocument()
  })

  it('6: shows "$210 over" on the Q1 cell in the quarterly view', () => {
    setup({
      year: 2026,
      timePeriod: 'quarter',
      categorySums: evenSpend(monthKeys(2026, [1, 2, 3]), 570),
      targets: targetsFor(always(500)),
    })
    const q1 = cellsOf(diningRow())[1]
    expect(within(q1).getByText('$1,710')).toBeInTheDocument()
    expect(within(q1).getByText('$210 over')).toBeInTheDocument()
  })

  it('7a: shows "$200 left" with a "1 of 12 months" caption while the current month is in progress', () => {
    setup({ year: 2026, categorySums: evenSpend(['2026-11'], 300), targets: targetsFor(always(500)) })
    expect(within(vsCell()).getByText('$200 left')).toBeInTheDocument()
    expect(within(vsCell()).getByText('1 of 12 months')).toBeInTheDocument()
  })

  it('7a: prints nothing extra under the November period cell for an in-progress month', () => {
    setup({ year: 2026, categorySums: evenSpend(['2026-11'], 300), targets: targetsFor(always(500)) })
    const nov = cellsOf(diningRow())[11]
    expect(nov).toHaveTextContent(/^\$300$/)
  })

  it('7b: shows "$20 over" for $520 in the in-progress month', () => {
    setup({ year: 2026, categorySums: evenSpend(['2026-11'], 520), targets: targetsFor(always(500)) })
    expect(within(vsCell()).getByText('$20 over')).toBeInTheDocument()
  })

  it('8: nets a refund month against spend, so a net credit reads under the target by more than the target', () => {
    // Budget semantics: Restaurants is an expense category (it has a negative month), so March's +$140 refund nets against February's $100.
    setup({
      year: 2025,
      categorySums: { Restaurants: { '2025-02': -100, '2025-03': 140 } },
      targets: targetsFor(always(500)),
    })
    expect(within(vsCell()).getByText('$1,040 under')).toBeInTheDocument()
    expect(within(vsCell()).getByText('2 of 12 months')).toBeInTheDocument()
  })

  it('8: a category that is a net credit all year is not an expense category, so it adds no spend or credit', () => {
    setup({ year: 2025, categorySums: { Restaurants: { '2025-03': 40 } }, targets: targetsFor(always(500)) })
    expect(within(vsCell()).getByText('$500 under')).toBeInTheDocument()
    expect(within(vsCell()).getByText('1 of 12 months')).toBeInTheDocument()
  })

  it('compares the verdict with the amounts the row shows, ignoring a category that is positive all year', () => {
    setup({
      year: 2025,
      groups: [{ id: 'others', name: 'Others', categories: ['Misc', 'Reimbursement'] }],
      categorySums: { Misc: { '2025-03': -300 }, Reimbursement: { '2025-03': 1200 } },
      targets: { version: 1, groups: { others: { label: 'Others', history: [always(500)] } } },
    })
    const row = screen.getByRole('row', { name: /^Others/ })
    const cells = cellsOf(row)
    expect(within(cells[3]).getByText('$300')).toBeInTheDocument()
    expect(within(cells.at(-1)!).getByText('$200 under')).toBeInTheDocument()
  })

  it('9: shows "$300 over" with "4 of 12 months" for a partial year', () => {
    setup({
      year: 2025,
      categorySums: spendByMonth({ '2025-01': 600, '2025-02': 550, '2025-03': 600, '2025-04': 550 }),
      targets: targetsFor(always(500)),
    })
    expect(within(vsCell()).getByText('$300 over')).toBeInTheDocument()
    expect(within(vsCell()).getByText('4 of 12 months')).toBeInTheDocument()
  })

  it('10a: reads "On target" for $500.40 against $500', () => {
    setup({ year: 2025, categorySums: spendByMonth({ '2025-03': 500.4 }), targets: targetsFor(always(500)) })
    expect(within(vsCell()).getByText('On target')).toBeInTheDocument()
  })

  it('10b: reads "$1 over" for $500.60 against $500', () => {
    setup({ year: 2025, categorySums: spendByMonth({ '2025-03': 500.6 }), targets: targetsFor(always(500)) })
    expect(within(vsCell()).getByText('$1 over')).toBeInTheDocument()
  })

  describe('11: a target changed in November', () => {
    const targets = targetsFor(always(500), { from: '2026-11', monthly: 600 })
    const sums = spendByMonth({ '2026-10': 400, '2026-11': 600 })

    it('judges the year against $1,100 and shows "$100 left" with "2 of 12 months"', () => {
      setup({ year: 2026, categorySums: sums, targets })
      expect(within(vsCell()).getByText('$100 left')).toBeInTheDocument()
      expect(within(vsCell()).getByText('2 of 12 months')).toBeInTheDocument()
    })

    it('shows the target in effect now on the button', () => {
      setup({ year: 2026, categorySums: sums, targets })
      expect(within(targetCell()).getByRole('button', { name: 'Dining monthly target $600, edit' })).toBeInTheDocument()
    })

    it('prints nothing extra on the Q4 cell', () => {
      setup({ year: 2026, categorySums: sums, targets, timePeriod: 'quarter' })
      const q4 = cellsOf(diningRow())[4]
      expect(q4).toHaveTextContent(/^\$1,000$/)
    })
  })

  it('12: shows "$400 over" on the H1 cell in the half-year view', () => {
    setup({
      year: 2026,
      timePeriod: 'half',
      categorySums: spendByMonth({
        '2026-01': 600,
        '2026-02': 600,
        '2026-03': 600,
        '2026-04': 500,
        '2026-05': 550,
        '2026-06': 550,
      }),
      targets: targetsFor(always(500)),
    })
    const h1 = cellsOf(diningRow())[1]
    expect(within(h1).getByText('$3,400')).toBeInTheDocument()
    expect(within(h1).getByText('$400 over')).toBeInTheDocument()
  })

  it('shows no extra line on an under period cell', () => {
    setup({ year: 2025, categorySums: spendByMonth({ '2025-03': 400 }), targets: targetsFor(always(500)) })
    expect(cellsOf(diningRow())[3]).toHaveTextContent(/^\$400$/)
  })

  it('shows no verdict when no month with data has a target', () => {
    setup({
      year: 2025,
      categorySums: spendByMonth({ '2025-03': 400 }),
      targets: targetsFor({ from: '2026-01', monthly: 500 }),
    })
    expect(vsCell()).toBeEmptyDOMElement()
  })

  it('keeps the Vs target verdict independent of the M/Q/H toggle and the Total/% toggle (AC-15)', async () => {
    const user = userEvent.setup()
    const props = { year: 2025, categorySums: evenSpend(allMonths(2025), 490), targets: targetsFor(always(500)) }
    const { rerender } = setup(props)
    const before = vsCell().textContent

    rerender({ timePeriod: 'quarter' })
    expect(vsCell().textContent).toBe(before)

    await user.click(screen.getByRole('columnheader', { name: 'Total' }))
    expect(vsCell().textContent).toBe(before)
  })
})

describe('BudgetAggregatedView with targets: row visibility', () => {
  it('keeps a group with a target but no spend visible and judges it against the target', () => {
    const groups: CategoryGroup[] = [...DINING, { id: 'travel', name: 'Travel', categories: [] }]
    setup({
      year: 2025,
      groups,
      categorySums: spendByMonth({ '2025-03': 100 }),
      targets: { version: 1, groups: { travel: { label: 'Travel', history: [always(300)] } } },
      monthsWithData: ['2025-03'],
    })
    const travel = screen.getByRole('row', { name: /^Travel/ })
    expect(within(travel).getByText('$300 under')).toBeInTheDocument()
    expect(within(travel).getByRole('button', { name: 'Travel monthly target $300, edit' })).toBeInTheDocument()
  })

  it('hides a group with neither spend nor a target, as before', () => {
    const groups: CategoryGroup[] = [...DINING, { id: 'travel', name: 'Travel', categories: [] }]
    setup({ year: 2025, groups, categorySums: spendByMonth({ '2025-03': 100 }) })
    expect(screen.queryByRole('row', { name: /^Travel/ })).not.toBeInTheDocument()
  })
})

describe('BudgetAggregatedView with targets: editing', () => {
  it('saves a typed target through onSetTarget with the group id and name', async () => {
    const user = userEvent.setup()
    const { onSetTarget } = setup({ year: 2025, categorySums: evenSpend(['2025-03'], 400) })

    await user.click(screen.getByRole('button', { name: 'Set monthly target for Dining' }))
    await user.type(screen.getByRole('textbox', { name: 'Monthly target for Dining' }), '500{Enter}')

    expect(onSetTarget).toHaveBeenCalledWith('dining', 'Dining', 500)
  })

  it('supports keyboard-only set: Tab to the button, Enter, type, Enter', async () => {
    const user = userEvent.setup()
    const { onSetTarget } = setup({ year: 2025, categorySums: evenSpend(['2025-03'], 400) })

    const button = screen.getByRole('button', { name: 'Set monthly target for Dining' })
    for (let i = 0; i < 20 && document.activeElement !== button; i++) await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}250{Enter}')

    expect(onSetTarget).toHaveBeenCalledWith('dining', 'Dining', 250)
  })

  it('offers no target control for income groups', () => {
    const incomeGroups: CategoryGroup[] = [
      { id: 'income-others', name: 'Work', categories: ['Salary'], type: 'income' },
    ]
    render(
      <BudgetAggregatedView
        year={2025}
        type="income"
        categoryGroups={[]}
        incomeCategoryGroups={incomeGroups}
        categorySums={{ Salary: { '2025-03': 5000 } }}
        timePeriod="month"
        targetsConfig={baseConfig({ version: 1, groups: {} })}
      />,
    )
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /target/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Vs target' })).not.toBeInTheDocument()
  })
})

describe('BudgetAggregatedView with targets: unreadable file', () => {
  it('shows an alert, disables every editor and applies no targets', async () => {
    const user = userEvent.setup()
    setup({
      year: 2025,
      categorySums: evenSpend(['2025-03'], 400),
      config: { readOnly: true },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Your targets file couldn't be read, so targets are turned off to keep it safe. The file is budget/targets.json in your data folder.",
    )
    const button = screen.getByRole('button', { name: 'Set monthly target for Dining' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(vsCell()).toBeEmptyDOMElement()
    expect(
      screen.queryByText('Set a monthly target on any group to see how each month compares.'),
    ).not.toBeInTheDocument()
  })

  it('shows no alert when the file is readable', () => {
    setup({ year: 2025, categorySums: evenSpend(['2025-03'], 400) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
