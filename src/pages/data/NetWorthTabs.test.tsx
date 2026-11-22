import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import Data from './Data'
import { makeFlagContextValue } from '../../test/flagTestUtils'
import { FlagContext } from '../../flags/FlagContext'

vi.mock('../../contexts/GoalsContext', () => ({
  useGoals: () => ({
    profile: { name: '', currency: 'USD', locale: 'en-US', dateFormat: 'MMM YYYY' },
  }),
}))

vi.mock('../../contexts/SettingsContext', () => ({
  useSettings: () => ({
    allowCsvImport: false,
  }),
}))

vi.mock('../review/AnnualReview', () => ({
  default: () => <div>Review page</div>,
}))

vi.mock('../../contexts/GitHubSyncContext', () => ({
  useGitHubSyncContext: () => ({
    handleDataChange: () => {},
  }),
}))

vi.mock('../../contexts/DataContext', () => ({
  useData: () => ({
    accounts: [],
    balances: [],
    setAccounts: () => {},
    setBalances: () => {},
  }),
}))

function renderData(initialRoute = '/net-worth/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/net-worth/*" element={<Data />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

/* ─── Tab bar rendering ─── */

describe('Net Worth tab bar', () => {
  it('renders a nav element with aria-label "Wealth sections"', () => {
    renderData()
    const nav = screen.getByRole('navigation', { name: 'Wealth sections' })
    expect(nav).toBeInTheDocument()
  })

  it('renders a "Dashboard" tab inside the nav', () => {
    renderData()
    const nav = screen.getByRole('navigation', { name: 'Wealth sections' })
    const accountsLink = nav.querySelector('a')
    expect(accountsLink).toBeInTheDocument()
    expect(accountsLink).toHaveTextContent('Dashboard')
  })

  it('the "Dashboard" tab links to /net-worth/dashboard', () => {
    renderData()
    const link = screen.getByRole('link', { name: 'Dashboard' })
    expect(link).toHaveAttribute('href', '/net-worth/dashboard')
  })

  it('renders an "Allocation" tab inside the nav', () => {
    renderData()
    const nav = screen.getByRole('navigation', { name: 'Wealth sections' })
    const links = nav.querySelectorAll('a')
    const allocationLink = Array.from(links).find(a => a.textContent === 'Allocation')
    expect(allocationLink).toBeInTheDocument()
  })

  it('the "Allocation" tab links to /net-worth/allocation', () => {
    renderData()
    const link = screen.getByRole('link', { name: 'Allocation' })
    expect(link).toHaveAttribute('href', '/net-worth/allocation')
  })

  it('renders a "Growth" tab inside the nav', () => {
    renderData()
    const nav = screen.getByRole('navigation', { name: 'Wealth sections' })
    const links = nav.querySelectorAll('a')
    const growthLink = Array.from(links).find(a => a.textContent === 'Growth')
    expect(growthLink).toBeInTheDocument()
  })

  it('the "Growth" tab links to /net-worth/growth', () => {
    renderData()
    const link = screen.getByRole('link', { name: 'Growth' })
    expect(link).toHaveAttribute('href', '/net-worth/growth')
  })
})

/* ─── Active state ─── */

describe('Net Worth tab active state', () => {
  it('sets aria-current="page" on the active tab', () => {
    renderData('/net-worth/dashboard')
    const link = screen.getByRole('link', { name: 'Dashboard' })
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it('does not set aria-current on "Dashboard" when on /net-worth/allocation', () => {
    renderData('/net-worth/allocation')
    const link = screen.getByRole('link', { name: 'Dashboard' })
    expect(link).not.toHaveAttribute('aria-current')
  })

  it('sets aria-current="page" on the Allocation tab when active', () => {
    renderData('/net-worth/allocation')
    const link = screen.getByRole('link', { name: 'Allocation' })
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it('does not set aria-current on "Allocation" when on /net-worth', () => {
    renderData('/net-worth/dashboard')
    const link = screen.getByRole('link', { name: 'Allocation' })
    expect(link).not.toHaveAttribute('aria-current')
  })

  it('sets aria-current="page" on the Growth tab when active', () => {
    renderData('/net-worth/growth')
    const link = screen.getByRole('link', { name: 'Growth' })
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it('does not set aria-current on "Growth" when on /net-worth', () => {
    renderData('/net-worth/dashboard')
    const link = screen.getByRole('link', { name: 'Growth' })
    expect(link).not.toHaveAttribute('aria-current')
  })
})

/* ─── Review tab (annual-review flag) ─── */

const flagValue = (annualReview: boolean) => makeFlagContextValue({ 'annual-review': annualReview })

const LocationProbe = () => <div data-testid="location">{useLocation().pathname}</div>

function renderWithFlag(annualReview: boolean, initialRoute: string) {
  return render(
    <FlagContext.Provider value={flagValue(annualReview)}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <LocationProbe />
        <Routes>
          <Route path="/net-worth/*" element={<Data />} />
        </Routes>
      </MemoryRouter>
    </FlagContext.Provider>,
  )
}

describe('Net Worth Review tab with the annual-review flag on', () => {
  it('lists Review after Growth as the fourth tab', () => {
    renderWithFlag(true, '/net-worth/dashboard')
    const nav = screen.getByRole('navigation', { name: 'Wealth sections' })
    const names = Array.from(nav.querySelectorAll('a')).map(a => a.textContent)
    expect(names).toEqual(['Dashboard', 'Allocation', 'Growth', 'Review'])
  })

  it('links the Review tab to /net-worth/review', () => {
    renderWithFlag(true, '/net-worth/dashboard')
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/net-worth/review')
  })

  it('marks Review as the current tab on a review year route and renders the page', async () => {
    renderWithFlag(true, '/net-worth/review/2025')
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(await screen.findByText('Review page')).toBeInTheDocument()
  })

  it('renders the page on /net-worth/review with no year', async () => {
    renderWithFlag(true, '/net-worth/review')
    expect(await screen.findByText('Review page')).toBeInTheDocument()
  })

  it('hides the dashboard view tabs on the Review tab', () => {
    renderWithFlag(true, '/net-worth/review/2025')
    expect(screen.queryByRole('tablist', { name: 'Data view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Growth view mode' })).not.toBeInTheDocument()
  })
})

describe('Net Worth Review tab with the annual-review flag off', () => {
  it('keeps exactly Dashboard, Allocation and Growth', () => {
    renderWithFlag(false, '/net-worth/dashboard')
    const nav = screen.getByRole('navigation', { name: 'Wealth sections' })
    expect(Array.from(nav.querySelectorAll('a')).map(a => a.textContent)).toEqual(['Dashboard', 'Allocation', 'Growth'])
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
  })

  it.each(['/net-worth/review', '/net-worth/review/2025', '/net-worth/review/2025/extra'])(
    'redirects %s to the dashboard without rendering the review',
    route => {
      renderWithFlag(false, route)
      expect(screen.getByTestId('location')).toHaveTextContent('/net-worth/dashboard')
      expect(screen.queryByText('Review page')).not.toBeInTheDocument()
    },
  )

  it('renders nothing for other unknown wealth routes, as before', () => {
    renderWithFlag(false, '/net-worth/nope')
    expect(screen.getByTestId('location')).toHaveTextContent('/net-worth/nope')
  })
})
