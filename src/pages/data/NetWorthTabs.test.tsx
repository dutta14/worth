import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Data from './Data'

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

/* ─── Review tab ─── */

function renderReview(initialRoute: string) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/net-worth/*" element={<Data />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Net Worth Review tab', () => {
  it('lists Review after Growth as the fourth tab', () => {
    renderReview('/net-worth/dashboard')
    const nav = screen.getByRole('navigation', { name: 'Wealth sections' })
    const names = Array.from(nav.querySelectorAll('a')).map(a => a.textContent)
    expect(names).toEqual(['Dashboard', 'Allocation', 'Growth', 'Review'])
  })

  it('links the Review tab to /net-worth/review', () => {
    renderReview('/net-worth/dashboard')
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/net-worth/review')
  })

  it('marks Review as the current tab on a review year route and renders the page', async () => {
    renderReview('/net-worth/review/2025')
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(await screen.findByText('Review page')).toBeInTheDocument()
  })

  it('renders the page on /net-worth/review with no year', async () => {
    renderReview('/net-worth/review')
    expect(await screen.findByText('Review page')).toBeInTheDocument()
  })

  it('hides the dashboard view tabs on the Review tab', () => {
    renderReview('/net-worth/review/2025')
    expect(screen.queryByRole('tablist', { name: 'Data view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Growth view mode' })).not.toBeInTheDocument()
  })
})
