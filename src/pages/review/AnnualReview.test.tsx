import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeGoal } from '../../test/factories'
import { FileStoreTestProvider } from '../../test/fileStoreTestUtils'
import { balancesFor, GROUPS, makeAccounts } from '../../test/reviewFixtures'
import { MemoryFileStore } from '../../utils/memoryFileStore'
import { OVERRIDES_PATH } from '../tools/utils/savingsOverrides'
import AnnualReview from './AnnualReview'

const { mockUseData, mockUseGoals } = vi.hoisted(() => ({ mockUseData: vi.fn(), mockUseGoals: vi.fn() }))
vi.mock('../../contexts/DataContext', () => ({ useData: () => mockUseData() }))
vi.mock('../../contexts/GoalsContext', () => ({ useGoals: () => mockUseGoals() }))

const accounts = makeAccounts({ goalType: 'fi' })
const FULL_YEARS = balancesFor(1, { '2023-12': 300000, '2024-12': 400000, '2025-12': 460000 })

let store: MemoryFileStore

const LocationProbe = () => {
  const navigate = useNavigate()
  return (
    <>
      <div data-testid="location">{useLocation().pathname}</div>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
    </>
  )
}

const renderPage = (route: string, history: string[] = [route]) =>
  render(
    <FileStoreTestProvider store={store}>
      <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
        <Routes>
          <Route path="/net-worth/review/:year?" element={<AnnualReview />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </FileStoreTestProvider>,
  )

const useBalances = (balances: ReturnType<typeof balancesFor>, isLoaded = true) =>
  mockUseData.mockReturnValue({ accounts, balances, allMonths: [], isLoaded })

const yearSelect = () => screen.getByRole('combobox', { name: 'Year' })
const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map(o => o.textContent)
const liveRegion = () => document.querySelector('.ar-live') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 8))
  store = new MemoryFileStore()
  useBalances(FULL_YEARS)
  mockUseGoals.mockReturnValue({ goals: [], profile: { birthday: '1990-01' } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AnnualReview routing', () => {
  it('redirects /net-worth/review to the default year once the data has loaded', async () => {
    renderPage('/net-worth/review')

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/net-worth/review/2025'))
    expect(await screen.findByRole('heading', { level: 2, name: 'Annual Review 2025' })).toBeInTheDocument()
  })

  it.each(['abc', '25', '20255', '2025x'])(
    'redirects the invalid year "%s" to /net-worth/review and on to the default',
    async bad => {
      renderPage(`/net-worth/review/${bad}`)

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/net-worth/review/2025'))
    },
  )

  it('keeps the route year in the URL so it survives a reload', async () => {
    renderPage('/net-worth/review/2024')

    expect(await screen.findByRole('heading', { level: 2, name: 'Annual Review 2024' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/net-worth/review/2024')
  })
})

describe('AnnualReview loading state', () => {
  it('shows a status message and disabled controls, with no numbers, until the data loads', async () => {
    useBalances(FULL_YEARS, false)
    renderPage('/net-worth/review/2025')

    expect(await screen.findByText('Loading your review...')).toBeInTheDocument()
    expect(screen.getAllByRole('status').some(el => el.textContent === 'Loading your review...')).toBe(true)
    expect(yearSelect()).toBeDisabled()
    expect(document.querySelector('.ar-body')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('shows the title without a year and a disabled placeholder select while no year is chosen', async () => {
    useBalances(FULL_YEARS, false)
    renderPage('/net-worth/review')
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(screen.getByRole('heading', { level: 2, name: 'Annual Review' })).toBeInTheDocument()
    expect(yearSelect()).toBeDisabled()
    expect(optionTexts(yearSelect())).toEqual(['Select a year'])
  })

  it('replaces the loading message with the page and clears aria-busy when ready', async () => {
    renderPage('/net-worth/review/2025')

    await waitFor(() => expect(screen.queryByText('Loading your review...')).not.toBeInTheDocument())
    expect(document.querySelector('.ar-body')).toHaveAttribute('aria-busy', 'false')
    expect(yearSelect()).toBeEnabled()
  })
})

describe('AnnualReview header', () => {
  it('shows the title, subtitle and a period line for a complete year', async () => {
    renderPage('/net-worth/review/2025')

    expect(await screen.findByRole('heading', { level: 2, name: 'Annual Review 2025' })).toBeInTheDocument()
    expect(screen.getByText('Your year in money, built from the files in your folder.')).toBeInTheDocument()
    expect(screen.getByText('January to December 2025')).toBeInTheDocument()
  })

  it('names the in-progress period for the current year', async () => {
    useBalances(balancesFor(1, { '2025-12': 460000, '2026-10': 483000 }))
    renderPage('/net-worth/review/2026')

    expect(await screen.findByText('January to October 2026, year in progress')).toBeInTheDocument()
  })

  it('names the real months when the starting balance month is the nearest one', async () => {
    useBalances(balancesFor(1, { '2025-03': 50000, '2025-12': 62000 }))
    renderPage('/net-worth/review/2025')

    expect(await screen.findByText('Mar 2025 to Dec 2025')).toBeInTheDocument()
  })

  it('labels the year select and lists the years with data, newest first, with the route year selected', async () => {
    renderPage('/net-worth/review/2024')

    await waitFor(() => expect(yearSelect()).toBeEnabled())
    expect(optionTexts(yearSelect())).toEqual(['2026', '2025', '2024', '2023'])
    expect(yearSelect()).toHaveValue('2024')
  })

  it('still lists and renders a route year that has no data, with the empty state', async () => {
    renderPage('/net-worth/review/2019')

    expect(await screen.findByRole('heading', { level: 3, name: 'Not enough data for 2019' })).toBeInTheDocument()
    expect(optionTexts(yearSelect())).toEqual(['2026', '2025', '2024', '2023', '2019'])
    expect(yearSelect()).toHaveValue('2019')
    expect(screen.queryByText(/^January to December/)).not.toBeInTheDocument()
  })

  it('offers Print and Download buttons, enabled once the review is ready', async () => {
    renderPage('/net-worth/review/2025')

    const print = await screen.findByRole('button', { name: 'Print or save as PDF' })
    expect(print).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled()
  })
})

describe('AnnualReview year changes and live region', () => {
  it('announces when the review is ready', async () => {
    renderPage('/net-worth/review/2025')

    await waitFor(() => expect(liveRegion()).toHaveTextContent('Review for 2025 is ready.'))
    expect(liveRegion()).toHaveAttribute('role', 'status')
    expect(liveRegion()).toHaveClass('sr-only')
  })

  it('announces the ready message for the default year after the redirect', async () => {
    renderPage('/net-worth/review')

    await waitFor(() => expect(liveRegion()).toHaveTextContent('Review for 2025 is ready.'))
  })

  it('navigates with replace and announces the new year when the select changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('/net-worth/review/2025')
    await waitFor(() => expect(liveRegion()).toHaveTextContent('Review for 2025 is ready.'))

    await user.selectOptions(yearSelect(), '2024')

    expect(screen.getByTestId('location')).toHaveTextContent('/net-worth/review/2024')
    expect(await screen.findByRole('heading', { level: 2, name: 'Annual Review 2024' })).toBeInTheDocument()
    await waitFor(() => expect(liveRegion()).toHaveTextContent('Showing the review for 2024.'))
    expect(yearSelect()).toHaveValue('2024')
  })

  it('replaces the history entry, so Back leaves the review instead of stepping through years', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('/net-worth/review/2025', ['/start', '/net-worth/review/2025'])
    await waitFor(() => expect(yearSelect()).toBeEnabled())

    await user.selectOptions(yearSelect(), '2024')
    expect(screen.getByTestId('location')).toHaveTextContent('/net-worth/review/2024')
    await user.click(screen.getByRole('button', { name: 'back' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/start')
  })

  it('does not announce again when the same year re-renders after a data refresh', async () => {
    renderPage('/net-worth/review/2025')
    await waitFor(() => expect(liveRegion()).toHaveTextContent('Review for 2025 is ready.'))

    await store.writeJSON(OVERRIDES_PATH, { '2025': { netIncome: 1, savings: 1 } })
    act(() => {
      window.dispatchEvent(new Event('tools-changed'))
    })

    await waitFor(() => expect(liveRegion()).toHaveTextContent('Review for 2025 is ready.'))
  })
})

describe('AnnualReview keyboard order', () => {
  it('tabs from the year select to Print and Download, then the monthly values toggle and the in-page links, and nothing else', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('/net-worth/review/2025')
    await screen.findByRole('button', { name: 'Show monthly values' })

    await user.tab()
    expect(yearSelect()).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Show monthly values' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('link', { name: 'Go to Cashflow' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('link', { name: 'Open Planning' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'back' })).toHaveFocus()
  })

  it('moves from the select to the Wealth and Cashflow links in the empty state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('/net-worth/review/2019')
    await screen.findByRole('heading', { level: 3, name: 'Not enough data for 2019' })

    await user.tab()
    expect(yearSelect()).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Go to Wealth' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Go to Cashflow' })).toHaveFocus()
  })
})

describe('AnnualReview empty states', () => {
  it('says there is not enough data for a year with nothing in it, with links to Wealth and Cashflow', async () => {
    renderPage('/net-worth/review/2019')

    expect(await screen.findByRole('heading', { level: 3, name: 'Not enough data for 2019' })).toBeInTheDocument()
    expect(
      screen.getByText('Add month-end balances in Wealth or import transactions in Cashflow, then come back.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Wealth' })).toHaveAttribute('href', '/net-worth/dashboard')
    expect(screen.getByRole('link', { name: 'Go to Cashflow' })).toHaveAttribute('href', '/budget')
  })

  it('treats a future year as empty', async () => {
    renderPage('/net-worth/review/2030')

    expect(await screen.findByRole('heading', { level: 3, name: 'Not enough data for 2030' })).toBeInTheDocument()
  })

  it('says there is nothing to review yet when no year has any data', async () => {
    useBalances([])
    renderPage('/net-worth/review')

    expect(await screen.findByRole('heading', { level: 3, name: 'Nothing to review yet' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/net-worth/review/2026')
    expect(optionTexts(yearSelect())).toEqual(['2026'])
  })

  it('keeps the select enabled so another year can be picked', async () => {
    renderPage('/net-worth/review/2019')
    await screen.findByRole('heading', { level: 3, name: 'Not enough data for 2019' })

    expect(yearSelect()).toBeEnabled()
  })
})

describe('AnnualReview with data', () => {
  it('renders the sections with the figures from the selector and no empty-state text', async () => {
    renderPage('/net-worth/review/2025')

    await screen.findByText('January to December 2025')
    const sections = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(sections).toEqual(['Net worth', 'Income and savings', 'Goal progress at year end'])
    expect(screen.getByText('Up $60,000')).toBeInTheDocument()
    expect(screen.getByText('15.0% from $400,000 in Dec 2024 to $460,000 in Dec 2025')).toBeInTheDocument()
    expect(screen.queryByText(/Not enough data|Nothing to review/)).not.toBeInTheDocument()
  })

  it('shows the in-progress year with its note and an end month that is not December', async () => {
    useBalances(balancesFor(1, { '2025-12': 460000, '2026-10': 483000 }))
    renderPage('/net-worth/review/2026')

    expect(await screen.findByText('Up $23,000')).toBeInTheDocument()
    expect(screen.getByText('2026 is still in progress. This review covers January to October.')).toBeInTheDocument()
  })

  it('shows a negative net worth as negative dollars', async () => {
    useBalances(balancesFor(1, { '2024-12': -20000, '2025-12': -5000 }))
    renderPage('/net-worth/review/2025')

    expect(await screen.findByText('Up $15,000')).toBeInTheDocument()
    expect(screen.getAllByText('-$20,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-$5,000').length).toBeGreaterThan(0)
  })

  it('says there is no cashflow data when only balances exist, and offers the no-goal prompt', async () => {
    renderPage('/net-worth/review/2025')

    expect(await screen.findByText(/No income or expense data for 2025/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Planning' })).toHaveAttribute('href', '/goal/plans')
    expect(screen.queryByRole('heading', { name: 'Top spending groups' })).not.toBeInTheDocument()
  })

  it('says no goals existed when the user has goals but none by the end of the year', async () => {
    mockUseGoals.mockReturnValue({
      goals: [makeGoal({ id: 1, goalName: 'Later', goalCreatedIn: '2027-01' })],
      profile: { birthday: '1990-01' },
    })
    renderPage('/net-worth/review/2025')

    expect(await screen.findByText('You had no goals set by the end of 2025.')).toBeInTheDocument()
  })

  it('reads transactions from the folder so a year with only cashflow data is not empty', async () => {
    useBalances([])
    await store.writeJSON('budget/categories.json', { version: 1, years: [2024], categoryGroups: GROUPS })
    for (let m = 1; m <= 12; m++) {
      const key = `2024-${String(m).padStart(2, '0')}`
      await store.writeCSV(`transactions/2024/${key}.csv`, [
        ['Date', 'Category', 'Amount'],
        [`${key}-15`, 'Paycheck', '1000'],
      ])
    }
    renderPage('/net-worth/review/2024')

    expect(await screen.findByText('January to December 2024')).toBeInTheDocument()
    expect(screen.queryByText(/Not enough data/)).not.toBeInTheDocument()
  })
})

describe('AnnualReview error state', () => {
  it('shows an alert with a retry button when the manual log cannot be read, and recovers on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const readJSON = store.readJSON.bind(store)
    let failing = true
    vi.spyOn(store, 'readJSON').mockImplementation(async (path, fallback) => {
      if (path === OVERRIDES_PATH && failing) throw new Error('permission denied')
      return readJSON(path, fallback)
    })
    renderPage('/net-worth/review/2025')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The review could not be built. Your files were not changed.')
    expect(screen.queryByText('Loading your review...')).not.toBeInTheDocument()
    expect(yearSelect()).toBeEnabled()

    failing = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    await screen.findByText('January to December 2025')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the error state, not "Nothing to review yet", when DataContext failed to read the data', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockUseData.mockReturnValue({ accounts: [], balances: [], allMonths: [], isLoaded: true, loadFailed: true })
    const reload = vi.fn()
    window.addEventListener('data-changed', reload)
    renderPage('/net-worth/review/2025')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The review could not be built. Your files were not changed.')
    expect(screen.queryByText('Nothing to review yet')).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    window.removeEventListener('data-changed', reload)
    expect(reload).toHaveBeenCalled()
  })

  it('keeps the year select disabled in the error state when the route has no year', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(store, 'readJSON').mockRejectedValue(new Error('boom'))
    renderPage('/net-worth/review')

    await screen.findByRole('alert')
    expect(yearSelect()).toBeDisabled()
  })
})

describe('AnnualReview print and CSV', () => {
  const stubDownload = () => {
    const createObjectURL = vi.fn(() => 'blob:review')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    return { createObjectURL, revokeObjectURL, click }
  }

  it('disables Print and Download while loading', async () => {
    useBalances(FULL_YEARS, false)
    renderPage('/net-worth/review/2025')

    await screen.findByText('Loading your review...')
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
  })

  it('disables Print and Download for a year with no data, and shows no print footer', async () => {
    renderPage('/net-worth/review/2019')

    await screen.findByRole('heading', { level: 3, name: 'Not enough data for 2019' })
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
    expect(document.querySelector('.ar-print-footer')).toBeNull()
  })

  it('disables Print and Download in the error state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(store, 'readJSON').mockRejectedValue(new Error('boom'))
    renderPage('/net-worth/review/2025')

    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
  })

  it('opens the browser print dialog from the Print button', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    renderPage('/net-worth/review/2025')

    await user.click(await screen.findByRole('button', { name: 'Print or save as PDF' }))

    expect(print).toHaveBeenCalledTimes(1)
  })

  it('saves worth-annual-review-{year}.csv from the Download button and announces it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { createObjectURL, revokeObjectURL, click } = stubDownload()
    renderPage('/net-worth/review/2025')

    await user.click(await screen.findByRole('button', { name: 'Download CSV' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
    expect(blob.type).toBe('text/csv;charset=utf-8;')
    expect(await blob.text()).toContain('networth,change,Net worth change,60000.00,usd,,')
    expect(await blob.text()).toContain('report,generated,Generated on,2026-11-08,date,,')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:review')
    expect(liveRegion()).toHaveTextContent('Downloaded worth-annual-review-2025.csv.')
  })

  it('says the file could not be created, and leaves the page working, when the download fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    Object.assign(URL, {
      createObjectURL: () => {
        throw new Error('no blob')
      },
      revokeObjectURL: vi.fn(),
    })
    renderPage('/net-worth/review/2025')

    await user.click(await screen.findByRole('button', { name: 'Download CSV' }))

    expect(liveRegion()).toHaveTextContent('The CSV file could not be created. Your files were not changed.')
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled()
  })

  it('renders the print-only footer with today and the privacy line', async () => {
    renderPage('/net-worth/review/2025')

    await screen.findByText('January to December 2025')
    expect(document.querySelector('.ar-print-footer')).toHaveTextContent(
      'Prepared with worth on 2026-11-08. Your data stays on your computer.',
    )
  })

  it('sets the document title to the review year and restores it on unmount and year changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    document.title = 'worth'
    const { unmount } = renderPage('/net-worth/review/2025')

    await waitFor(() => expect(document.title).toBe('Annual Review 2025 - worth'))
    await waitFor(() => expect(yearSelect()).toBeEnabled())
    await user.selectOptions(yearSelect(), '2024')
    await waitFor(() => expect(document.title).toBe('Annual Review 2024 - worth'))

    unmount()
    expect(document.title).toBe('worth')
  })

  it('leaves the document title alone while the route has no year yet', async () => {
    document.title = 'worth'
    useBalances(FULL_YEARS, false)
    renderPage('/net-worth/review')

    await screen.findByText('Loading your review...')
    expect(document.title).toBe('worth')
  })
})
