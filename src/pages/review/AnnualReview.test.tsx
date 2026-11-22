import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('offers no Print or Download buttons yet', async () => {
    renderPage('/net-worth/review/2025')

    await screen.findByRole('heading', { level: 2, name: 'Annual Review 2025' })
    expect(within(document.querySelector('.ar-page') as HTMLElement).queryByRole('button')).not.toBeInTheDocument()
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
  it('puts the year select first and nothing else focusable in a year with data', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage('/net-worth/review/2025')
    await waitFor(() => expect(yearSelect()).toBeEnabled())

    await user.tab()
    expect(yearSelect()).toHaveFocus()

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
  it('renders the section container and no fake figures or empty-state text', async () => {
    renderPage('/net-worth/review/2025')

    await screen.findByText('January to December 2025')
    expect(document.querySelector('.ar-sections')).toBeInTheDocument()
    expect(screen.queryByText(/Not enough data|Nothing to review/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
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
